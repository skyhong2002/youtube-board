<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class ChannelStatisticsIngestion
{
    public function __construct(
        private readonly ChannelStatisticsPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(?int $uId = null, int $hours = 22, int $limit = 1, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(5, $limit));

        $preview = $this->preview->preview(uId: $uId, hours: $hours, limit: $limit, now: $now);
        $rows = collect($preview['rows'] ?? [])
            ->filter(fn (array $row): bool => trim((string) ($row['youtube_id'] ?? '')) !== '')
            ->values();

        if ($rows->isEmpty()) {
            return $this->summary($preview, [], [], $now);
        }

        $channelIds = $rows->pluck('youtube_id')->map(fn (mixed $id): string => (string) $id)->all();
        $statisticsByChannel = $this->youtube->channelStatistics($channelIds);
        $applied = [];
        $skipped = [];

        foreach ($rows as $row) {
            $youtubeId = (string) $row['youtube_id'];
            $statistics = $statisticsByChannel[$youtubeId] ?? null;

            if ($statistics === null) {
                $skipped[] = [
                    'u_id' => (int) $row['u_id'],
                    'youtube_id' => $youtubeId,
                    'reason' => 'api_item_missing',
                ];

                continue;
            }

            if ($statistics['viewCount'] <= 0) {
                $skipped[] = [
                    'u_id' => (int) $row['u_id'],
                    'youtube_id' => $youtubeId,
                    'reason' => 'viewCount_not_positive',
                ];

                continue;
            }

            DB::transaction(function () use ($row, $statistics, $now): void {
                $this->upsertStatistics((int) $row['u_id'], $statistics, $now);
            });

            $applied[] = [
                'u_id' => (int) $row['u_id'],
                'youtube_id' => $youtubeId,
                'viewCount' => $statistics['viewCount'],
                'subscriberCount' => $statistics['subscriberCount'],
                'videoCount' => $statistics['videoCount'],
            ];
        }

        return $this->summary($preview, $applied, $skipped, $now);
    }

    /**
     * @param  array{viewCount: int, subscriberCount: int, hiddenSubscriberCount: bool, videoCount: int}  $statistics
     */
    private function upsertStatistics(int $uId, array $statistics, CarbonImmutable $now): void
    {
        $nowString = $now->format('Y-m-d H:i:s');
        $month = $now->format('Y-m-01');
        $date = $now->toDateString();

        $this->updateExisting('urt_channel', 'u_id', $uId, [
            'stime' => $nowString,
            'mtime' => $nowString,
            'viewCount' => $statistics['viewCount'],
            'subscriberCount' => $statistics['subscriberCount'],
            'videoCount' => $statistics['videoCount'],
        ]);

        $this->upsertByKeys('urt_count', ['u_id' => $uId], [
            'mtime' => $nowString,
            'viewCount' => $statistics['viewCount'],
            'subscriberCount' => $statistics['subscriberCount'],
            'videoCount' => $statistics['videoCount'],
        ]);

        $existingLog = Schema::hasTable('urt_log')
            ? DB::table('urt_log')->where('u_id', $uId)->where('themonth', $month)->first()
            : null;
        $data = $existingLog !== null && property_exists($existingLog, 'thedata')
            ? json_decode((string) ($existingLog->thedata ?? ''), true)
            : [];
        $data = is_array($data) ? $data : [];
        $data[$date] = [
            'view' => $statistics['viewCount'],
            'subscriber' => $statistics['subscriberCount'],
            'video' => $statistics['videoCount'],
        ];

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
    private function summary(array $preview, array $applied, array $skipped, CarbonImmutable $now): array
    {
        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'api_requested_rows' => count($applied) + count($skipped),
            'updated_rows' => count($applied),
            'skipped_rows' => count($skipped),
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
