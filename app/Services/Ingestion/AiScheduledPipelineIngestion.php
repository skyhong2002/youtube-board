<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AiScheduledPipelineIngestion
{
    public function __construct(
        private readonly TagVideoBackfillIngestion $tagVideoBackfill,
        private readonly ChannelVideosDiscoveryIngestion $channelVideos,
        private readonly DirectYoutubeQuotaGuard $quotaGuard,
        private readonly AiDailyPreview $dailyPreview,
        private readonly AiDailyIngestion $dailyIngestion,
        private readonly AiHourlyPreview $hourlyPreview,
        private readonly AiHourlyIngestion $hourlyIngestion,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function previewDaily(
        ?string $date = null,
        int $channelLimit = 39,
        int $channelBatchSize = 12,
        int $aiCallLimit = 45,
        int $channelVideoLimit = 120,
        int $limit = 1000,
    ): array {
        $now = $this->now();
        $date = $this->date($date, $now);
        $executionCaps = $this->dailyExecutionCaps(
            limit: $limit,
            channelLimit: $channelLimit,
            channelBatchSize: $channelBatchSize,
            aiCallLimit: $aiCallLimit,
            channelVideoLimit: $channelVideoLimit,
        );
        $sourceRefresh = $this->tagVideoBackfill->run(
            tagIds: [102],
            from: $date,
            to: $date,
            limit: 100,
            maxPages: 20,
            maxResults: 50,
            execute: false,
            now: $now,
        );

        return [
            'mode' => 'ingestion-preview',
            'source' => 'ai_daily_source_first_pipeline',
            'date' => $date,
            'execution_caps' => $executionCaps,
            'source_refresh' => $this->dailySourcePreview($sourceRefresh),
            'ai' => $this->dailyPreview->preview(
                date: $date,
                dataType: 'oneday',
                limit: $executionCaps['limit'],
                now: $now,
                includePrompts: false,
                channelLimit: $executionCaps['channel_limit'],
                channelBatchSize: $executionCaps['channel_batch_size'],
                aiCallLimit: $executionCaps['ai_call_limit'],
                channelVideoLimit: $executionCaps['channel_video_limit'],
            ),
            'writes' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function executeDaily(
        ?string $date = null,
        int $channelLimit = 39,
        int $channelBatchSize = 12,
        int $aiCallLimit = 45,
        int $channelVideoLimit = 120,
        int $limit = 1000,
        string $userToken = 'CLI',
    ): array {
        $now = $this->now();
        $date = $this->date($date, $now);
        $sourceRun = $this->quotaGuard->run(
            jobKey: 'youtube.tag_videos.backfill',
            effectiveCommand: 'youtube:tag-videos:backfill --execute --limit=100 --max-pages=20 --max-results=50',
            callback: fn (): array => $this->tagVideoBackfill->run(
                tagIds: [102],
                from: $date,
                to: $date,
                limit: 100,
                maxPages: 20,
                maxResults: 50,
                execute: true,
                now: $now,
            ),
        );
        $source = $this->sourceResult(
            $sourceRun,
            'daily_uploads_backfill',
            AiDailyPreview::channelAiUids(),
        );

        if (! $source['succeeded']) {
            return $this->blocked('ai_daily_source_first_pipeline', $date, $source);
        }

        $ai = $this->dailyIngestion->execute(
            date: $date,
            dataType: 'oneday',
            limit: $limit,
            channelLimit: $channelLimit,
            channelBatchSize: $channelBatchSize,
            aiCallLimit: $aiCallLimit,
            channelVideoLimit: $channelVideoLimit,
            userToken: $userToken,
        );
        $exitCode = (int) ($ai['exit_code'] ?? 1);

        return [
            'mode' => 'execute',
            'status' => $exitCode === 0 ? 'success' : 'partial_failure',
            'exit_code' => $exitCode,
            'failed_rows' => (int) ($ai['failed_rows'] ?? ($exitCode === 0 ? 0 : 1)),
            'source' => 'ai_daily_source_first_pipeline',
            'date' => $date,
            'source_refresh' => $source,
            'ai' => $ai,
            'write_targets' => array_values(array_unique([
                'urt_video',
                'urt_video_schedule',
                'urt_video_live',
                'urt_show_tag_date',
                ...($ai['write_targets'] ?? []),
            ])),
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function previewHourly(
        ?string $condition = null,
        int $hour = 1,
        int $period = 1,
        int $limit = 20,
        int $promptVideoLimit = AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT,
        ?CarbonInterface $now = null,
    ): array {
        $now = $this->normalizeNow($now);
        $ai = $this->hourlyPreview->preview(
            condition: $condition,
            hour: $hour,
            period: $period,
            limit: $limit,
            promptVideoLimit: $promptVideoLimit,
            now: $now,
        );

        return [
            'mode' => 'ingestion-preview',
            'status' => (int) ($ai['exit_code'] ?? 0) === 0 ? 'success' : 'blocked',
            'exit_code' => (int) ($ai['exit_code'] ?? 0),
            'source' => 'ai_hourly_source_first_pipeline',
            'date_from' => $ai['date_from'],
            'date_to' => $ai['date_to'],
            'source_refresh' => [
                'configured_channels' => count(AiDailyPreview::channelAiUids()),
                'existing_channels' => Schema::hasTable('urt_channel')
                    ? DB::table('urt_channel')->whereIn('u_id', AiDailyPreview::channelAiUids())->count()
                    : 0,
                'max_results_per_channel' => 50,
                'would_call_youtube_requests' => count(AiDailyPreview::channelAiUids()),
            ],
            'ai' => $ai,
            'writes' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function executeHourly(
        ?string $condition = null,
        int $hour = 1,
        int $period = 1,
        int $limit = 20,
        int $sourceMaxResults = 50,
        int $promptVideoLimit = AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT,
        string $userToken = 'cli',
        ?CarbonInterface $now = null,
    ): array {
        $now = $this->normalizeNow($now);
        $preview = $this->hourlyPreview->preview(
            condition: $condition,
            hour: $hour,
            period: $period,
            limit: $limit,
            promptVideoLimit: $promptVideoLimit,
            now: $now,
        );
        $windowFrom = CarbonImmutable::parse((string) $preview['date_from'], $now->getTimezone());
        $sourceMaxResults = max(1, min(50, $sourceMaxResults));
        $sourceRun = $this->quotaGuard->run(
            jobKey: 'youtube.channels.videos.general',
            effectiveCommand: sprintf(
                'youtube:channels:videos --execute --limit=%d --max-results=%d',
                count(AiDailyPreview::channelAiUids()),
                $sourceMaxResults,
            ),
            callback: fn (): array => $this->refreshHourlySources($windowFrom, $sourceMaxResults, $now),
        );
        $source = $this->sourceResult($sourceRun, 'hourly_uploads_refresh');

        if (! $source['succeeded']) {
            return $this->blocked('ai_hourly_source_first_pipeline', substr((string) $preview['date_from'], 0, 10), $source, [
                'date_from' => $preview['date_from'],
                'date_to' => $preview['date_to'],
            ]);
        }

        $ai = $this->hourlyIngestion->execute(
            condition: $condition,
            hour: $hour,
            period: $period,
            limit: $limit,
            promptVideoLimit: $promptVideoLimit,
            userToken: $userToken,
            now: $now,
        );
        $exitCode = (int) ($ai['exit_code'] ?? 1);

        return [
            'mode' => 'execute',
            'status' => $exitCode === 0 ? 'success' : 'partial_failure',
            'exit_code' => $exitCode,
            'failed_rows' => (int) ($ai['failed_rows'] ?? ($exitCode === 0 ? 0 : 1)),
            'source' => 'ai_hourly_source_first_pipeline',
            'date_from' => $preview['date_from'],
            'date_to' => $preview['date_to'],
            'source_refresh' => $source,
            'ai' => $ai,
            'write_targets' => array_values(array_unique([
                'urt_video',
                'urt_video_schedule',
                'urt_video_live',
                ...($ai['write_targets'] ?? []),
            ])),
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function refreshHourlySources(CarbonImmutable $windowFrom, int $maxResults, CarbonImmutable $now): array
    {
        $rows = [];

        foreach (AiDailyPreview::channelAiUids() as $uId) {
            $result = $this->channelVideos->execute(
                uId: $uId,
                limit: 1,
                maxResults: $maxResults,
                now: $now,
            );
            $applied = $result['applied'][0] ?? null;
            $oldest = is_array($applied) && is_string($applied['oldest_published_at'] ?? null)
                ? CarbonImmutable::parse($applied['oldest_published_at'], $now->getTimezone())
                : null;
            $apiItems = (int) ($applied['api_items'] ?? 0);
            $windowComplete = (int) ($result['exit_code'] ?? 1) === 0
                && is_array($applied)
                && ($apiItems < $maxResults || ($oldest !== null && $oldest->lessThanOrEqualTo($windowFrom)));

            $rows[] = [
                'u_id' => $uId,
                'api_items' => $apiItems,
                'oldest_published_at' => $oldest?->format('Y-m-d H:i:s'),
                'window_complete' => $windowComplete,
                'failed' => ! $windowComplete,
                'failure_reason' => $windowComplete
                    ? null
                    : ((int) ($result['exit_code'] ?? 1) !== 0 ? 'channel_refresh_failed' : 'source_window_exceeds_page_cap'),
            ];
        }

        $failedRows = collect($rows)->where('failed', true)->count();

        return [
            'mode' => 'execute',
            'status' => $failedRows === 0 ? 'success' : 'partial_failure',
            'exit_code' => $failedRows === 0 ? 0 : 1,
            'failed_rows' => $failedRows,
            'configured_channels' => count($rows),
            'completed_channels' => count($rows) - $failedRows,
            'max_results_per_channel' => $maxResults,
            'window_from' => $windowFrom->format('Y-m-d H:i:s'),
            'rows' => $rows,
            'write_targets' => ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_channel.vtime'],
        ];
    }

    /**
     * @param  array<string, mixed>  $run
     * @param  list<int>  $requiredChannelIds
     * @return array<string, mixed>
     */
    private function sourceResult(array $run, string $stage, array $requiredChannelIds = []): array
    {
        $payload = is_array($run['payload'] ?? null) ? $run['payload'] : [];
        $allowed = (bool) ($run['allowed'] ?? false);
        $exitCode = $allowed ? (int) ($payload['exit_code'] ?? 1) : 1;
        $crawlComplete = $stage !== 'daily_uploads_backfill' || (bool) ($payload['crawl_complete'] ?? false);
        $requiredChannelIds = $this->normalizedChannelIds($requiredChannelIds);
        $completedChannelIds = $this->completedChannelIds($payload);
        $coveredRequiredChannelIds = array_values(array_intersect($requiredChannelIds, $completedChannelIds));
        $missingRequiredChannelIds = array_values(array_diff($requiredChannelIds, $completedChannelIds));
        $requiredChannelCoverageComplete = $missingRequiredChannelIds === [];
        $succeeded = $allowed
            && $exitCode === 0
            && $crawlComplete
            && $requiredChannelCoverageComplete;

        return [
            'stage' => $stage,
            'succeeded' => $succeeded,
            'allowed' => $allowed,
            'exit_code' => $exitCode,
            'crawl_complete' => $crawlComplete,
            'failure_reason' => $succeeded
                ? null
                : match (true) {
                    ! $allowed => (string) data_get($run, 'guard.reason', 'source_refresh_blocked'),
                    ! $crawlComplete => 'incomplete_channel_crawl',
                    ! $requiredChannelCoverageComplete => 'required_channel_crawl_incomplete',
                    default => 'source_refresh_failed',
                },
            'selected_channels' => (int) ($payload['selected_channels'] ?? $payload['configured_channels'] ?? 0),
            'completed_channels' => (int) ($payload['updated_channels'] ?? $payload['completed_channels'] ?? 0),
            'failed_channels' => (int) ($payload['failed_channels'] ?? $payload['failed_rows'] ?? 0),
            'required_channels' => count($requiredChannelIds),
            'required_channel_ids' => $requiredChannelIds,
            'completed_required_channels' => count($coveredRequiredChannelIds),
            'completed_required_channel_ids' => $coveredRequiredChannelIds,
            'missing_required_channel_ids' => $missingRequiredChannelIds,
            'required_channel_coverage_complete' => $requiredChannelCoverageComplete,
            'api_pages' => (int) ($payload['api_pages'] ?? 0),
            'videos_in_range' => (int) ($payload['videos_in_range'] ?? 0),
            'write_targets' => is_array($payload['write_targets'] ?? null) ? $payload['write_targets'] : [],
            'youtube_quota_budget' => is_array($payload['youtube_quota_budget'] ?? null)
                ? $payload['youtube_quota_budget']
                : (is_array($run['guard'] ?? null) ? $this->quotaGuard->publicState($run['guard']) : null),
        ];
    }

    /**
     * @param  array<string, mixed>  $source
     * @return array<string, mixed>
     */
    private function dailySourcePreview(array $source): array
    {
        $requiredChannelIds = AiDailyPreview::channelAiUids();
        $selectedChannelIds = $this->normalizedChannelIds(
            is_array($source['selected_channel_ids'] ?? null) ? $source['selected_channel_ids'] : [],
        );
        $selectedRequiredChannelIds = array_values(array_intersect($requiredChannelIds, $selectedChannelIds));
        $missingRequiredChannelIds = array_values(array_diff($requiredChannelIds, $selectedChannelIds));

        return [
            ...$source,
            'required_channels' => count($requiredChannelIds),
            'required_channel_ids' => $requiredChannelIds,
            'selected_required_channels' => count($selectedRequiredChannelIds),
            'selected_required_channel_ids' => $selectedRequiredChannelIds,
            'missing_required_channel_ids' => $missingRequiredChannelIds,
            'required_channel_selection_complete' => $missingRequiredChannelIds === [],
            'required_channel_coverage_proven' => false,
        ];
    }

    /**
     * Normalize preview options exactly as the execute path does before reporting them.
     *
     * @return array{limit: int, channel_limit: int, channel_batch_size: int, ai_call_limit: int, channel_video_limit: int, channel_video_limit_requested: int, channel_video_limit_clamped: bool, channel_video_limit_max: int}
     */
    private function dailyExecutionCaps(
        int $limit,
        int $channelLimit,
        int $channelBatchSize,
        int $aiCallLimit,
        int $channelVideoLimit,
    ): array {
        $requestedChannelVideoLimit = $channelVideoLimit;
        $effectiveChannelVideoLimit = $channelVideoLimit <= 0
            ? AiDailyIngestion::MAX_CHANNEL_VIDEO_LIMIT
            : min(AiDailyIngestion::MAX_CHANNEL_VIDEO_LIMIT, $channelVideoLimit);

        return [
            'limit' => max(1, min(1000, $limit)),
            'channel_limit' => max(0, $channelLimit),
            'channel_batch_size' => max(0, $channelBatchSize),
            'ai_call_limit' => max(0, $aiCallLimit),
            'channel_video_limit' => $effectiveChannelVideoLimit,
            'channel_video_limit_requested' => $requestedChannelVideoLimit,
            'channel_video_limit_clamped' => $requestedChannelVideoLimit !== $effectiveChannelVideoLimit,
            'channel_video_limit_max' => AiDailyIngestion::MAX_CHANNEL_VIDEO_LIMIT,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<int>
     */
    private function completedChannelIds(array $payload): array
    {
        return is_array($payload['completed_channel_ids'] ?? null)
            ? $this->normalizedChannelIds($payload['completed_channel_ids'])
            : [];
    }

    /**
     * @return list<int>
     */
    private function normalizedChannelIds(array $channelIds): array
    {
        return collect($channelIds)
            ->map(fn (mixed $uId): int => (int) $uId)
            ->filter(fn (int $uId): bool => $uId > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $source
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function blocked(string $pipeline, string $date, array $source, array $extra = []): array
    {
        return [
            'mode' => 'execute',
            'status' => 'blocked',
            'exit_code' => 1,
            'failed_rows' => 1,
            'source' => $pipeline,
            'date' => $date,
            'source_refresh' => $source,
            'ai' => [
                'skipped' => true,
                'skip_reason' => 'source_refresh_not_complete',
                'ai_call_attempted' => false,
            ],
            'write_targets' => $source['write_targets'] ?? [],
            'generated_at' => $this->now()->format('Y-m-d H:i:s'),
            'secrets' => 'not_printed',
        ] + $extra;
    }

    private function date(?string $date, CarbonImmutable $now): string
    {
        return match (true) {
            $date === 'today' => $now->toDateString(),
            $date === 'yesterday', $date === null, $date === '' => $now->subDay()->toDateString(),
            is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1 => $date,
            default => $now->subDay()->toDateString(),
        };
    }

    private function now(): CarbonImmutable
    {
        return CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei')));
    }

    private function normalizeNow(?CarbonInterface $now): CarbonImmutable
    {
        return $now === null
            ? $this->now()
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($this->now()->getTimezone());
    }
}
