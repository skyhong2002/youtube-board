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
    private const REJECTED_ITEM_RETRY_MINUTES = 5;

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

        $applied = [];
        $skipped = [];
        $apiBatchesAttempted = 0;
        $apiBatchesCompleted = 0;
        $apiRequestedVideos = 0;
        $processedRows = 0;
        $quotaWindowReset = false;
        $remainingRetryRows = 0;

        foreach ($rows->chunk($batchSize) as $batchRows) {
            $apiBatchesAttempted++;
            $apiRequestedVideos += $batchRows->count();

            try {
                $statisticsByVideo = $this->youtube->videoStatistics(
                    $batchRows->pluck('video_id')->map(fn (mixed $id): string => (string) $id)->all(),
                );
                $apiBatchesCompleted++;
            } catch (YoutubeApiKeyPoolExhaustedException $exception) {
                $remainingRows = $rows->slice($processedRows)->values();
                $remainingRetryRows = $remainingRows->count();
                $skipped = [
                    ...$skipped,
                    ...$remainingRows->map(fn (array $row): array => [
                        'videoId' => (string) $row['video_id'],
                        'reason' => $exception->failureReason(),
                    ])->all(),
                ];
                Log::warning('Video statistics polling paused after all YouTube API keys failed.', [
                    'reason' => $exception->failureReason(),
                    'remaining_retry_rows' => $remainingRetryRows,
                    'api_batches_attempted' => $apiBatchesAttempted,
                    'exception_class' => $exception::class,
                ]);

                break;
            } catch (YoutubeQuotaWindowException $exception) {
                $quotaWindowReset = true;
                $remainingRows = $rows->slice($processedRows)->values();
                $remainingRetryRows = $remainingRows->count();
                $skipped = [
                    ...$skipped,
                    ...$remainingRows->map(fn (array $row): array => [
                        'videoId' => (string) $row['video_id'],
                        'reason' => 'quota_window_reset',
                    ])->all(),
                ];
                Log::warning('Video statistics polling paused at quota window reset.', [
                    'reason' => 'quota_window_reset',
                    'selected_rows' => $rows->count(),
                    'remaining_retry_rows' => $remainingRetryRows,
                    'api_batches_attempted' => $apiBatchesAttempted,
                    'exception_class' => $exception::class,
                ]);

                break;
            } catch (Throwable $exception) {
                $skipped = [
                    ...$skipped,
                    ...$batchRows->map(fn (array $row): array => [
                        'videoId' => (string) $row['video_id'],
                        'reason' => 'api_batch_failed',
                    ])->all(),
                ];
                $processedRows += $batchRows->count();
                Log::warning('Video statistics API batch failed.', [
                    'reason' => 'api_batch_failed',
                    'batch_rows' => $batchRows->count(),
                    'api_batches_attempted' => $apiBatchesAttempted,
                    'exception_class' => $exception::class,
                ]);

                continue;
            }

            foreach ($batchRows as $row) {
                $rowVideoId = (string) $row['video_id'];

                try {
                    $statistics = $statisticsByVideo[$rowVideoId] ?? null;

                    if ($statistics === null) {
                        $this->deferRejectedRow($row, $now);
                        $skipped[] = [
                            'videoId' => $rowVideoId,
                            'reason' => 'api_item_missing',
                        ];
                        Log::warning('Video statistics source item rejected.', [
                            'video_id' => $rowVideoId,
                            'reason' => 'api_item_missing',
                        ]);

                        continue;
                    }

                    $this->upsertStatistics($row, $statistics, $now);

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

            $processedRows += $batchRows->count();
        }

        return $this->summary(
            preview: $preview,
            applied: $applied,
            skipped: $skipped,
            now: $now,
            quotaWindowReset: $quotaWindowReset,
            remainingRetryRows: $remainingRetryRows,
            apiBatchesAttempted: $apiBatchesAttempted,
            apiBatchesCompleted: $apiBatchesCompleted,
            apiRequestedVideos: $apiRequestedVideos,
        );
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array{viewCount: int, likeCount: int|null, dislikeCount: int, favoriteCount: int|null, commentCount: int|null}  $statistics
     */
    private function upsertStatistics(array $row, array $statistics, CarbonImmutable $now): void
    {
        $videoId = (string) $row['video_id'];
        $nowString = $now->format('Y-m-d H:i:s');
        $month = $now->format('Y-m-01');
        $date = $now->toDateString();
        $publishedAt = (string) ($row['published_at'] ?? $nowString);
        $source = (string) ($row['source'] ?? 'urt_video_schedule');
        // Production legacy tables may be MyISAM, so validate and publish history before source freshness.
        $existingLog = Schema::hasTable('urt_video_log')
            ? DB::table('urt_video_log')->where('videoId', $videoId)->where('themonth', $month)->first()
            : null;
        $data = $existingLog !== null && property_exists($existingLog, 'thedata')
            ? json_decode((string) ($existingLog->thedata ?? ''), true, 512, JSON_THROW_ON_ERROR)
            : [];

        if (! is_array($data)) {
            throw new RuntimeException('Existing video statistics history JSON is not an object or array.');
        }

        $existingVideo = Schema::hasTable('urt_video')
            ? DB::table('urt_video')->where('videoId', $videoId)->first()
            : null;
        $existingSchedule = Schema::hasTable('urt_video_schedule')
            ? DB::table('urt_video_schedule')->where('videoId', $videoId)->first()
            : null;
        $nextCheckAt = $this->estimateNextCheck(
            previousObservation: $existingSchedule ?? $existingVideo,
            currentViewCount: $statistics['viewCount'],
            publishedAt: $publishedAt,
            now: $now,
        );
        $latestHistory = Schema::hasTable('urt_video_log_history')
            ? DB::table('urt_video_log_history')->where('videoId', $videoId)->orderByDesc('pk')->first()
            : null;
        $videoLikeCount = $this->firstKnownCount([
            $statistics['likeCount'],
            $existingVideo->likeCount ?? null,
            $existingSchedule->likeCount ?? null,
            $latestHistory->likeCount ?? null,
        ]);
        $scheduleLikeCount = $this->firstKnownCount([
            $statistics['likeCount'],
            $existingSchedule->likeCount ?? null,
            $existingVideo->likeCount ?? null,
            $latestHistory->likeCount ?? null,
        ]);
        $favoriteCount = $this->firstKnownCount([
            $statistics['favoriteCount'],
            $existingVideo->favoriteCount ?? null,
            $latestHistory->favoriteCount ?? null,
        ]);
        $videoCommentCount = $this->firstKnownCount([
            $statistics['commentCount'],
            $existingVideo->commentCount ?? null,
            $existingSchedule->commentCount ?? null,
            $latestHistory->commentCount ?? null,
        ]);
        $scheduleCommentCount = $this->firstKnownCount([
            $statistics['commentCount'],
            $existingSchedule->commentCount ?? null,
            $existingVideo->commentCount ?? null,
            $latestHistory->commentCount ?? null,
        ]);

        if ($statistics['viewCount'] + ($videoLikeCount ?? 0) > 0) {
            $point = is_array($data[$date] ?? null) ? $data[$date] : [];
            $point['view'] = $statistics['viewCount'];
            $point['dislike'] = $statistics['dislikeCount'];

            if ($videoLikeCount !== null) {
                $point['like'] = $videoLikeCount;
            }

            if ($videoCommentCount !== null) {
                $point['comment'] = $videoCommentCount;
            }

            $data[$date] = $point;
        }

        if ($videoLikeCount !== null && $favoriteCount !== null && $videoCommentCount !== null) {
            $this->upsertByKeys('urt_video_log_history', ['videoId' => $videoId, 'ctime' => $nowString], [
                'viewCount' => $statistics['viewCount'],
                'likeCount' => $videoLikeCount,
                'dislikeCount' => $statistics['dislikeCount'],
                'favoriteCount' => $favoriteCount,
                'commentCount' => $videoCommentCount,
            ]);
        }

        $logValues = [
            'mtime' => $nowString,
            'thedata' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];

        if ($existingLog === null) {
            $logValues['ctime'] = $nowString;
        }

        $this->upsertByKeys('urt_video_log', ['videoId' => $videoId, 'themonth' => $month], $logValues);

        $scheduleValues = [
            'ctime' => $nowString,
            'mtime' => $nowString,
            'stime' => $nextCheckAt,
            'publishedAt' => $publishedAt,
            'viewCount' => $statistics['viewCount'],
        ];
        $videoValues = [
            'mtime' => $nowString,
            'stime' => $nextCheckAt,
            'publishedAt' => $publishedAt,
            'viewCount' => $statistics['viewCount'],
            'dislikeCount' => $statistics['dislikeCount'],
        ];

        if ($scheduleLikeCount !== null) {
            $scheduleValues['likeCount'] = $scheduleLikeCount;
        }

        if ($videoLikeCount !== null) {
            $videoValues['likeCount'] = $videoLikeCount;
        }

        if ($favoriteCount !== null) {
            $videoValues['favoriteCount'] = $favoriteCount;
        }

        if ($scheduleCommentCount !== null) {
            $scheduleValues['commentCount'] = $scheduleCommentCount;
        }

        if ($videoCommentCount !== null) {
            $videoValues['commentCount'] = $videoCommentCount;
        }

        if ($source === 'urt_video') {
            $this->upsertByKeys('urt_video_schedule', ['videoId' => $videoId], $scheduleValues);
            $this->updateByKeys('urt_video', ['videoId' => $videoId], $videoValues);

            return;
        }

        $this->updateByKeys('urt_video', ['videoId' => $videoId], collect($videoValues)->except(['mtime', 'stime'])->all());
        $this->upsertByKeys('urt_video_schedule', ['videoId' => $videoId], $scheduleValues);
    }

    private function estimateNextCheck(
        ?object $previousObservation,
        int $currentViewCount,
        string $publishedAt,
        CarbonImmutable $now,
    ): string {
        $timezone = $now->getTimezone();
        $previousTime = null;
        $previousViewCount = 0;

        if ($previousObservation !== null && ($previousObservation->mtime ?? null) !== null) {
            try {
                $candidateTime = CarbonImmutable::parse((string) $previousObservation->mtime, $timezone);
                $candidateViewCount = $this->firstKnownCount([$previousObservation->viewCount ?? null]);

                if ($candidateTime->lessThan($now) && $candidateViewCount !== null) {
                    $previousTime = $candidateTime;
                    $previousViewCount = $candidateViewCount;
                }
            } catch (Throwable) {
                $previousTime = null;
            }
        }

        if ($previousTime === null) {
            try {
                $previousTime = CarbonImmutable::parse($publishedAt, $timezone);
            } catch (Throwable) {
                $previousTime = $now->subHours(2);
            }

            if (! $previousTime->lessThan($now)) {
                $previousTime = $now->subHours(2);
            }
        }

        $viewDelta = max(1, $currentViewCount - $previousViewCount);
        $periodSeconds = max(1, $now->getTimestamp() - $previousTime->getTimestamp() + 1);
        $viewsPerHour = $viewDelta / ($periodSeconds / 3600);
        $hoursPerThousandViews = $viewsPerHour > 0 ? 1000 / $viewsPerHour : 3000;

        if ($hoursPerThousandViews > 1000) {
            $hoursPerThousandViews = 3000;
        }

        if ($hoursPerThousandViews < 2) {
            $hoursPerThousandViews = 2;
        }

        return $now
            ->addSeconds((int) round($hoursPerThousandViews * 3600))
            ->format('Y-m-d H:i:s');
    }

    /**
     * @param  list<mixed>  $values
     */
    private function firstKnownCount(array $values): ?int
    {
        foreach ($values as $value) {
            if (is_int($value) && $value >= 0) {
                return $value;
            }

            if (is_string($value) && preg_match('/^\d+$/D', $value) === 1) {
                return (int) $value;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function deferRejectedRow(array $row, CarbonImmutable $now): void
    {
        $source = (string) ($row['source'] ?? 'urt_video_schedule');
        $table = $source === 'urt_video' ? 'urt_video' : 'urt_video_schedule';
        $keys = isset($row['pk']) && (int) $row['pk'] > 0
            ? ['pk' => (int) $row['pk']]
            : ['videoId' => (string) ($row['video_id'] ?? '')];

        $this->updateByKeys($table, $keys, [
            'stime' => $now->addMinutes(self::REJECTED_ITEM_RETRY_MINUTES)->format('Y-m-d H:i:s'),
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

        DB::table($table)->insert($keys + $values);
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
        int $apiBatchesAttempted = 0,
        int $apiBatchesCompleted = 0,
        int $apiRequestedVideos = 0,
    ): array {
        $failedVideos = collect($skipped)->whereIn('reason', [
            'api_batch_failed',
            'api_item_missing',
            'item_processing_failed',
            'quota_window_reset',
            YoutubeApiKeyPoolExhaustedException::AUTHENTICATION_FAILURE,
            YoutubeApiKeyPoolExhaustedException::QUOTA_FAILURE,
        ])->count();

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'batch_size' => (int) ($preview['batch_size'] ?? 1),
            'loops' => (int) ($preview['loops'] ?? 1),
            'api_batches_attempted' => $apiBatchesAttempted,
            'api_batches_completed' => $apiBatchesCompleted,
            'api_requested_videos' => $apiRequestedVideos,
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
