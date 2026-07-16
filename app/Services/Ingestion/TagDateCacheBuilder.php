<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TagDateCacheBuilder
{
    /**
     * @var array<string, array{rows: list<array{tag: string, divisor: float}>, scanned: int, truncated: bool}>
     */
    private array $keywordCache = [];

    public function __construct(
        private readonly TagDateCacheWriteLock $writeLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function buildRange(
        array $tagIds,
        string $from,
        string $to,
        array $orTagIds = [],
        array $notTagIds = [],
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        int $channelLimit = 1000,
        int $videoLimit = 10000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
        int $maxDates = 400,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) ? $from : $now->toDateString();
        $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) ? $to : $from;

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $tagIds = ReportCacheBuildGuardrails::ids($tagIds);
        $orTagIds = ReportCacheBuildGuardrails::ids($orTagIds);
        $notTagIds = ReportCacheBuildGuardrails::ids($notTagIds);
        $onlyKeywords = ReportCacheBuildGuardrails::keywords($onlyKeywords);
        $keywordLimit = ReportCacheBuildGuardrails::bounded($keywordLimit, ReportCacheBuildGuardrails::KEYWORD_SCAN_LIMIT_MAX);
        $channelLimit = ReportCacheBuildGuardrails::bounded($channelLimit, ReportCacheBuildGuardrails::CHANNEL_SCAN_LIMIT_MAX);
        $videoLimit = ReportCacheBuildGuardrails::bounded($videoLimit, ReportCacheBuildGuardrails::VIDEO_SCAN_LIMIT_MAX);
        $maxDates = ReportCacheBuildGuardrails::bounded($maxDates, ReportCacheBuildGuardrails::DATE_RANGE_LIMIT);
        $cursor = CarbonImmutable::parse($from, $now->getTimezone());
        $end = CarbonImmutable::parse($to, $now->getTimezone());
        $datesRequested = (int) $cursor->diffInDays($end) + 1;
        $caps = $this->caps($keywordLimit, $channelLimit, $videoLimit, $maxDates);
        $lists = $this->listSummary($tagIds, $orTagIds, $notTagIds, $onlyKeywords, $datesRequested, $maxDates);
        $blockedReason = $this->listLimitReason($tagIds, $orTagIds, $notTagIds, $onlyKeywords);

        if ($blockedReason === null && count($onlyKeywords) > $keywordLimit) {
            $blockedReason = 'keyword_list_limit_exceeded';
        }

        if ($blockedReason === null && $datesRequested > $maxDates) {
            $blockedReason = 'date_range_limit_exceeded';
        }

        if ($blockedReason !== null) {
            return $this->blockedRangePayload(
                tagIds: $tagIds,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                from: $from,
                to: $to,
                datesRequested: $datesRequested,
                onlyKeywords: $onlyKeywords,
                execute: $execute,
                now: $now,
                caps: $caps,
                lists: $lists,
                reason: $blockedReason,
            );
        }

        $rows = [];
        $writes = 0;
        $failedRows = 0;
        $blockedRows = 0;

        while ($cursor <= $end) {
            $row = $this->build(
                tagIds: $tagIds,
                date: $cursor->toDateString(),
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                keywordLimit: $keywordLimit,
                onlyKeywords: $onlyKeywords,
                channelLimit: $channelLimit,
                videoLimit: $videoLimit,
                execute: $execute,
                now: $now,
            );
            $writes += (int) ($row['writes'] ?? 0);
            $failedRows += (int) ($row['failed_rows'] ?? 0);
            $blockedRows += ($row['status'] ?? null) === 'blocked' ? 1 : 0;
            $rows[] = $row;
            $cursor = $cursor->addDay();
        }

        $allBlocked = $rows !== [] && $blockedRows === count($rows);
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => $allBlocked ? 'blocked' : ($failedRows > 0 ? 'partial_failure' : 'success'),
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'from' => $from,
            'to' => $to,
            'dates_requested' => $datesRequested,
            'dates_selected' => count($rows),
            'date_limit' => $maxDates,
            'range_truncated' => false,
            'only_keywords' => $onlyKeywords,
            'caps' => $caps,
            'lists' => $lists,
            'rows' => $rows,
            'writes' => $writes,
            'failed_rows' => $failedRows,
            'blocked_rows' => $blockedRows,
            'source_complete' => $failedRows === 0,
            'source_truncated' => $blockedRows > 0,
            'blocked_reason' => $blockedRows > 0 ? 'source_incomplete' : null,
            'failure_reason' => $failedRows > 0 ? 'cache_rows_failed' : null,
            'exit_code' => $failedRows > 0 ? 1 : 0,
            'write_targets' => ['urt_show_tag_date'],
        ];
        $logContext = collect($payload)->only([
            'mode',
            'status',
            'tagid',
            'or',
            'not',
            'from',
            'to',
            'dates_requested',
            'dates_selected',
            'range_truncated',
            'writes',
            'failed_rows',
            'blocked_rows',
            'source_complete',
            'source_truncated',
            'blocked_reason',
            'failure_reason',
        ])->all();

        if ($failedRows > 0) {
            Log::warning('Tag date cache batch completed with failures.', $logContext);
        } else {
            Log::info('Tag date cache batch completed.', $logContext);
        }

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    public function build(
        array $tagIds,
        string $date,
        array $orTagIds = [],
        array $notTagIds = [],
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        int $channelLimit = 1000,
        int $videoLimit = 10000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        return $this->buildWithKeywordLimitMaximum(
            tagIds: $tagIds,
            date: $date,
            orTagIds: $orTagIds,
            notTagIds: $notTagIds,
            keywordLimit: $keywordLimit,
            onlyKeywords: $onlyKeywords,
            channelLimit: $channelLimit,
            videoLimit: $videoLimit,
            execute: $execute,
            now: $now,
            keywordLimitMaximum: ReportCacheBuildGuardrails::KEYWORD_SCAN_LIMIT_MAX,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function buildCompleteDictionary(
        array $tagIds,
        string $date,
        array $orTagIds = [],
        array $notTagIds = [],
        int $keywordLimit = ReportCacheBuildGuardrails::TAG_DATE_KEYWORD_SCAN_LIMIT_MAX,
        int $channelLimit = 1000,
        int $videoLimit = 10000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        return $this->buildWithKeywordLimitMaximum(
            tagIds: $tagIds,
            date: $date,
            orTagIds: $orTagIds,
            notTagIds: $notTagIds,
            keywordLimit: $keywordLimit,
            onlyKeywords: [],
            channelLimit: $channelLimit,
            videoLimit: $videoLimit,
            execute: $execute,
            now: $now,
            keywordLimitMaximum: ReportCacheBuildGuardrails::TAG_DATE_KEYWORD_SCAN_LIMIT_MAX,
        );
    }

    /**
     * @return array{keyword_limit: int, keyword_rows_scanned: int, keywords_selected: int, keyword_source_truncated: bool}
     */
    public function completeDictionarySourceState(
        int $keywordLimit = ReportCacheBuildGuardrails::TAG_DATE_KEYWORD_SCAN_LIMIT_MAX,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $keywordLimit = ReportCacheBuildGuardrails::bounded(
            $keywordLimit,
            ReportCacheBuildGuardrails::TAG_DATE_KEYWORD_SCAN_LIMIT_MAX,
        );
        $selection = $this->keywords($keywordLimit, $now);

        return [
            'keyword_limit' => $keywordLimit,
            'keyword_rows_scanned' => (int) $selection['scanned'],
            'keywords_selected' => count($selection['rows']),
            'keyword_source_truncated' => (bool) $selection['truncated'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function buildWithKeywordLimitMaximum(
        array $tagIds,
        string $date,
        array $orTagIds,
        array $notTagIds,
        int $keywordLimit,
        array $onlyKeywords,
        int $channelLimit,
        int $videoLimit,
        bool $execute,
        ?CarbonImmutable $now,
        int $keywordLimitMaximum,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $date = preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : $now->toDateString();
        $keywordLimit = ReportCacheBuildGuardrails::bounded($keywordLimit, $keywordLimitMaximum);
        $channelLimit = ReportCacheBuildGuardrails::bounded($channelLimit, ReportCacheBuildGuardrails::CHANNEL_SCAN_LIMIT_MAX);
        $videoLimit = ReportCacheBuildGuardrails::bounded($videoLimit, ReportCacheBuildGuardrails::VIDEO_SCAN_LIMIT_MAX);
        $tagIds = ReportCacheBuildGuardrails::ids($tagIds);
        $orTagIds = ReportCacheBuildGuardrails::ids($orTagIds);
        $notTagIds = ReportCacheBuildGuardrails::ids($notTagIds);
        $onlyKeywords = ReportCacheBuildGuardrails::keywords($onlyKeywords);
        $caps = $this->caps($keywordLimit, $channelLimit, $videoLimit, ReportCacheBuildGuardrails::DATE_RANGE_LIMIT);
        $lists = $this->listSummary($tagIds, $orTagIds, $notTagIds, $onlyKeywords, 1, ReportCacheBuildGuardrails::DATE_RANGE_LIMIT);
        $generatedAt = $now->format('Y-m-d H:i:s');
        $keywords = [];
        $channelIds = [];
        $videos = [];
        $metrics = [
            'tags_result' => [],
            'tags_video' => [],
            'tags_views' => [],
            'count_tags' => 0,
            'count_videos' => 0,
            'total_views' => 0,
        ];

        $blockedReason = $this->listLimitReason($tagIds, $orTagIds, $notTagIds, $onlyKeywords);

        if ($blockedReason === null && count($onlyKeywords) > $keywordLimit) {
            $blockedReason = 'keyword_list_limit_exceeded';
        }

        if ($blockedReason !== null) {
            return $this->blockedRowPayload(
                tagIds: $tagIds,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                date: $date,
                onlyKeywords: $onlyKeywords,
                execute: $execute,
                generatedAt: $generatedAt,
                caps: $caps,
                lists: $lists,
                reason: $blockedReason,
            );
        }

        try {
            $keywordSelection = $this->keywords($keywordLimit, $now, $onlyKeywords);
            $keywords = $keywordSelection['rows'];

            if ($keywordSelection['truncated']) {
                return $this->blockedRowPayload($tagIds, $orTagIds, $notTagIds, $date, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'keyword_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned']);
            }

            $channelSelection = $this->channelIds($tagIds, $orTagIds, $notTagIds, $channelLimit);
            $channelIds = $channelSelection['rows'];

            if ($channelSelection['truncated']) {
                return $this->blockedRowPayload($tagIds, $orTagIds, $notTagIds, $date, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'channel_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned'], keywordsSelected: count($keywords), channelsMatched: count($channelIds));
            }

            $videoSelection = $this->videos($channelIds, $date, $videoLimit);
            $videos = $videoSelection['rows'];

            if ($videoSelection['truncated']) {
                return $this->blockedRowPayload($tagIds, $orTagIds, $notTagIds, $date, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'video_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned'], keywordsSelected: count($keywords), channelsMatched: count($channelIds), videosScanned: count($videos));
            }

            $metrics = $this->metrics($keywords, $videos);

            if ($execute) {
                $lock = $this->writeLock->acquire($tagIds, $orTagIds, $notTagIds, $date);

                if ($lock === null) {
                    return $this->blockedRowPayload(
                        $tagIds,
                        $orTagIds,
                        $notTagIds,
                        $date,
                        $onlyKeywords,
                        true,
                        $generatedAt,
                        $caps,
                        $lists,
                        'cache_build_locked',
                        keywordRowsScanned: $keywordSelection['scanned'],
                        keywordsSelected: count($keywords),
                        channelsMatched: count($channelIds),
                        videosScanned: count($videos),
                    );
                }

                try {
                    $this->upsertCache($tagIds, $orTagIds, $notTagIds, $date, $metrics, count($channelIds), $generatedAt, $onlyKeywords !== []);
                } finally {
                    $lock->release();
                }
            }

            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'status' => 'success',
                'generated_at' => $generatedAt,
                'tagid' => implode(',', $tagIds),
                'or' => implode(',', $orTagIds),
                'not' => implode(',', $notTagIds),
                'date' => $date,
                'keyword_limit' => $keywordLimit,
                'keyword_rows_scanned' => $keywordSelection['scanned'],
                'channel_limit' => $channelLimit,
                'video_limit' => $videoLimit,
                'caps' => $caps,
                'lists' => $lists,
                'only_keywords' => $onlyKeywords,
                'keywords_selected' => count($keywords),
                'channels_matched' => count($channelIds),
                'videos_scanned' => count($videos),
                'tags_count' => count($metrics['tags_result']),
                'count_tags' => $metrics['count_tags'],
                'count_videos' => $metrics['count_videos'],
                'total_views' => $metrics['total_views'],
                'tags_result' => $metrics['tags_result'],
                'tags_video' => $metrics['tags_video'],
                'tags_views' => $metrics['tags_views'],
                'writes' => $execute ? 1 : 0,
                'failed_rows' => 0,
                'blocked_rows' => 0,
                'source_complete' => true,
                'source_truncated' => false,
                'blocked_reason' => null,
                'failure_reason' => null,
                'exit_code' => 0,
                'write_targets' => ['urt_show_tag_date'],
            ];

            Log::info('Tag date cache row completed.', $this->logContext($payload));

            return $payload;
        } catch (Throwable $exception) {
            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'status' => 'failed',
                'generated_at' => $generatedAt,
                'tagid' => implode(',', $tagIds),
                'or' => implode(',', $orTagIds),
                'not' => implode(',', $notTagIds),
                'date' => $date,
                'keyword_limit' => $keywordLimit,
                'keyword_rows_scanned' => 0,
                'channel_limit' => $channelLimit,
                'video_limit' => $videoLimit,
                'caps' => $caps,
                'lists' => $lists,
                'only_keywords' => $onlyKeywords,
                'keywords_selected' => count($keywords),
                'channels_matched' => count($channelIds),
                'videos_scanned' => count($videos),
                'tags_count' => count($metrics['tags_result']),
                'count_tags' => $metrics['count_tags'],
                'count_videos' => $metrics['count_videos'],
                'total_views' => $metrics['total_views'],
                'tags_result' => $metrics['tags_result'],
                'tags_video' => $metrics['tags_video'],
                'tags_views' => $metrics['tags_views'],
                'writes' => 0,
                'failed_rows' => 1,
                'blocked_rows' => 0,
                'source_complete' => false,
                'source_truncated' => false,
                'blocked_reason' => null,
                'failure_reason' => 'cache_row_processing_failed',
                'exit_code' => 1,
                'write_targets' => ['urt_show_tag_date'],
            ];

            Log::warning('Tag date cache row failed.', $this->logContext($payload) + [
                'exception_class' => $exception::class,
            ]);

            return $payload;
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function logContext(array $payload): array
    {
        return collect($payload)->only([
            'mode',
            'status',
            'tagid',
            'or',
            'not',
            'date',
            'caps',
            'channels_matched',
            'videos_scanned',
            'writes',
            'failed_rows',
            'blocked_rows',
            'source_complete',
            'source_truncated',
            'blocked_reason',
            'failure_reason',
        ])->all();
    }

    /**
     * @return array<string, int>
     */
    private function caps(int $keywordLimit, int $channelLimit, int $videoLimit, int $dateLimit): array
    {
        return [
            'tag_ids_per_list' => ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT,
            'date_range' => $dateLimit,
            'explicit_keywords' => ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT,
            'keyword_scan' => $keywordLimit,
            'channel_scan' => $channelLimit,
            'video_scan_per_date' => $videoLimit,
        ];
    }

    private function listLimitReason(array $tagIds, array $orTagIds, array $notTagIds, array $onlyKeywords): ?string
    {
        if (count($tagIds) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT) {
            return 'tagid_list_limit_exceeded';
        }

        if (count($orTagIds) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT) {
            return 'or_tag_list_limit_exceeded';
        }

        if (count($notTagIds) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT) {
            return 'not_tag_list_limit_exceeded';
        }

        if (count($onlyKeywords) > ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT) {
            return 'keyword_list_limit_exceeded';
        }

        return null;
    }

    /**
     * @return array<string, array{requested: int, selected: int, limit: int, truncated: bool}>
     */
    private function listSummary(array $tagIds, array $orTagIds, array $notTagIds, array $onlyKeywords, int $datesRequested, int $dateLimit): array
    {
        $summary = fn (int $requested, int $limit): array => [
            'requested' => $requested,
            'selected' => $requested > $limit ? 0 : $requested,
            'limit' => $limit,
            'truncated' => $requested > $limit,
        ];

        return [
            'tagid' => $summary(count($tagIds), ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT),
            'or' => $summary(count($orTagIds), ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT),
            'not' => $summary(count($notTagIds), ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT),
            'keywords' => $summary(count($onlyKeywords), ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT),
            'dates' => $summary($datesRequested, $dateLimit),
        ];
    }

    /**
     * @param  array<string, int>  $caps
     * @return array<string, mixed>
     */
    private function blockedRangePayload(
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        string $from,
        string $to,
        int $datesRequested,
        array $onlyKeywords,
        bool $execute,
        CarbonImmutable $now,
        array $caps,
        array $lists,
        string $reason,
    ): array {
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => 'blocked',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'from' => $from,
            'to' => $to,
            'dates_requested' => $datesRequested,
            'dates_selected' => 0,
            'date_limit' => $caps['date_range'],
            'range_truncated' => $reason === 'date_range_limit_exceeded',
            'only_keywords' => $onlyKeywords,
            'caps' => $caps,
            'lists' => $lists,
            'rows' => [],
            'writes' => 0,
            'failed_rows' => 1,
            'blocked_rows' => 1,
            'source_complete' => false,
            'source_truncated' => true,
            'blocked_reason' => $reason,
            'failure_reason' => 'guardrail_blocked',
            'exit_code' => 1,
            'write_targets' => ['urt_show_tag_date'],
        ];

        Log::warning('Tag date cache batch blocked.', collect($payload)->only([
            'mode',
            'status',
            'tagid',
            'from',
            'to',
            'dates_requested',
            'date_limit',
            'range_truncated',
            'caps',
            'writes',
            'source_complete',
            'source_truncated',
            'blocked_reason',
        ])->all());

        return $payload;
    }

    /**
     * @param  array<string, int>  $caps
     * @return array<string, mixed>
     */
    private function blockedRowPayload(
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        string $date,
        array $onlyKeywords,
        bool $execute,
        string $generatedAt,
        array $caps,
        array $lists,
        string $reason,
        int $keywordRowsScanned = 0,
        int $keywordsSelected = 0,
        int $channelsMatched = 0,
        int $videosScanned = 0,
    ): array {
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => 'blocked',
            'generated_at' => $generatedAt,
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'date' => $date,
            'keyword_limit' => $caps['keyword_scan'],
            'keyword_rows_scanned' => $keywordRowsScanned,
            'channel_limit' => $caps['channel_scan'],
            'video_limit' => $caps['video_scan_per_date'],
            'caps' => $caps,
            'lists' => $lists,
            'only_keywords' => $onlyKeywords,
            'keywords_selected' => $keywordsSelected,
            'channels_matched' => $channelsMatched,
            'videos_scanned' => $videosScanned,
            'tags_count' => 0,
            'count_tags' => 0,
            'count_videos' => 0,
            'total_views' => 0,
            'tags_result' => [],
            'tags_video' => [],
            'tags_views' => [],
            'writes' => 0,
            'failed_rows' => 1,
            'blocked_rows' => 1,
            'source_complete' => false,
            'source_truncated' => true,
            'blocked_reason' => $reason,
            'failure_reason' => 'source_incomplete',
            'exit_code' => 1,
            'write_targets' => ['urt_show_tag_date'],
        ];

        Log::warning('Tag date cache row blocked.', $this->logContext($payload));

        return $payload;
    }

    /**
     * @return array{rows: list<array{tag: string, divisor: float}>, scanned: int, truncated: bool}
     */
    private function keywords(int $limit, CarbonImmutable $now, array $onlyKeywords = []): array
    {
        $cacheKey = $limit.'|'.$now->toDateString().'|'.implode("\n", $onlyKeywords);

        if (isset($this->keywordCache[$cacheKey])) {
            return $this->keywordCache[$cacheKey];
        }

        $query = DB::table('tags')
            ->select(['tag', 'max_count', 'hours_count', 'max_hours'])
            ->where(function (Builder $query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', '<', 1);
            });

        if ($onlyKeywords !== []) {
            $query->whereIn('tag', $onlyKeywords);
        }

        $sourceRows = $query
            ->orderByDesc('hours_count')
            ->limit($limit + 1)
            ->get();
        $truncated = $sourceRows->count() > $limit;
        $scanned = min($sourceRows->count(), $limit);
        $keywords = $sourceRows
            ->take($limit)
            ->map(function (object $row) use ($now): array {
                $tag = (string) $row->tag;
                $maxCount = max(0, (int) ($row->max_count ?? 0));
                $hoursCount = max(0, (int) ($row->hours_count ?? 0));
                $maxHours = (string) ($row->max_hours ?? $now->format('Y-m-d H:i:s'));
                $periodDays = max(1 / 24, $now->diffInSeconds($maxHours, true) / 86400);
                $weight = $hoursCount > 1 && $maxCount > 1
                    ? log($hoursCount) / $periodDays * log($maxCount) * 100
                    : 0.0;

                return [
                    'tag' => $tag,
                    'weight' => max(0.0, $weight),
                    'divisor' => max(0.5, (float) $maxCount + 0.5),
                ];
            })
            ->filter(fn (array $row): bool => $this->eligibleKeyword($row['tag']))
            ->sortByDesc('weight')
            ->take($limit)
            ->map(fn (array $row): array => ['tag' => $row['tag'], 'divisor' => $row['divisor']])
            ->values()
            ->all();

        if ($onlyKeywords !== []) {
            $selected = array_fill_keys(array_column($keywords, 'tag'), true);

            foreach ($onlyKeywords as $keyword) {
                if (! isset($selected[$keyword]) && $this->eligibleKeyword($keyword)) {
                    $keywords[] = ['tag' => $keyword, 'divisor' => 1.0];
                    $selected[$keyword] = true;
                }
            }
        }

        return $this->keywordCache[$cacheKey] = [
            'rows' => $keywords,
            'scanned' => $scanned,
            'truncated' => $truncated,
        ];
    }

    private function eligibleKeyword(string $tag): bool
    {
        if ($tag === '' || mb_strlen($tag, 'UTF-8') <= 1 || is_numeric($tag)) {
            return false;
        }

        return preg_match('/^[A-Za-z]+$/', $tag) !== 1 || strlen($tag) >= 3;
    }

    /**
     * @return array{rows: list<int>, truncated: bool}
     */
    private function channelIds(array $tagIds, array $orTagIds, array $notTagIds, int $limit): array
    {
        $query = DB::table('urt_count')->select('u_id');

        if ($orTagIds !== []) {
            $query->where(function (Builder $query) use ($orTagIds): void {
                foreach ($orTagIds as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($tagIds as $tagId) {
            $query->where('tags', 'like', '%['.$tagId.']%');
        }

        if ($notTagIds !== []) {
            $query->where(function (Builder $query) use ($notTagIds): void {
                foreach ($notTagIds as $tagId) {
                    $query->where('tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        $ids = $query
            ->orderBy('u_id')
            ->limit($limit + 1)
            ->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->values()
            ->all();

        return [
            'rows' => array_slice($ids, 0, $limit),
            'truncated' => count($ids) > $limit,
        ];
    }

    /**
     * @return array{rows: list<object>, truncated: bool}
     */
    private function videos(array $channelIds, string $date, int $limit): array
    {
        if ($channelIds === []) {
            return ['rows' => [], 'truncated' => false];
        }

        $rows = DB::table('urt_video')
            ->select(['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'description', 'viewCount'])
            ->whereIn('u_id', $channelIds)
            ->whereBetween('publishedAt', [$date.' 00:00:00', $date.' 23:59:59'])
            ->orderBy('publishedAt')
            ->orderBy('pk')
            ->limit($limit + 1)
            ->get()
            ->all();

        return [
            'rows' => array_slice($rows, 0, $limit),
            'truncated' => count($rows) > $limit,
        ];
    }

    /**
     * @param  list<array{tag: string, divisor: float}>  $keywords
     * @param  list<object>  $videos
     * @return array{tags_result: array<string, string>, tags_video: array<string, int>, tags_views: array<string, int>, count_tags: int, count_videos: int, total_views: int}
     */
    private function metrics(array $keywords, array $videos): array
    {
        $keywordTags = array_column($keywords, 'tag');
        $keywordDivisors = collect($keywords)->mapWithKeys(fn (array $row): array => [$row['tag'] => $row['divisor']])->all();
        $keywordLengths = [];

        foreach ($keywordTags as $tag) {
            $keywordLengths[$tag] = mb_strlen($tag, 'UTF-8');
        }

        $rawCounts = [];
        $keywordVideo = [];
        $keywordViews = [];
        $countTags = 0;
        $totalViews = 0;

        foreach ($videos as $video) {
            $text = (string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');
            $views = max(0, (int) ($video->viewCount ?? 0));
            $totalViews += $views;
            $counts = [];
            $matchedKeywordLengths = [];

            foreach ($keywordTags as $tag) {
                $count = substr_count($text, $tag);

                if ($count > 0) {
                    $counts[$tag] = $count;
                    $matchedKeywordLengths[$tag] = $keywordLengths[$tag];
                }
            }

            if ($counts === []) {
                continue;
            }

            arsort($matchedKeywordLengths);
            $matchedKeywords = array_keys($matchedKeywordLengths);
            $matchedKeywordCount = count($matchedKeywords);

            for ($i = 0; $i < $matchedKeywordCount; $i++) {
                $longer = $matchedKeywords[$i];

                for ($j = $i + 1; $j < $matchedKeywordCount; $j++) {
                    $shorter = $matchedKeywords[$j];

                    if (str_contains($longer, $shorter)) {
                        $counts[$shorter] -= $counts[$longer];
                    }
                }
            }

            foreach ($counts as $tag => $count) {
                if ($count <= 0) {
                    continue;
                }

                $countTags += $count;
                $rawCounts[$tag] = ($rawCounts[$tag] ?? 0) + $count;
                $keywordVideo[$tag] = ($keywordVideo[$tag] ?? 0) + 1;
                $keywordViews[$tag] = ($keywordViews[$tag] ?? 0) + $views;
            }
        }

        $tagsResult = [];

        foreach ($rawCounts as $tag => $count) {
            $lengthWeight = log(mb_strlen($tag, 'UTF-8') + 0.5) - 0.5;
            $score = $count * $lengthWeight / (float) ($keywordDivisors[$tag] ?? 0.5);

            if ($score > 0) {
                $tagsResult[$tag] = sprintf('%.3f', $score);
            }
        }

        arsort($tagsResult);
        arsort($keywordVideo);
        arsort($keywordViews);

        return [
            'tags_result' => $tagsResult,
            'tags_video' => $keywordVideo,
            'tags_views' => $keywordViews,
            'count_tags' => $countTags,
            'count_videos' => count($videos),
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @param  array{tags_result: array<string, string>, tags_video: array<string, int>, tags_views: array<string, int>, count_tags: int, count_videos: int, total_views: int}  $metrics
     */
    private function upsertCache(array $tagIds, array $orTagIds, array $notTagIds, string $date, array $metrics, int $countChannels, string $generatedAt, bool $mergeKeywords): void
    {
        $tagIdString = implode(',', $tagIds);
        $tagOrString = $orTagIds === [] ? null : implode(',', $orTagIds);
        $tagNotString = $notTagIds === [] ? null : implode(',', $notTagIds);

        DB::transaction(function () use ($tagIdString, $tagOrString, $tagNotString, $date, $metrics, $countChannels, $generatedAt, $mergeKeywords): void {
            $payload = [
                'mtime' => $generatedAt,
                'stime' => $generatedAt,
                'count_channels' => $countChannels,
                'count_videos' => $metrics['count_videos'],
                'count_tags' => $metrics['count_tags'],
                'the_date' => $date,
                'tags_count' => count($metrics['tags_result']),
                'total_views' => $metrics['total_views'],
                'tags_result' => json_encode($metrics['tags_result'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'tags_video' => json_encode($metrics['tags_video'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'tags_views' => json_encode($metrics['tags_views'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ];

            $query = DB::table('urt_show_tag_date')
                ->where('tagid', $tagIdString)
                ->where('the_date', $date)
                ->where(function (Builder $query) use ($tagOrString): void {
                    $tagOrString === null
                        ? $query->whereNull('tag_or')->orWhere('tag_or', '')
                        : $query->where('tag_or', $tagOrString);
                })
                ->where(function (Builder $query) use ($tagNotString): void {
                    $tagNotString === null
                        ? $query->whereNull('tag_not')->orWhere('tag_not', '')
                        : $query->where('tag_not', $tagNotString);
                });

            $existing = (clone $query)->first(['tags_result', 'tags_video', 'tags_views']);

            if ($existing !== null) {
                if ($mergeKeywords) {
                    $tagsResult = $this->mergedMetricJson((string) ($existing->tags_result ?? ''), $metrics['tags_result']);
                    $tagsVideo = $this->mergedMetricJson((string) ($existing->tags_video ?? ''), $metrics['tags_video']);
                    $tagsViews = $this->mergedMetricJson((string) ($existing->tags_views ?? ''), $metrics['tags_views']);

                    $query->update([
                        'mtime' => $generatedAt,
                        'stime' => $generatedAt,
                        'tags_count' => count($this->decodeMetricJson($tagsResult)),
                        'tags_result' => $tagsResult,
                        'tags_video' => $tagsVideo,
                        'tags_views' => $tagsViews,
                    ]);

                    return;
                }

                $query->update($payload);

                return;
            }

            if (Schema::hasColumn('urt_show_tag_date', 'ctime')) {
                $payload['ctime'] = $generatedAt;
            }

            $payload['tagid'] = $tagIdString;
            $payload['tag_or'] = $tagOrString;
            $payload['tag_not'] = $tagNotString;
            DB::table('urt_show_tag_date')->insert($payload);
        });
    }

    /**
     * @param  array<string, int|string>  $updates
     */
    private function mergedMetricJson(string $existingJson, array $updates): string
    {
        $merged = $this->decodeMetricJson($existingJson);

        foreach ($updates as $tag => $value) {
            if (is_string($tag) && is_numeric($value)) {
                $merged[$tag] = $value;
            }
        }

        arsort($merged, SORT_NUMERIC);

        return json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @return array<string, int|float|string>
     */
    private function decodeMetricJson(string $json): array
    {
        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        if (isset($decoded['data']) && is_array($decoded['data'])) {
            $decoded = $decoded['data'];
        }

        return collect($decoded)
            ->filter(fn (mixed $value, mixed $key): bool => is_string($key) && is_numeric($value))
            ->all();
    }
}
