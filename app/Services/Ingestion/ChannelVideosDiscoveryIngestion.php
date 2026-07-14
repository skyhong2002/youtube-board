<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class ChannelVideosDiscoveryIngestion
{
    public function __construct(
        private readonly ChannelVideosDiscoveryPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?int $uId = null,
        ?int $live = null,
        bool $rescan = false,
        int $hours = 700,
        int $force = 1,
        int $limit = 1,
        int $maxResults = 5,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(10, $limit));
        $maxResults = max(1, min(50, $maxResults));
        $preview = $this->preview->preview(
            uId: $uId,
            live: $live,
            rescan: $rescan,
            hours: $hours,
            force: $force,
            limit: $limit,
            now: $now,
        );

        $applied = [];
        $skipped = [];
        $quotaWindowReset = false;
        $remainingRetryRows = 0;
        $rows = collect($preview['rows'] ?? [])->values();

        foreach ($rows as $index => $row) {
            $uploads = trim((string) ($row['uploads'] ?? ''));
            $rowUId = (int) ($row['u_id'] ?? 0);

            if ($rowUId < 1 || $uploads === '') {
                try {
                    if ($rowUId > 0) {
                        $this->updateExisting('urt_channel', 'u_id', $rowUId, [
                            'vtime' => $now->addHour()->format('Y-m-d H:i:s'),
                        ]);
                    }
                } catch (Throwable $exception) {
                    $skipped[] = [
                        'u_id' => $rowUId,
                        'uploads' => $uploads,
                        'reason' => 'item_processing_failed',
                    ];
                    Log::warning('Channel video discovery item processing failed.', [
                        'u_id' => $rowUId,
                        'reason' => 'item_processing_failed',
                        'exception_class' => $exception::class,
                    ]);

                    continue;
                }

                $skipped[] = [
                    'u_id' => $rowUId,
                    'uploads' => $uploads,
                    'reason' => 'missing_uploads_playlist',
                ];
                Log::warning('Channel video discovery channel is missing its uploads playlist.', [
                    'u_id' => $rowUId,
                    'reason' => 'missing_uploads_playlist',
                ]);

                continue;
            }

            try {
                $items = $this->youtube->playlistItems($uploads, $maxResults);
            } catch (Throwable $exception) {
                if ($exception instanceof YoutubeQuotaWindowException) {
                    $quotaWindowReset = true;
                    $remainingRetryRows = $rows->count() - $index;
                    $skipped[] = [
                        'u_id' => $rowUId,
                        'uploads' => $uploads,
                        'reason' => 'quota_window_reset',
                    ];
                    Log::warning('Channel video discovery paused at quota window reset.', [
                        'u_id' => $rowUId,
                        'reason' => 'quota_window_reset',
                        'exception_class' => $exception::class,
                    ]);

                    break;
                }

                try {
                    $this->updateExisting('urt_channel', 'u_id', $rowUId, [
                        'vtime' => $now->addHour()->format('Y-m-d H:i:s'),
                    ]);
                } catch (Throwable $updateException) {
                    $skipped[] = [
                        'u_id' => $rowUId,
                        'uploads' => $uploads,
                        'reason' => 'item_processing_failed',
                    ];
                    Log::warning('Channel video discovery item processing failed.', [
                        'u_id' => $rowUId,
                        'reason' => 'item_processing_failed',
                        'exception_class' => $updateException::class,
                    ]);

                    continue;
                }

                $skipped[] = [
                    'u_id' => $rowUId,
                    'uploads' => $uploads,
                    'reason' => 'playlist_api_error',
                ];
                Log::warning('Channel video discovery playlist request failed.', [
                    'u_id' => $rowUId,
                    'reason' => 'playlist_api_error',
                    'exception_class' => $exception::class,
                ]);

                continue;
            }

            try {
                $result = DB::transaction(function () use ($rowUId, $items, $now): array {
                    return $this->upsertChannelItems($rowUId, $items, $now);
                });

                $applied[] = [
                    'u_id' => $rowUId,
                    'uploads' => $uploads,
                    'api_items' => count($items),
                    'oldest_published_at' => collect($items)->pluck('publishedAt')->filter()->min(),
                    'newest_published_at' => collect($items)->pluck('publishedAt')->filter()->max(),
                    'video_upserts' => $result['video_upserts'],
                    'schedule_upserts' => $result['schedule_upserts'],
                    'live_upserts' => $result['live_upserts'],
                    'week_count' => $result['week_count'],
                    'final_vtime' => $result['final_vtime'],
                ];
            } catch (Throwable $exception) {
                $skipped[] = [
                    'u_id' => $rowUId,
                    'uploads' => $uploads,
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('Channel video discovery item processing failed.', [
                    'u_id' => $rowUId,
                    'reason' => 'item_processing_failed',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        $failedChannels = collect($skipped)->filter(
            fn (array $row): bool => in_array($row['reason'] ?? null, ['missing_uploads_playlist', 'playlist_api_error', 'item_processing_failed', 'quota_window_reset'], true),
        )->count();
        $apiRequestedFailures = collect($skipped)->filter(
            fn (array $row): bool => in_array($row['reason'] ?? null, ['playlist_api_error', 'item_processing_failed', 'quota_window_reset'], true),
        )->count();

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'api_requested_channels' => count($applied) + $apiRequestedFailures,
            'api_max_results_per_channel' => $maxResults,
            'updated_channels' => count($applied),
            'skipped_channels' => count($skipped),
            'failed_channels' => $failedChannels,
            'quota_window_reset' => $quotaWindowReset,
            'remaining_retry_rows' => $remainingRetryRows,
            'exit_code' => $failedChannels > 0 || $quotaWindowReset ? 1 : 0,
            'write_targets' => [
                'urt_channel.vtime',
                'urt_video.ctime',
                'urt_video.id',
                'urt_video.publishedAt',
                'urt_video.channelId',
                'urt_video.title',
                'urt_video.thumbnails',
                'urt_video.channelTitle',
                'urt_video.playlistId',
                'urt_video.position',
                'urt_video.videoId',
                'urt_video.u_id',
                'urt_video.description',
                'urt_video_schedule.ctime',
                'urt_video_schedule.videoId',
                'urt_video_schedule.publishedAt',
                'urt_video_live.ctime',
                'urt_video_live.videoId',
                'urt_video_live.publishedAt',
                'urt_video_live.u_id',
            ],
            'external_calls' => ['YouTube Data API playlistItems.list(part=snippet)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return array{video_upserts: int, schedule_upserts: int, live_upserts: int, week_count: int, final_vtime: string}
     */
    private function upsertChannelItems(int $uId, array $items, CarbonImmutable $now): array
    {
        $nowString = $now->format('Y-m-d H:i:s');
        $weekStart = $now->subDays(7);
        $oneHourLater = $now->addHour()->format('Y-m-d H:i:s');

        $this->updateExisting('urt_channel', 'u_id', $uId, ['vtime' => $oneHourLater]);

        $videoUpserts = 0;
        $scheduleUpserts = 0;
        $liveUpserts = 0;
        $weekCount = 0;

        foreach ($items as $item) {
            $publishedAt = $this->parsePublishedAt($item['publishedAt'] ?? null, $now);

            if ($publishedAt->greaterThanOrEqualTo($weekStart)) {
                $weekCount++;
            }

            $videoId = (string) ($item['videoId'] ?? '');

            if ($videoId === '') {
                continue;
            }

            $this->upsertByKeys('urt_video', ['videoId' => $videoId], [
                'ctime' => $nowString,
                'id' => (string) ($item['id'] ?? ''),
                'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                'channelId' => (string) ($item['channelId'] ?? ''),
                'title' => (string) ($item['title'] ?? ''),
                'thumbnails' => (string) ($item['thumbnails'] ?? ''),
                'channelTitle' => (string) ($item['channelTitle'] ?? ''),
                'playlistId' => (string) ($item['playlistId'] ?? ''),
                'position' => (int) ($item['position'] ?? 0),
                'u_id' => $uId,
                'description' => (string) ($item['description'] ?? ''),
            ]);
            $videoUpserts++;

            $this->upsertByKeys('urt_video_schedule', ['videoId' => $videoId], [
                'ctime' => $nowString,
                'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
            ]);
            $scheduleUpserts++;

            if ($this->isLiveCandidate($item)) {
                $this->upsertByKeys('urt_video_live', ['videoId' => $videoId], [
                    'ctime' => $nowString,
                    'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                    'u_id' => $uId,
                ]);
                $liveUpserts++;
            }
        }

        $finalVtime = $this->estimateNextVtime($now, $weekCount);
        $this->updateExisting('urt_channel', 'u_id', $uId, ['vtime' => $finalVtime]);

        return [
            'video_upserts' => $videoUpserts,
            'schedule_upserts' => $scheduleUpserts,
            'live_upserts' => $liveUpserts,
            'week_count' => $weekCount,
            'final_vtime' => $finalVtime,
        ];
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function isLiveCandidate(array $item): bool
    {
        $broadcast = (string) ($item['liveBroadcastContent'] ?? '');
        $thumbnail = (string) ($item['thumbnails'] ?? '');

        return in_array($broadcast, ['live', 'upcoming'], true)
            || str_contains($thumbnail, 'default_live.jpg');
    }

    private function parsePublishedAt(mixed $publishedAt, CarbonImmutable $now): CarbonImmutable
    {
        if (! is_string($publishedAt) || trim($publishedAt) === '') {
            return $now;
        }

        return CarbonImmutable::parse($publishedAt)->setTimezone($now->getTimezone());
    }

    private function estimateNextVtime(CarbonImmutable $now, int $weekCount): string
    {
        $interval = $weekCount > 0
            ? (86400 * 7 / $weekCount) / 3
            : 86400 * 7;

        $future = $now->addSeconds((int) $interval);

        if ((int) $future->format('H') < 8) {
            $interval += (8 - (int) $future->format('H')) * 3600;
        }

        if ($interval < 7200) {
            $interval = 7200;
        }

        return $now->addSeconds((int) $interval)->format('Y-m-d H:i:s');
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
}
