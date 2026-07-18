<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class TvbsLivePollingIngestion
{
    public function __construct(
        private readonly TvbsLivePollingPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $videoId = null,
        int $intervalMinutes = 11,
        int $staleSeconds = 40,
        int $limit = 1,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $intervalMinutes = max(1, min(240, $intervalMinutes));
        $staleSeconds = max(10, min(3600, $staleSeconds));
        $limit = max(1, min(50, $limit));
        $preview = $this->preview->preview(
            videoId: $videoId,
            intervalMinutes: $intervalMinutes,
            staleSeconds: $staleSeconds,
            limit: $limit,
            now: $now,
        );
        $rows = collect($preview['rows'] ?? [])
            ->filter(fn (array $row): bool => trim((string) ($row['video_id'] ?? '')) !== '')
            ->values();

        if (! (bool) ($preview['would_call_api'] ?? false) || $rows->isEmpty()) {
            return $this->summary($preview, [], [], $now);
        }

        try {
            $detailsByVideo = $this->youtube->videoLiveStreamingDetails(
                $rows->pluck('video_id')->map(fn (mixed $id): string => (string) $id)->all(),
            );
        } catch (YoutubeApiKeyPoolExhaustedException $exception) {
            $skipped = $rows->map(fn (array $row): array => [
                'videoId' => (string) $row['video_id'],
                'reason' => $exception->failureReason(),
            ])->all();
            Log::warning('TVBS live polling paused after all YouTube API keys failed.', [
                'reason' => $exception->failureReason(),
                'selected_rows' => $rows->count(),
                'exception_class' => $exception::class,
            ]);

            return $this->summary($preview, [], $skipped, $now, false, $rows->count());
        } catch (YoutubeQuotaWindowException $exception) {
            $skipped = $rows->map(fn (array $row): array => [
                'videoId' => (string) $row['video_id'],
                'reason' => 'quota_window_reset',
            ])->all();
            Log::warning('TVBS live polling paused at quota window reset.', [
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
                $details = $detailsByVideo[$rowVideoId] ?? null;

                if ($details === null) {
                    // A present-but-unusable item stays due for retry; only an
                    // id absent from the successful response means the video
                    // no longer exists and can be retired.
                    $present = array_key_exists($rowVideoId, $detailsByVideo);
                    $skipped[] = [
                        'videoId' => $rowVideoId,
                        'reason' => $present ? 'api_item_invalid' : 'api_item_missing',
                        'unlisted' => $present ? false : $this->unlistMissingVideo($rowVideoId, $now),
                    ];

                    continue;
                }

                $this->updateLiveRowAndLog($row, $details, $now);

                $applied[] = [
                    'videoId' => $rowVideoId,
                    'concurrentViewers' => isset($details['concurrentViewers']) ? (int) $details['concurrentViewers'] : null,
                    'actualStartTime' => $this->apiTime($details['actualStartTime'] ?? null, $now),
                    'actualEndTime' => $this->apiTime($details['actualEndTime'] ?? null, $now),
                    'scheduledStartTime' => $this->apiTime($details['scheduledStartTime'] ?? null, $now),
                    'activeLiveChatId' => isset($details['activeLiveChatId']) ? (string) $details['activeLiveChatId'] : null,
                    'loggedMinute' => isset($details['concurrentViewers']) ? $now->format('H:i') : null,
                ];
            } catch (Throwable $exception) {
                $skipped[] = [
                    'videoId' => $rowVideoId,
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('TVBS live polling item processing failed.', [
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
     * @param  array<string, mixed>  $details
     */
    /**
     * A successful videos.list response that omits a selected id means the
     * video no longer exists on YouTube. Leaving the row due would reselect
     * it on every scheduled minute forever, so mark it unlisted the same way
     * youtube:live:cleanup retires stale live rows.
     */
    private function unlistMissingVideo(string $videoId, CarbonImmutable $now): bool
    {
        try {
            if (! Schema::hasTable('urt_video_live_tvbs')
                || ! Schema::hasColumn('urt_video_live_tvbs', 'del_flag')) {
                Log::warning('TVBS live polling cannot unlist missing video.', [
                    'video_id' => $videoId,
                    'reason' => 'api_item_missing',
                    'unlist_blocked_reason' => 'missing_del_flag_column',
                ]);

                return false;
            }

            DB::table('urt_video_live_tvbs')
                ->where('videoId', $videoId)
                ->update($this->onlyExistingColumns('urt_video_live_tvbs', [
                    'del_flag' => 1,
                    'mtime' => $now->format('Y-m-d H:i:s'),
                ]));
            Log::warning('TVBS live polling unlisted a video missing from the API response.', [
                'video_id' => $videoId,
                'reason' => 'api_item_missing',
                'write' => 'urt_video_live_tvbs.del_flag=1',
            ]);

            return true;
        } catch (Throwable $exception) {
            Log::warning('TVBS live polling failed to unlist a missing video.', [
                'video_id' => $videoId,
                'reason' => 'api_item_missing',
                'exception_class' => $exception::class,
            ]);

            return false;
        }
    }

    private function updateLiveRowAndLog(array $row, array $details, CarbonImmutable $now): void
    {
        if (! Schema::hasTable('urt_video_live_tvbs')) {
            throw new RuntimeException('Missing local table: urt_video_live_tvbs');
        }

        $videoId = (string) $row['video_id'];
        $nowString = $now->format('Y-m-d H:i:s');
        $liveValues = [
            'mtime' => $nowString,
            'actualStartTime' => $this->apiTime($details['actualStartTime'] ?? null, $now),
            'actualEndTime' => $this->apiTime($details['actualEndTime'] ?? null, $now),
            'scheduledStartTime' => $this->apiTime($details['scheduledStartTime'] ?? null, $now),
            'activeLiveChatId' => isset($details['activeLiveChatId']) ? (string) $details['activeLiveChatId'] : null,
        ];

        if (isset($details['concurrentViewers'])) {
            $concurrentViewers = (int) $details['concurrentViewers'];
            $liveValues['concurrentViewers'] = $concurrentViewers;

            if ($concurrentViewers > (int) ($row['max_current'] ?? 0)) {
                $liveValues['max_current'] = $concurrentViewers;
            }
        }

        if (isset($details['concurrentViewers'])) {
            // Keep the source row due if a later write fails on non-transactional production tables.
            $this->upsertLogPoint(
                videoId: $videoId,
                uId: $row['u_id'] !== null ? (int) $row['u_id'] : null,
                concurrentViewers: (int) $details['concurrentViewers'],
                now: $now,
            );
        }

        DB::table('urt_video_live_tvbs')
            ->where('videoId', $videoId)
            ->update($this->onlyExistingColumns('urt_video_live_tvbs', collect($liveValues)->filter(fn (mixed $value): bool => $value !== null)->all()));
    }

    private function upsertLogPoint(string $videoId, ?int $uId, int $concurrentViewers, CarbonImmutable $now): void
    {
        if (! Schema::hasTable('urt_video_live_log_tvbs')) {
            throw new RuntimeException('Missing local table: urt_video_live_log_tvbs');
        }

        $today = $now->toDateString();
        $nowString = $now->format('Y-m-d H:i:s');
        $minute = $now->format('H:i');
        $row = DB::table('urt_video_live_log_tvbs')
            ->where('videoId', $videoId)
            ->where('the_date', $today)
            ->first();

        if ($row === null) {
            DB::table('urt_video_live_log_tvbs')->insert($this->onlyExistingColumns('urt_video_live_log_tvbs', [
                'ctime' => $nowString,
                'videoId' => $videoId,
                'the_date' => $today,
                'u_id' => $uId,
                'log_json' => json_encode([], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]));
            $data = [];
        } else {
            $data = json_decode((string) ($row->log_json ?? ''), true, 512, JSON_THROW_ON_ERROR);

            if (! is_array($data)) {
                throw new RuntimeException('Existing TVBS live polling history JSON is not an object or array.');
            }
        }

        $data[$minute] = $concurrentViewers;
        $maxCurrent = max(array_map('intval', $data));

        DB::table('urt_video_live_log_tvbs')
            ->where('videoId', $videoId)
            ->where('the_date', $today)
            ->update($this->onlyExistingColumns('urt_video_live_log_tvbs', [
                'mtime' => $nowString,
                'log_json' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'max_current' => $maxCurrent,
            ]));
    }

    private function apiTime(mixed $value, CarbonImmutable $now): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        return CarbonImmutable::parse($value)->setTimezone($now->getTimezone())->format('Y-m-d H:i:s');
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
        $failedVideos = collect($skipped)->whereIn('reason', [
            'api_item_missing',
            'api_item_invalid',
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
            'api_requested_videos' => count($applied) + count($skipped),
            'updated_videos' => count($applied),
            'skipped_videos' => count($skipped),
            'failed_videos' => $failedVideos,
            'unlisted_videos' => collect($skipped)->where('unlisted', true)->count(),
            'quota_window_reset' => $quotaWindowReset,
            'remaining_retry_rows' => $remainingRetryRows,
            'exit_code' => $failedVideos > 0 || $quotaWindowReset ? 1 : 0,
            'write_targets' => [
                'urt_video_live_tvbs.del_flag',
                'urt_video_live_tvbs.mtime',
                'urt_video_live_tvbs.actualStartTime',
                'urt_video_live_tvbs.actualEndTime',
                'urt_video_live_tvbs.scheduledStartTime',
                'urt_video_live_tvbs.activeLiveChatId',
                'urt_video_live_tvbs.concurrentViewers',
                'urt_video_live_tvbs.max_current',
                'urt_video_live_log_tvbs.ctime',
                'urt_video_live_log_tvbs.videoId',
                'urt_video_live_log_tvbs.the_date',
                'urt_video_live_log_tvbs.u_id',
                'urt_video_live_log_tvbs.mtime',
                'urt_video_live_log_tvbs.log_json',
                'urt_video_live_log_tvbs.max_current',
            ],
            'external_calls' => ['YouTube Data API videos.list(part=liveStreamingDetails)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }
}
