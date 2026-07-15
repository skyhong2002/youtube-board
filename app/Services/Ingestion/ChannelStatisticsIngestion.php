<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class ChannelStatisticsIngestion
{
    public function __construct(
        private readonly ChannelStatisticsPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(?int $uId = null, int $hours = 22, int $limit = 1, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(50, $limit));

        $preview = $this->preview->preview(uId: $uId, hours: $hours, limit: $limit, now: $now);
        $selectedRows = collect($preview['rows'] ?? [])->values();
        $rows = $selectedRows
            ->filter(fn (array $row): bool => trim((string) ($row['youtube_id'] ?? '')) !== '')
            ->values();
        $skipped = [];

        foreach ($selectedRows->filter(fn (array $row): bool => trim((string) ($row['youtube_id'] ?? '')) === '') as $row) {
            $rowUId = (int) ($row['u_id'] ?? 0);

            try {
                $this->deferChannel($rowUId, $now);
                $skipped[] = [
                    'u_id' => $rowUId,
                    'youtube_id' => '',
                    'reason' => 'missing_youtube_id',
                ];
                Log::warning('Channel statistics source item rejected.', [
                    'u_id' => $rowUId,
                    'reason' => 'missing_youtube_id',
                ]);
            } catch (Throwable $exception) {
                $skipped[] = [
                    'u_id' => $rowUId,
                    'youtube_id' => '',
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('Channel statistics item processing failed.', [
                    'u_id' => $rowUId,
                    'reason' => 'item_processing_failed',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        if ($rows->isEmpty()) {
            return $this->summary($preview, [], $skipped, $now);
        }

        $channelIds = $rows->pluck('youtube_id')->map(fn (mixed $id): string => (string) $id)->all();
        try {
            $statisticsByChannel = $this->youtube->channelStatistics($channelIds);
        } catch (YoutubeApiKeyPoolExhaustedException $exception) {
            $apiSkipped = $rows->map(fn (array $row): array => [
                'u_id' => (int) $row['u_id'],
                'youtube_id' => (string) $row['youtube_id'],
                'reason' => $exception->failureReason(),
            ])->all();
            Log::warning('Channel statistics polling paused after all YouTube API keys failed.', [
                'reason' => $exception->failureReason(),
                'selected_rows' => $rows->count(),
                'exception_class' => $exception::class,
            ]);

            return $this->summary(
                $preview,
                [],
                [...$skipped, ...$apiSkipped],
                $now,
                false,
                $rows->count(),
                $rows->count(),
            );
        } catch (YoutubeQuotaWindowException $exception) {
            $quotaSkipped = $rows->map(fn (array $row): array => [
                'u_id' => (int) $row['u_id'],
                'youtube_id' => (string) $row['youtube_id'],
                'reason' => 'quota_window_reset',
            ])->all();
            Log::warning('Channel statistics polling paused at quota window reset.', [
                'reason' => 'quota_window_reset',
                'selected_rows' => $rows->count(),
                'exception_class' => $exception::class,
            ]);

            return $this->summary(
                $preview,
                [],
                [...$skipped, ...$quotaSkipped],
                $now,
                true,
                $rows->count(),
                $rows->count(),
            );
        }
        $applied = [];

        foreach ($rows as $row) {
            $youtubeId = (string) $row['youtube_id'];
            $rowUId = (int) $row['u_id'];

            try {
                $statistics = $statisticsByChannel[$youtubeId] ?? null;

                if ($statistics === null) {
                    $this->deferChannel($rowUId, $now);
                    $skipped[] = [
                        'u_id' => $rowUId,
                        'youtube_id' => $youtubeId,
                        'reason' => 'api_item_missing',
                    ];
                    Log::warning('Channel statistics source item rejected.', [
                        'u_id' => $rowUId,
                        'reason' => 'api_item_missing',
                    ]);

                    continue;
                }

                if ($statistics['viewCount'] <= 0) {
                    $this->deferChannel($rowUId, $now);
                    $skipped[] = [
                        'u_id' => $rowUId,
                        'youtube_id' => $youtubeId,
                        'reason' => 'viewCount_not_positive',
                    ];
                    Log::warning('Channel statistics source item rejected.', [
                        'u_id' => $rowUId,
                        'reason' => 'viewCount_not_positive',
                    ]);

                    continue;
                }

                $this->upsertStatistics($rowUId, $statistics, $now);

                $applied[] = [
                    'u_id' => $rowUId,
                    'youtube_id' => $youtubeId,
                    'viewCount' => $statistics['viewCount'],
                    'subscriberCount' => $statistics['subscriberCount'],
                    'videoCount' => $statistics['videoCount'],
                ];
            } catch (Throwable $exception) {
                $skipped[] = [
                    'u_id' => $rowUId,
                    'youtube_id' => $youtubeId,
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('Channel statistics item processing failed.', [
                    'u_id' => $rowUId,
                    'reason' => 'item_processing_failed',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        return $this->summary(
            $preview,
            $applied,
            $skipped,
            $now,
            apiRequestedRows: $rows->count(),
        );
    }

    private function deferChannel(int $uId, CarbonImmutable $now): void
    {
        if ($uId < 1) {
            throw new RuntimeException('Channel statistics row is missing u_id.');
        }

        $this->updateExisting('urt_channel', 'u_id', $uId, [
            'stime' => $now->format('Y-m-d H:i:s'),
        ]);
    }

    /**
     * @param  array{viewCount: int, subscriberCount: int|null, hiddenSubscriberCount: bool, videoCount: int}  $statistics
     */
    private function upsertStatistics(int $uId, array $statistics, CarbonImmutable $now): void
    {
        $nowString = $now->format('Y-m-d H:i:s');
        $month = $now->format('Y-m-01');
        $date = $now->toDateString();

        // Production legacy tables may be MyISAM, so validate and publish history before freshness.
        $existingLog = Schema::hasTable('urt_log')
            ? DB::table('urt_log')->where('u_id', $uId)->where('themonth', $month)->first()
            : null;
        $data = [];

        if ($existingLog !== null) {
            $data = json_decode((string) ($existingLog->thedata ?? ''), true, 512, JSON_THROW_ON_ERROR);

            if (! is_array($data)) {
                throw new RuntimeException('Existing channel statistics history JSON is not an object or array.');
            }
        }
        $data[$date] = [
            'view' => $statistics['viewCount'],
            'video' => $statistics['videoCount'],
        ];

        if ($statistics['subscriberCount'] !== null) {
            $data[$date]['subscriber'] = $statistics['subscriberCount'];
        }

        if ($statistics['hiddenSubscriberCount']) {
            $data[$date]['hidden'] = true;
        }

        $logValues = [
            'mtime' => $nowString,
            'thedata' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];

        if ($existingLog === null) {
            $logValues['ctime'] = $nowString;
        }

        $this->upsertByKeys('urt_log', ['u_id' => $uId, 'themonth' => $month], $logValues);

        $countValues = [
            'mtime' => $nowString,
            'viewCount' => $statistics['viewCount'],
            'videoCount' => $statistics['videoCount'],
        ];
        $channelValues = [
            'stime' => $nowString,
            'mtime' => $nowString,
            'viewCount' => $statistics['viewCount'],
            'videoCount' => $statistics['videoCount'],
        ];

        if ($statistics['subscriberCount'] !== null) {
            $countValues['subscriberCount'] = $statistics['subscriberCount'];
            $channelValues['subscriberCount'] = $statistics['subscriberCount'];
        }

        $this->upsertByKeys('urt_count', ['u_id' => $uId], $countValues);
        $this->updateExisting('urt_channel', 'u_id', $uId, $channelValues);
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private function updateExisting(string $table, string $key, int $value, array $values): void
    {
        if (! Schema::hasTable($table)) {
            throw new RuntimeException("Missing local table: {$table}");
        }

        $values = $this->onlyExistingColumns($table, $values);

        if ($values !== []) {
            DB::table($table)->where($key, $value)->update($values);
        }
    }

    /**
     * @param  array<string, mixed>  $keys
     * @param  array<string, mixed>  $values
     */
    private function upsertByKeys(string $table, array $keys, array $values): void
    {
        if (! Schema::hasTable($table)) {
            throw new RuntimeException("Missing local table: {$table}");
        }

        $keys = $this->onlyExistingColumns($table, $keys);
        $values = $this->onlyExistingColumns($table, $values);

        if ($keys === []) {
            throw new RuntimeException("No usable key columns for {$table}");
        }

        $query = DB::table($table);

        foreach ($keys as $column => $value) {
            $query->where($column, $value);
        }

        if ((clone $query)->exists()) {
            if ($values !== []) {
                $query->update($values);
            }

            return;
        }

        DB::table($table)->insert($keys + $values);
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function onlyExistingColumns(string $table, array $values): array
    {
        $columns = Schema::getColumnListing($table);

        return collect($values)
            ->filter(fn (mixed $value, string $column): bool => in_array($column, $columns, true))
            ->all();
    }

    /**
     * @param  array<string, mixed>  $preview
     * @param  list<array<string, mixed>>  $applied
     * @param  list<array<string, mixed>>  $skipped
     * @return array<string, mixed>
     */
    private function summary(
        array $preview,
        array $applied,
        array $skipped,
        CarbonImmutable $now,
        bool $quotaWindowReset = false,
        int $remainingRetryRows = 0,
        int $apiRequestedRows = 0,
    ): array {
        $failedRows = collect($skipped)->whereIn('reason', [
            'api_item_missing',
            'item_processing_failed',
            'missing_youtube_id',
            'quota_window_reset',
            'viewCount_not_positive',
            YoutubeApiKeyPoolExhaustedException::AUTHENTICATION_FAILURE,
            YoutubeApiKeyPoolExhaustedException::QUOTA_FAILURE,
        ])->count();

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'missing_youtube_id' => (int) ($preview['missing_youtube_id'] ?? 0),
            'selected_missing_youtube_id' => (int) ($preview['selected_missing_youtube_id'] ?? 0),
            'api_requested_rows' => $apiRequestedRows,
            'updated_rows' => count($applied),
            'skipped_rows' => count($skipped),
            'failed_rows' => $failedRows,
            'quota_window_reset' => $quotaWindowReset,
            'remaining_retry_rows' => $remainingRetryRows,
            'exit_code' => $failedRows > 0 || $quotaWindowReset ? 1 : 0,
            'write_targets' => [
                'urt_channel.stime',
                'urt_channel.mtime',
                'urt_channel.viewCount',
                'urt_channel.subscriberCount',
                'urt_channel.videoCount',
                'urt_count.mtime',
                'urt_count.viewCount',
                'urt_count.subscriberCount',
                'urt_count.videoCount',
                'urt_log.ctime',
                'urt_log.mtime',
                'urt_log.thedata',
            ],
            'external_calls' => ['YouTube Data API channels.list(part=statistics)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }
}
