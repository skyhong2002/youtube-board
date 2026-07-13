<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class VideoStatisticsIngestion
{
    public function __construct(
        private readonly VideoStatisticsPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $videoId = null,
        bool $today = false,
        int $batchSize = 1,
        int $loops = 1,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $batchSize = max(1, min(50, $batchSize));
        $loops = max(1, min(31, $loops));
        $preview = $this->preview->preview(
            videoId: $videoId,
            today: $today,
            batchSize: $batchSize,
            loops: $loops,
            now: $now,
        );
        $rows = collect($preview['rows'] ?? [])
            ->filter(fn (array $row): bool => trim((string) ($row['video_id'] ?? '')) !== '')
            ->values();

        if (! (bool) ($preview['would_call_api'] ?? false) || $rows->isEmpty()) {
            return $this->summary($preview, [], [], $now);
        }

        try {
            $statisticsByVideo = $this->youtube->videoStatistics(
                $rows->pluck('video_id')->map(fn (mixed $id): string => (string) $id)->all(),
            );
        } catch (YoutubeQuotaWindowException $exception) {
            $skipped = $rows->map(fn (array $row): array => [
                'videoId' => (string) $row['video_id'],
                'reason' => 'quota_window_reset',
            ])->all();
            Log::warning('Video statistics polling paused at quota window reset.', [
                'reason' => 'quota_window_reset',
                'selected_rows' => $rows->count(),
                'exception_class' => $exception::class,
            ]);

            return $this->summary($preview, [], $skipped, $now, true, $rows->count());
        }
        $applied = [];
        $skipped = [];

        foreach ($rows as $row) {
            $rowVideoId = (string) $row['video_id'];

            try {
                $statistics = $statisticsByVideo[$rowVideoId] ?? null;

                if ($statistics === null) {
                    $skipped[] = [
                        'videoId' => $rowVideoId,
                        'reason' => 'api_item_missing',
                    ];

                    continue;
                }

                DB::transaction(function () use ($row, $statistics, $now): void {
                    $this->upsertStatistics($row, $statistics, $now);
                });

                $applied[] = [
                    'videoId' => $rowVideoId,
                    'viewCount' => $statistics['viewCount'],
                    'likeCount' => $statistics['likeCount'],
                    'commentCount' => $statistics['commentCount'],
                ];
            } catch (Throwable $exception) {
                $skipped[] = [
                    'videoId' => $rowVideoId,
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('Video statistics item processing failed.', [
                    'video_id' => $rowVideoId,
                    'reason' => 'item_processing_failed',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        return $this->summary($preview, $applied, $skipped, $now);
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array{viewCount: int, likeCount: int, dislikeCount: int, favoriteCount: int, commentCount: int}  $statistics
     */
    private function upsertStatistics(array $row, array $statistics, CarbonImmutable $now): void
    {
        $videoId = (string) $row['video_id'];
        $nowString = $now->format('Y-m-d H:i:s');
        $month = $now->format('Y-m-01');
        $date = $now->toDateString();
        $reserveUntil = $now->addDays(30)->format('Y-m-d H:i:s');
        $publishedAt = (string) ($row['published_at'] ?? $nowString);

        $this->upsertByKeys('urt_video_log_history', ['videoId' => $videoId, 'ctime' => $nowString], [
            'viewCount' => $statistics['viewCount'],
            'likeCount' => $statistics['likeCount'],
            'dislikeCount' => $statistics['dislikeCount'],
            'favoriteCount' => $statistics['favoriteCount'],
            'commentCount' => $statistics['commentCount'],
        ]);

        $this->upsertByKeys('urt_video_schedule', ['videoId' => $videoId], [
            'ctime' => $nowString,
            'mtime' => $nowString,
            'stime' => $reserveUntil,
            'publishedAt' => $publishedAt,
            'viewCount' => $statistics['viewCount'],
            'likeCount' => $statistics['likeCount'],
            'commentCount' => $statistics['commentCount'],
        ]);

        $existingLog = Schema::hasTable('urt_video_log')
            ? DB::table('urt_video_log')->where('videoId', $videoId)->where('themonth', $month)->first()
            : null;
        $data = $existingLog !== null && property_exists($existingLog, 'thedata')
            ? json_decode((string) ($existingLog->thedata ?? ''), true)
            : [];
        $data = is_array($data) ? $data : [];

        if ($statistics['viewCount'] + $statistics['likeCount'] > 0) {
            $data[$date] = [
                'view' => $statistics['viewCount'],
                'like' => $statistics['likeCount'],
                'dislike' => $statistics['dislikeCount'],
                'comment' => $statistics['commentCount'],
            ];
        }

        $logValues = [
            'mtime' => $nowString,
            'thedata' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];

        if ($existingLog === null) {
            $logValues['ctime'] = $nowString;
        }

        $this->upsertByKeys('urt_video_log', ['videoId' => $videoId, 'themonth' => $month], $logValues);

        $this->updateByKeys('urt_video', ['videoId' => $videoId], [
            'mtime' => $nowString,
            'stime' => $reserveUntil,
            'publishedAt' => $publishedAt,
            'viewCount' => $statistics['viewCount'],
            'likeCount' => $statistics['likeCount'],
            'dislikeCount' => $statistics['dislikeCount'],
            'favoriteCount' => $statistics['favoriteCount'],
            'commentCount' => $statistics['commentCount'],
        ]);
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

        $insert = $keys + $values;

        if (Schema::hasColumn($table, 'pk') && ! array_key_exists('pk', $insert)) {
            $insert['pk'] = ((int) DB::table($table)->max('pk')) + 1;
        }

        DB::table($table)->insert($insert);
    }

    /**
     * @param  array<string, mixed>  $keys
     * @param  array<string, mixed>  $values
     */
    private function updateByKeys(string $table, array $keys, array $values): void
    {
        if (! Schema::hasTable($table)) {
            throw new RuntimeException("Missing local table: {$table}");
        }

        $keys = $this->onlyExistingColumns($table, $keys);
        $values = $this->onlyExistingColumns($table, $values);

        if ($keys === []) {
            throw new RuntimeException("No usable key columns for {$table}");
        }

        if ($values === []) {
            return;
        }

        $query = DB::table($table);

        foreach ($keys as $column => $value) {
            $query->where($column, $value);
        }

        if ($query->exists()) {
            $query->update($values);
        }
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
    ): array {
        $failedVideos = collect($skipped)->whereIn('reason', ['item_processing_failed', 'quota_window_reset'])->count();

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'api_requested_videos' => count($applied) + count($skipped),
            'updated_videos' => count($applied),
            'skipped_videos' => count($skipped),
            'failed_videos' => $failedVideos,
            'quota_window_reset' => $quotaWindowReset,
            'remaining_retry_rows' => $remainingRetryRows,
            'exit_code' => $failedVideos > 0 || $quotaWindowReset ? 1 : 0,
            'write_targets' => [
                'urt_video_schedule.stime',
                'urt_video_schedule.mtime',
                'urt_video_schedule.viewCount',
                'urt_video_schedule.likeCount',
                'urt_video_schedule.commentCount',
                'urt_video_log_history.ctime',
                'urt_video_log_history.videoId',
                'urt_video_log_history.viewCount',
                'urt_video_log_history.likeCount',
                'urt_video_log_history.dislikeCount',
                'urt_video_log_history.favoriteCount',
                'urt_video_log_history.commentCount',
                'urt_video_log.ctime',
                'urt_video_log.mtime',
                'urt_video_log.thedata',
                'urt_video.mtime',
                'urt_video.stime',
                'urt_video.viewCount',
                'urt_video.likeCount',
                'urt_video.dislikeCount',
                'urt_video.favoriteCount',
                'urt_video.commentCount',
            ],
            'external_calls' => ['YouTube Data API videos.list(part=statistics)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }
}
