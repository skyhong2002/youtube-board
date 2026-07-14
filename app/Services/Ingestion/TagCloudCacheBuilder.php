<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TagCloudCacheBuilder
{
    /**
     * @var array<string, array{rows: list<array{tag: string, divisor: float}>, scanned: int, truncated: bool}>
     */
    private array $keywordCache = [];

    /**
     * @return array<string, mixed>
     */
    public function buildMany(
        array $tagIds,
        array $daysList,
        array $orTagIds = [],
        array $notTagIds = [],
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        int $channelLimit = 1000,
        int $videoLimit = 50000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $tagIds = ReportCacheBuildGuardrails::ids($tagIds);
        $orTagIds = ReportCacheBuildGuardrails::ids($orTagIds);
        $notTagIds = ReportCacheBuildGuardrails::ids($notTagIds);
        $daysList = ReportCacheBuildGuardrails::days($daysList);
        $daysList = $daysList === [] ? [1, 3, 7, 30, 90] : $daysList;
        $onlyKeywords = ReportCacheBuildGuardrails::keywords($onlyKeywords);
        $keywordLimit = ReportCacheBuildGuardrails::bounded($keywordLimit, ReportCacheBuildGuardrails::KEYWORD_SCAN_LIMIT_MAX);
        $channelLimit = ReportCacheBuildGuardrails::bounded($channelLimit, ReportCacheBuildGuardrails::CHANNEL_SCAN_LIMIT_MAX);
        $videoLimit = ReportCacheBuildGuardrails::bounded($videoLimit, ReportCacheBuildGuardrails::VIDEO_SCAN_LIMIT_MAX);
        $caps = $this->caps($keywordLimit, $channelLimit, $videoLimit);
        $lists = $this->listSummary($tagIds, $orTagIds, $notTagIds, $daysList, $onlyKeywords);
        $blockedReason = $this->listLimitReason($tagIds, $orTagIds, $notTagIds, $daysList, $onlyKeywords);

        if ($blockedReason === null && count($onlyKeywords) > $keywordLimit) {
            $blockedReason = 'keyword_list_limit_exceeded';
        }

        if ($blockedReason !== null) {
            return $this->blockedBatchPayload(
                tagIds: $tagIds,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                daysList: $daysList,
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

        foreach ($daysList as $days) {
            $result = $this->build(
                tagIds: $tagIds,
                days: $days,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                keywordLimit: $keywordLimit,
                onlyKeywords: $onlyKeywords,
                channelLimit: $channelLimit,
                videoLimit: $videoLimit,
                execute: $execute,
                now: $now,
            );
            $writes += (int) ($result['writes'] ?? 0);
            $failedRows += (int) ($result['failed_rows'] ?? 0);
            $blockedRows += ($result['status'] ?? null) === 'blocked' ? 1 : 0;
            $rows[] = $result;
        }

        $allBlocked = $rows !== [] && $blockedRows === count($rows);
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => $allBlocked ? 'blocked' : ($failedRows > 0 ? 'partial_failure' : 'success'),
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'days_list' => $daysList,
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
            'write_targets' => ['urt_show_tag_cloud'],
        ];

        Log::log($failedRows > 0 ? 'warning' : 'info', 'Tag cloud cache batch completed.', collect($payload)->only([
            'mode',
            'status',
            'tagid',
            'days_list',
            'writes',
            'failed_rows',
            'blocked_rows',
            'source_complete',
            'blocked_reason',
        ])->all());

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    public function build(
        array $tagIds,
        int $days,
        array $orTagIds = [],
        array $notTagIds = [],
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        int $channelLimit = 1000,
        int $videoLimit = 50000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $days = max(1, min(365, $days));
        $keywordLimit = ReportCacheBuildGuardrails::bounded($keywordLimit, ReportCacheBuildGuardrails::KEYWORD_SCAN_LIMIT_MAX);
        $channelLimit = ReportCacheBuildGuardrails::bounded($channelLimit, ReportCacheBuildGuardrails::CHANNEL_SCAN_LIMIT_MAX);
        $videoLimit = ReportCacheBuildGuardrails::bounded($videoLimit, ReportCacheBuildGuardrails::VIDEO_SCAN_LIMIT_MAX);
        $tagIds = ReportCacheBuildGuardrails::ids($tagIds);
        $orTagIds = ReportCacheBuildGuardrails::ids($orTagIds);
        $notTagIds = ReportCacheBuildGuardrails::ids($notTagIds);
        $onlyKeywords = ReportCacheBuildGuardrails::keywords($onlyKeywords);
        $caps = $this->caps($keywordLimit, $channelLimit, $videoLimit);
        $lists = $this->listSummary($tagIds, $orTagIds, $notTagIds, [$days], $onlyKeywords);
        $generatedAt = $now->format('Y-m-d H:i:s');
        $keywords = [];
        $channelIds = [];
        $videos = [];
        $metrics = [
            'tags_result' => [],
            'count_tags' => 0,
            'count_videos' => 0,
            'total_views' => 0,
        ];

        $blockedReason = $this->listLimitReason($tagIds, $orTagIds, $notTagIds, [$days], $onlyKeywords);

        if ($blockedReason === null && count($onlyKeywords) > $keywordLimit) {
            $blockedReason = 'keyword_list_limit_exceeded';
        }

        if ($blockedReason !== null) {
            return $this->blockedPeriodPayload(
                tagIds: $tagIds,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                days: $days,
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
                return $this->blockedPeriodPayload($tagIds, $orTagIds, $notTagIds, $days, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'keyword_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned']);
            }

            $channelSelection = $this->channelIds($tagIds, $orTagIds, $notTagIds, $channelLimit);
            $channelIds = $channelSelection['rows'];

            if ($channelSelection['truncated']) {
                return $this->blockedPeriodPayload($tagIds, $orTagIds, $notTagIds, $days, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'channel_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned'], keywordsSelected: count($keywords), channelsMatched: count($channelIds));
            }

            $videoSelection = $this->videos($channelIds, $now, $days, $videoLimit);
            $videos = $videoSelection['rows'];

            if ($videoSelection['truncated']) {
                return $this->blockedPeriodPayload($tagIds, $orTagIds, $notTagIds, $days, $onlyKeywords, $execute, $generatedAt, $caps, $lists, 'video_scan_limit_exceeded', keywordRowsScanned: $keywordSelection['scanned'], keywordsSelected: count($keywords), channelsMatched: count($channelIds), videosScanned: count($videos));
            }

            $metrics = $this->metrics($keywords, $videos);

            if ($execute) {
                $this->upsertCache($tagIds, $orTagIds, $notTagIds, $days, $metrics, count($channelIds), $generatedAt, $onlyKeywords);
            }

            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'status' => 'success',
                'generated_at' => $generatedAt,
                'tagid' => implode(',', $tagIds),
                'or' => implode(',', $orTagIds),
                'not' => implode(',', $notTagIds),
                'days' => $days,
                'keyword_limit' => $keywordLimit,
                'keyword_rows_scanned' => $keywordSelection['scanned'],
                'channel_limit' => $channelLimit,
                'video_limit' => $videoLimit,
                'caps' => $caps,
                'lists' => $lists,
                'only_keywords' => $onlyKeywords,
                'cache_merge_mode' => $onlyKeywords === [] ? 'replace' : 'merge_selected_keywords',
                'keywords_selected' => count($keywords),
                'channels_matched' => count($channelIds),
                'videos_scanned' => count($videos),
                'tags_count' => count($metrics['tags_result']),
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
                'write_targets' => ['urt_show_tag_cloud'],
            ];

            Log::info('Tag cloud cache period completed.', $this->logContext($payload));

            return $payload;
        } catch (Throwable $exception) {
            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'status' => 'failed',
                'generated_at' => $generatedAt,
                'tagid' => implode(',', $tagIds),
                'or' => implode(',', $orTagIds),
                'not' => implode(',', $notTagIds),
                'days' => $days,
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
                'writes' => 0,
                'failed_rows' => 1,
                'blocked_rows' => 0,
                'source_complete' => false,
                'source_truncated' => false,
                'blocked_reason' => null,
                'failure_reason' => 'cache_period_processing_failed',
                'exit_code' => 1,
                'write_targets' => ['urt_show_tag_cloud'],
            ];

            Log::warning('Tag cloud cache period failed.', $this->logContext($payload) + [
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
            'days',
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
    private function caps(int $keywordLimit, int $channelLimit, int $videoLimit): array
    {
        return [
            'tag_ids_per_list' => ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT,
            'periods' => ReportCacheBuildGuardrails::PERIOD_LIST_LIMIT,
            'explicit_keywords' => ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT,
            'keyword_scan' => $keywordLimit,
            'channel_scan' => $channelLimit,
            'video_scan_per_period' => $videoLimit,
        ];
    }

    private function listLimitReason(array $tagIds, array $orTagIds, array $notTagIds, array $daysList, array $onlyKeywords): ?string
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
    private function listSummary(array $tagIds, array $orTagIds, array $notTagIds, array $daysList, array $onlyKeywords): array
    {
        $summary = fn (array $values, int $limit): array => [
            'requested' => count($values),
            'selected' => count($values) > $limit ? 0 : count($values),
            'limit' => $limit,
            'truncated' => count($values) > $limit,
        ];

        return [
            'tagid' => $summary($tagIds, ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT),
            'or' => $summary($orTagIds, ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT),
            'not' => $summary($notTagIds, ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT),
            'periods' => $summary($daysList, ReportCacheBuildGuardrails::PERIOD_LIST_LIMIT),
            'keywords' => $summary($onlyKeywords, ReportCacheBuildGuardrails::KEYWORD_LIST_LIMIT),
        ];
    }

    /**
     * @param  array<string, int>  $caps
     * @return array<string, mixed>
     */
    private function blockedBatchPayload(
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        array $daysList,
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
            'days_list' => $daysList,
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
            'write_targets' => ['urt_show_tag_cloud'],
        ];

        Log::warning('Tag cloud cache batch blocked.', collect($payload)->only([
            'mode',
            'status',
            'tagid',
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
    private function blockedPeriodPayload(
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        int $days,
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
            'days' => $days,
            'keyword_limit' => $caps['keyword_scan'],
            'keyword_rows_scanned' => $keywordRowsScanned,
            'channel_limit' => $caps['channel_scan'],
            'video_limit' => $caps['video_scan_per_period'],
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
            'writes' => 0,
            'failed_rows' => 1,
            'blocked_rows' => 1,
            'source_complete' => false,
            'source_truncated' => true,
            'blocked_reason' => $reason,
            'failure_reason' => 'source_incomplete',
            'exit_code' => 1,
            'write_targets' => ['urt_show_tag_cloud'],
        ];

        Log::warning('Tag cloud cache period blocked.', $this->logContext($payload));

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
    private function videos(array $channelIds, CarbonImmutable $now, int $days, int $limit): array
    {
        if ($channelIds === []) {
            return ['rows' => [], 'truncated' => false];
        }

        $from = $now->subDays($days)->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        $rows = DB::table('urt_video')
            ->select(['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'description', 'viewCount'])
            ->whereIn('u_id', $channelIds)
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
     * @return array{tags_result: array<string, string>, count_tags: int, count_videos: int, total_views: int}
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

        $tagsResult = [];

        foreach ($rawCounts as $tag => $count) {
            $lengthWeight = log(mb_strlen($tag, 'UTF-8') + 0.5) - 0.5;
            $score = $count * $lengthWeight / (float) ($keywordDivisors[$tag] ?? 0.5);

            if ($score > 0) {
                $tagsResult[$tag] = sprintf('%.3f', $score);
            }
        }

        arsort($tagsResult);

        return [
            'tags_result' => $tagsResult,
            'count_tags' => $countTags,
            'count_videos' => count($videos),
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @param  array{tags_result: array<string, string>, count_tags: int, count_videos: int, total_views: int}  $metrics
     */
    private function upsertCache(
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        int $days,
        array $metrics,
        int $countChannels,
        string $generatedAt,
        array $onlyKeywords,
    ): void {
        $tagIdString = implode(',', $tagIds);
        $tagOrString = $orTagIds === [] ? null : implode(',', $orTagIds);
        $tagNotString = $notTagIds === [] ? null : implode(',', $notTagIds);

        DB::transaction(function () use ($tagIdString, $tagOrString, $tagNotString, $days, $metrics, $countChannels, $generatedAt, $onlyKeywords): void {
            $query = DB::table('urt_show_tag_cloud')
                ->where('days', $days)
                ->where('tagid', $tagIdString)
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

            $existing = (clone $query)->first();
            $tagsResult = $metrics['tags_result'];
            $countTags = $metrics['count_tags'];

            if ($existing !== null && $onlyKeywords !== []) {
                $existingTags = $this->existingKeywordMap($existing->tags_result ?? null);

                if ($existingTags === null) {
                    throw new \RuntimeException('existing tag cloud cache payload is malformed');
                }

                foreach ($onlyKeywords as $keyword) {
                    unset($existingTags[$keyword]);
                }

                $tagsResult = [...$existingTags, ...$metrics['tags_result']];
                $countTags = (int) ($existing->count_tags ?? $metrics['count_tags']);
            }

            $payload = [
                'mtime' => $generatedAt,
                'count_channels' => $countChannels,
                'count_videos' => $metrics['count_videos'],
                'count_tags' => $countTags,
                'days' => $days,
                'tags_count' => count($tagsResult),
                'tags_result' => json_encode($tagsResult, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ];

            if ($existing !== null) {
                $query->update($payload);

                return;
            }

            if (Schema::hasColumn('urt_show_tag_cloud', 'ctime')) {
                $payload['ctime'] = $generatedAt;
            }

            $payload['tagid'] = $tagIdString;
            $payload['tag_or'] = $tagOrString;
            $payload['tag_not'] = $tagNotString;
            DB::table('urt_show_tag_cloud')->insert($payload);
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
}
