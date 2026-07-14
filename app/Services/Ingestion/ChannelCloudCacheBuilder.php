<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class ChannelCloudCacheBuilder
{
    /**
     * @var array<string, array{rows: list<array{tag: string, divisor: float}>, scanned: int, truncated: bool}>
     */
    private array $keywordCache = [];

    /**
     * @return array<string, mixed>
     */
    public function buildMany(
        array $uIds,
        array $daysList,
        int $limit = 50,
        int $recentDays = 14,
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        int $videoLimit = 10000,
        int|string|null $offset = 0,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $limit = max(1, min(500, $limit));
        $recentDays = max(1, min(365, $recentDays));
        $keywordLimit = ReportCacheBuildGuardrails::bounded($keywordLimit, ReportCacheBuildGuardrails::KEYWORD_SCAN_LIMIT_MAX);
        $videoLimit = ReportCacheBuildGuardrails::bounded($videoLimit, ReportCacheBuildGuardrails::VIDEO_SCAN_LIMIT_MAX);
        $uIds = ReportCacheBuildGuardrails::ids($uIds);
        $daysList = ReportCacheBuildGuardrails::days($daysList);
        $daysList = $daysList === [] ? [1, 3, 7, 30, 90] : $daysList;
        $onlyKeywords = ReportCacheBuildGuardrails::keywords($onlyKeywords);
        $caps = $this->caps($limit, $keywordLimit, $videoLimit);
        $lists = $this->listSummary($uIds, $daysList, $onlyKeywords);
        $blockedReason = $this->listLimitReason($uIds, $daysList, $onlyKeywords);

        if ($blockedReason === null && count($onlyKeywords) > $keywordLimit) {
            $blockedReason = 'keyword_list_limit_exceeded';
        }

        if ($blockedReason !== null) {
            return $this->blockedBatchPayload(
                uIds: $uIds,
                daysList: $daysList,
                onlyKeywords: $onlyKeywords,
                limit: $limit,
                recentDays: $recentDays,
                execute: $execute,
                now: $now,
                caps: $caps,
                lists: $lists,
                reason: $blockedReason,
            );
        }

        $channelSelection = $uIds !== []
            ? [
                'rows' => $uIds,
                'candidates' => count($uIds),
                'offset' => 0,
                'offset_mode' => 'explicit',
                'next_offset' => 0,
                'wrapped' => false,
                'truncated' => false,
            ]
            : $this->recentChannelIds($limit, $recentDays, $now, $offset);
        $channelIds = $channelSelection['rows'];
        $rows = [];
        $writes = 0;
        $failedRows = 0;
        $blockedRows = 0;

        foreach ($channelIds as $uId) {
            foreach ($daysList as $days) {
                $result = $this->build(
                    uId: $uId,
                    days: $days,
                    keywordLimit: $keywordLimit,
                    onlyKeywords: $onlyKeywords,
                    videoLimit: $videoLimit,
                    execute: $execute,
                    now: $now,
                );
                $writes += (int) $result['writes'];
                $failedRows += (int) ($result['failed_rows'] ?? 0);
                $blockedRows += ($result['status'] ?? null) === 'blocked' ? 1 : 0;
                $rows[] = $result;
            }
        }

        $allBlocked = $rows !== [] && $blockedRows === count($rows);
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => $allBlocked ? 'blocked' : ($failedRows > 0 ? 'partial_failure' : 'success'),
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'explicit_channels' => $uIds,
            'channels_selected' => count($channelIds),
            'channel_ids' => $channelIds,
            'channel_selection_candidates' => $channelSelection['candidates'],
            'channel_selection_offset' => $channelSelection['offset'],
            'channel_selection_offset_mode' => $channelSelection['offset_mode'],
            'channel_selection_next_offset' => $channelSelection['next_offset'],
            'channel_selection_wrapped' => $channelSelection['wrapped'],
            'channel_selection_truncated' => $channelSelection['truncated'],
            'days_list' => $daysList,
            'limit' => $limit,
            'recent_days' => $recentDays,
            'keyword_limit' => $keywordLimit,
            'video_limit' => $videoLimit,
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
            'write_targets' => ['urt_show_cloud'],
        ];

        $logContext = collect($payload)->only([
            'mode',
            'status',
            'channels_selected',
            'channel_selection_truncated',
            'days_list',
            'writes',
            'failed_rows',
            'blocked_rows',
            'source_complete',
            'source_truncated',
            'blocked_reason',
            'failure_reason',
        ])->all();

        if ($failedRows > 0) {
            Log::warning('Channel cloud cache batch completed with failures.', $logContext);
        } else {
            Log::info('Channel cloud cache batch completed.', $logContext);
        }

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    public function build(
        int $uId,
        int $days,
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        int $videoLimit = 10000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $uId = max(1, $uId);
        $days = max(1, min(365, $days));
        $keywordLimit = ReportCacheBuildGuardrails::bounded($keywordLimit, ReportCacheBuildGuardrails::KEYWORD_SCAN_LIMIT_MAX);
        $videoLimit = ReportCacheBuildGuardrails::bounded($videoLimit, ReportCacheBuildGuardrails::VIDEO_SCAN_LIMIT_MAX);
        $onlyKeywords = ReportCacheBuildGuardrails::keywords($onlyKeywords);
        $caps = $this->caps(500, $keywordLimit, $videoLimit);
        $lists = $this->listSummary([$uId], [$days], $onlyKeywords);
        $generatedAt = $now->format('Y-m-d H:i:s');
        $keywords = [];
        $videos = [];
        $metrics = [
            'keywords_json' => [],
            'count_tags' => 0,
            'count_videos' => 0,
            'total_views' => 0,
        ];

        if (count($onlyKeywords) > min(ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT, $keywordLimit)) {
            return $this->blockedRowPayload($uId, $days, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'keyword_list_limit_exceeded');
        }

        try {
            $keywordSelection = $this->keywords($keywordLimit, $now, $onlyKeywords);
            $keywords = $keywordSelection['rows'];

            if ($keywordSelection['truncated']) {
                return $this->blockedRowPayload($uId, $days, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'keyword_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned']);
            }

            $videoSelection = $this->videos($uId, $now, $days, $videoLimit);
            $videos = $videoSelection['rows'];

            if ($videoSelection['truncated']) {
                return $this->blockedRowPayload($uId, $days, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'video_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned'], keywordsSelected: count($keywords), videosScanned: count($videos));
            }

            $metrics = $this->metrics($keywords, $videos);

            if ($execute) {
                $this->upsertCache($uId, $days, $metrics, $generatedAt, $onlyKeywords);
            }

            return [
                'mode' => $execute ? 'execute' : 'dry-run',
                'status' => 'success',
                'generated_at' => $generatedAt,
                'u_id' => $uId,
                'days' => $days,
                'keyword_limit' => $keywordLimit,
                'keyword_rows_scanned' => $keywordSelection['scanned'],
                'video_limit' => $videoLimit,
                'caps' => $caps,
                'lists' => $lists,
                'only_keywords' => $onlyKeywords,
                'cache_merge_mode' => $onlyKeywords === [] ? 'replace' : 'merge_selected_keywords',
                'keywords_selected' => count($keywords),
                'videos_scanned' => count($videos),
                'keywords_count' => count($metrics['keywords_json']),
                'count_tags' => $metrics['count_tags'],
                'count_videos' => $metrics['count_videos'],
                'total_views' => $metrics['total_views'],
                'writes' => $execute ? 1 : 0,
                'failed_rows' => 0,
                'blocked_rows' => 0,
                'source_complete' => true,
                'source_truncated' => false,
                'blocked_reason' => null,
                'failure_reason' => null,
                'exit_code' => 0,
                'write_targets' => ['urt_show_cloud'],
            ];
        } catch (Throwable $exception) {
            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'status' => 'failed',
                'generated_at' => $generatedAt,
                'u_id' => $uId,
                'days' => $days,
                'keyword_limit' => $keywordLimit,
                'keyword_rows_scanned' => 0,
                'video_limit' => $videoLimit,
                'caps' => $caps,
                'lists' => $lists,
                'only_keywords' => $onlyKeywords,
                'keywords_selected' => count($keywords),
                'videos_scanned' => count($videos),
                'keywords_count' => count($metrics['keywords_json']),
                'count_tags' => $metrics['count_tags'],
                'count_videos' => $metrics['count_videos'],
                'total_views' => $metrics['total_views'],
                'writes' => 0,
                'failed_rows' => 1,
                'blocked_rows' => 0,
                'source_complete' => false,
                'source_truncated' => false,
                'blocked_reason' => null,
                'failure_reason' => 'cache_row_processing_failed',
                'exit_code' => 1,
                'write_targets' => ['urt_show_cloud'],
            ];

            Log::warning('Channel cloud cache row failed.', [
                'mode' => $payload['mode'],
                'status' => $payload['status'],
                'u_id' => $uId,
                'days' => $days,
                'writes' => 0,
                'failed_rows' => 1,
                'failure_reason' => $payload['failure_reason'],
                'exception_class' => $exception::class,
            ]);

            return $payload;
        }
    }

    /**
     * @return array<string, int>
     */
    private function caps(int $channelSelectionLimit, int $keywordLimit, int $videoLimit): array
    {
        return [
            'explicit_channels' => ReportCacheBuildGuardrails::CHANNEL_ID_LIST_LIMIT,
            'periods' => ReportCacheBuildGuardrails::PERIOD_LIST_LIMIT,
            'explicit_keywords' => ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT,
            'channel_selection' => $channelSelectionLimit,
            'keyword_scan' => $keywordLimit,
            'video_scan_per_channel_period' => $videoLimit,
        ];
    }

    private function listLimitReason(array $uIds, array $daysList, array $onlyKeywords): ?string
    {
        if (count($uIds) > ReportCacheBuildGuardrails::CHANNEL_ID_LIST_LIMIT) {
            return 'channel_id_list_limit_exceeded';
        }

        if (count($daysList) > ReportCacheBuildGuardrails::PERIOD_LIST_LIMIT) {
            return 'period_list_limit_exceeded';
        }

        if (count($onlyKeywords) > ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT) {
            return 'keyword_list_limit_exceeded';
        }

        return null;
    }

    /**
     * @return array<string, array{requested: int, selected: int, limit: int, truncated: bool}>
     */
    private function listSummary(array $uIds, array $daysList, array $onlyKeywords): array
    {
        $summary = fn (array $values, int $limit): array => [
            'requested' => count($values),
            'selected' => count($values) > $limit ? 0 : count($values),
            'limit' => $limit,
            'truncated' => count($values) > $limit,
        ];

        return [
            'channels' => $summary($uIds, ReportCacheBuildGuardrails::CHANNEL_ID_LIST_LIMIT),
            'periods' => $summary($daysList, ReportCacheBuildGuardrails::PERIOD_LIST_LIMIT),
            'keywords' => $summary($onlyKeywords, ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT),
        ];
    }

    /**
     * @param  array<string, int>  $caps
     * @return array<string, mixed>
     */
    private function blockedBatchPayload(
        array $uIds,
        array $daysList,
        array $onlyKeywords,
        int $limit,
        int $recentDays,
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
            'explicit_channels' => $uIds,
            'channels_selected' => 0,
            'channel_ids' => [],
            'channel_selection_candidates' => 0,
            'channel_selection_offset' => 0,
            'channel_selection_offset_mode' => 'explicit',
            'channel_selection_next_offset' => 0,
            'channel_selection_wrapped' => false,
            'channel_selection_truncated' => count($uIds) > ReportCacheBuildGuardrails::CHANNEL_ID_LIST_LIMIT,
            'days_list' => $daysList,
            'limit' => $limit,
            'recent_days' => $recentDays,
            'keyword_limit' => $caps['keyword_scan'],
            'video_limit' => $caps['video_scan_per_channel_period'],
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
            'write_targets' => ['urt_show_cloud'],
        ];

        Log::warning('Channel cloud cache batch blocked.', collect($payload)->only([
            'mode',
            'status',
            'channels_selected',
            'days_list',
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
        int $uId,
        int $days,
        array $onlyKeywords,
        bool $execute,
        string $generatedAt,
        array $caps,
        array $lists,
        string $reason,
        int $keywordRowsScanned = 0,
        int $keywordsSelected = 0,
        int $videosScanned = 0,
    ): array {
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => 'blocked',
            'generated_at' => $generatedAt,
            'u_id' => $uId,
            'days' => $days,
            'keyword_limit' => $caps['keyword_scan'],
            'keyword_rows_scanned' => $keywordRowsScanned,
            'video_limit' => $caps['video_scan_per_channel_period'],
            'caps' => $caps,
            'lists' => $lists,
            'only_keywords' => $onlyKeywords,
            'keywords_selected' => $keywordsSelected,
            'videos_scanned' => $videosScanned,
            'keywords_count' => 0,
            'count_tags' => 0,
            'count_videos' => 0,
            'total_views' => 0,
            'writes' => 0,
            'failed_rows' => 1,
            'blocked_rows' => 1,
            'source_complete' => false,
            'source_truncated' => true,
            'blocked_reason' => $reason,
            'failure_reason' => 'source_incomplete',
            'exit_code' => 1,
            'write_targets' => ['urt_show_cloud'],
        ];

        Log::warning('Channel cloud cache row blocked.', collect($payload)->only([
            'mode',
            'status',
            'u_id',
            'days',
            'caps',
            'videos_scanned',
            'writes',
            'source_complete',
            'source_truncated',
            'blocked_reason',
        ])->all());

        return $payload;
    }

    /**
     * @return array{rows: list<int>, candidates: int, offset: int, offset_mode: string, next_offset: int, wrapped: bool, truncated: bool}
     */
    private function recentChannelIds(
        int $limit,
        int $recentDays,
        CarbonImmutable $now,
        int|string|null $offset,
    ): array {
        $from = $now->subDays($recentDays)->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        $ranked = DB::table('urt_video')
            ->select('u_id')
            ->selectRaw('MAX(publishedAt) as latest_published_at')
            ->whereNotNull('u_id')
            ->where('u_id', '>', 0)
            ->whereBetween('publishedAt', [$from, $to])
            ->groupBy('u_id');
        $candidates = DB::query()->fromSub(clone $ranked, 'recent_channels')->count();
        [$effectiveOffset, $offsetMode] = $this->effectiveOffset($offset, $candidates, $limit, $now);
        $ids = (clone $ranked)
            ->orderByDesc('latest_published_at')
            ->orderBy('u_id')
            ->offset($effectiveOffset)
            ->limit($limit)
            ->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->values()
            ->all();
        $wanted = min($limit, $candidates);
        $wrapped = false;

        if (count($ids) < $wanted && $effectiveOffset > 0) {
            $wrapped = true;
            $ids = array_merge($ids, (clone $ranked)
                ->orderByDesc('latest_published_at')
                ->orderBy('u_id')
                ->limit($wanted - count($ids))
                ->pluck('u_id')
                ->map(fn (mixed $id): int => (int) $id)
                ->values()
                ->all());
        }

        return [
            'rows' => $ids,
            'candidates' => $candidates,
            'offset' => $effectiveOffset,
            'offset_mode' => $offsetMode,
            'next_offset' => $candidates > 0 ? ($effectiveOffset + count($ids)) % $candidates : 0,
            'wrapped' => $wrapped,
            'truncated' => $candidates > count($ids),
        ];
    }

    /** @return array{0: int, 1: string} */
    private function effectiveOffset(
        int|string|null $offset,
        int $total,
        int $limit,
        CarbonImmutable $now,
    ): array {
        if ($total < 1) {
            return [0, 'explicit'];
        }

        if (is_string($offset) && strtolower(trim($offset)) === 'auto') {
            return [(intdiv($now->getTimestamp(), 3600) * $limit) % $total, 'auto'];
        }

        return [max(0, (int) $offset) % $total, 'explicit'];
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
     * @return array{rows: list<object>, truncated: bool}
     */
    private function videos(int $uId, CarbonImmutable $now, int $days, int $limit): array
    {
        $from = $now->subDays($days)->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        $rows = DB::table('urt_video')
            ->select(['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'description', 'viewCount'])
            ->where('u_id', $uId)
            ->whereBetween('publishedAt', [$from, $to])
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
     * @return array{keywords_json: array<string, string>, count_tags: int, count_videos: int, total_views: int}
     */
    private function metrics(array $keywords, array $videos): array
    {
        $keywordTags = array_column($keywords, 'tag');
        $keywordDivisors = collect($keywords)->mapWithKeys(fn (array $row): array => [$row['tag'] => $row['divisor']])->all();
        $keywordLengths = [];

        foreach ($keywordTags as $tag) {
            $keywordLengths[$tag] = mb_strlen($tag, 'UTF-8');
        }

        arsort($keywordLengths);
        $orderedKeywords = array_keys($keywordLengths);
        $rawCounts = [];
        $countTags = 0;
        $totalViews = 0;

        foreach ($videos as $video) {
            $text = (string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');
            $views = max(0, (int) ($video->viewCount ?? 0));
            $totalViews += $views;
            $counts = [];

            foreach ($keywordTags as $tag) {
                $count = substr_count($text, $tag);

                if ($count > 0) {
                    $counts[$tag] = $count;
                }
            }

            if ($counts === []) {
                continue;
            }

            for ($i = 0; $i < count($orderedKeywords); $i++) {
                $longer = $orderedKeywords[$i];

                if (! isset($counts[$longer])) {
                    continue;
                }

                for ($j = $i + 1; $j < count($orderedKeywords); $j++) {
                    $shorter = $orderedKeywords[$j];

                    if (isset($counts[$shorter]) && str_contains($longer, $shorter)) {
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
            }
        }

        $keywordsJson = [];

        foreach ($rawCounts as $tag => $count) {
            $lengthWeight = log(mb_strlen($tag, 'UTF-8') + 0.5) - 0.5;
            $score = $count * $lengthWeight / (float) ($keywordDivisors[$tag] ?? 0.5);

            if ($score > 0) {
                $keywordsJson[$tag] = sprintf('%.3f', $score);
            }
        }

        arsort($keywordsJson);

        return [
            'keywords_json' => $keywordsJson,
            'count_tags' => $countTags,
            'count_videos' => count($videos),
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param  array{keywords_json: array<string, string>, count_tags: int, count_videos: int, total_views: int}  $metrics
     */
    private function upsertCache(int $uId, int $days, array $metrics, string $generatedAt, array $onlyKeywords): void
    {
        DB::transaction(function () use ($uId, $days, $metrics, $generatedAt, $onlyKeywords): void {
            $query = DB::table('urt_show_cloud')
                ->where('u_id', $uId)
                ->where('days', $days);
            $existing = (clone $query)->first();
            $keywordsJson = $metrics['keywords_json'];
            $countTags = $metrics['count_tags'];

            if ($existing !== null && $onlyKeywords !== []) {
                $existingKeywords = $this->existingKeywordMap($existing->keywords_json ?? null);

                if ($existingKeywords === null) {
                    throw new \RuntimeException('existing channel cloud cache payload is malformed');
                }

                foreach ($onlyKeywords as $keyword) {
                    unset($existingKeywords[$keyword]);
                }

                $keywordsJson = [...$existingKeywords, ...$metrics['keywords_json']];
                $countTags = (int) ($existing->count_tags ?? $metrics['count_tags']);
            }

            $payload = $this->tablePayload([
                'mtime' => $generatedAt,
                'keywords_json' => json_encode($keywordsJson, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'count_videos' => $metrics['count_videos'],
                'count_tags' => $countTags,
                'tags_count' => count($keywordsJson),
                'total_views' => $metrics['total_views'],
            ]);

            if ($existing !== null) {
                $query->update($payload);

                return;
            }

            $payload = array_merge($payload, $this->tablePayload([
                'ctime' => $generatedAt,
                'u_id' => $uId,
                'days' => $days,
            ]));

            DB::table('urt_show_cloud')->insert($payload);
        });
    }

    /** @return array<string, mixed>|null */
    private function existingKeywordMap(mixed $value): ?array
    {
        if ($value === null || $value === '') {
            return [];
        }

        if (! is_string($value)) {
            return null;
        }

        $decoded = json_decode($value, true);

        if (! is_array($decoded)) {
            return null;
        }

        foreach (['result', 'data', 'keywords'] as $wrapper) {
            if (count($decoded) === 1 && isset($decoded[$wrapper]) && is_array($decoded[$wrapper])) {
                $decoded = $decoded[$wrapper];
                break;
            }
        }

        return $decoded === [] || ! array_is_list($decoded) ? $decoded : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function tablePayload(array $payload): array
    {
        return collect($payload)
            ->filter(fn (mixed $value, string $column): bool => Schema::hasColumn('urt_show_cloud', $column))
            ->all();
    }
}
