<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class KeywordCloudCacheBuilder
{
    private const LOCK_KEY = 'ingestion:reports.keyword_cloud.build';

    private const LOCK_SECONDS = 1800;

    /**
     * @param  list<string>  $subjects
     * @param  list<int>  $daysList
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @return array<string, mixed>
     */
    public function build(
        array $subjects,
        array $daysList,
        array $tagIds = [],
        array $orTagIds = [],
        array $notTagIds = [],
        int $subjectLimit = 20,
        int $keywordLimit = 5000,
        int $videoLimit = 10000,
        int $channelLimit = 1000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $subjectLimit = max(1, min(100, $subjectLimit));
        $keywordLimit = max(1, min(5000, $keywordLimit));
        $videoLimit = max(1, min(10000, $videoLimit));
        $channelLimit = ReportCacheBuildGuardrails::bounded($channelLimit, ReportCacheBuildGuardrails::CHANNEL_SCAN_LIMIT_MAX);
        [$subjects, $invalidSubjects] = $this->subjects($subjects, $subjectLimit);
        $daysList = $this->days($daysList);
        $filters = [
            'tagid' => $this->normalizedIds($tagIds),
            'or' => $this->normalizedIds($orTagIds),
            'not' => $this->normalizedIds($notTagIds),
        ];

        $listBlockedReason = match (true) {
            count($subjects) > $subjectLimit => 'subject_list_limit_exceeded',
            count($subjects) > $keywordLimit => 'keyword_list_limit_exceeded',
            count($daysList) > 10 => 'period_list_limit_exceeded',
            count($filters['tagid']) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT => 'tagid_list_limit_exceeded',
            count($filters['or']) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT => 'or_tag_list_limit_exceeded',
            count($filters['not']) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT => 'not_tag_list_limit_exceeded',
            default => null,
        };

        if ($listBlockedReason !== null) {
            return $this->logged($this->emptyPayload(
                now: $now,
                execute: $execute,
                subjects: $subjects,
                invalidSubjects: $invalidSubjects,
                daysList: $daysList,
                filters: $filters,
                subjectLimit: $subjectLimit,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                reason: $listBlockedReason,
                sourceTruncated: true,
                channelLimit: $channelLimit,
            ));
        }

        if ($subjects === []) {
            return $this->logged($this->emptyPayload(
                now: $now,
                execute: $execute,
                subjects: $subjects,
                invalidSubjects: $invalidSubjects,
                daysList: $daysList,
                filters: $filters,
                subjectLimit: $subjectLimit,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                reason: 'missing_valid_keywords',
                channelLimit: $channelLimit,
            ));
        }

        $schemaBlock = $this->schemaBlock($filters);

        if ($schemaBlock !== null) {
            return $this->logged($this->emptyPayload(
                now: $now,
                execute: $execute,
                subjects: $subjects,
                invalidSubjects: $invalidSubjects,
                daysList: $daysList,
                filters: $filters,
                subjectLimit: $subjectLimit,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                reason: $schemaBlock,
                channelLimit: $channelLimit,
            ));
        }

        $lock = null;

        if ($execute) {
            $lock = Cache::lock(self::LOCK_KEY, self::LOCK_SECONDS);

            if (! $lock->get()) {
                return $this->logged($this->emptyPayload(
                    now: $now,
                    execute: true,
                    subjects: $subjects,
                    invalidSubjects: $invalidSubjects,
                    daysList: $daysList,
                    filters: $filters,
                    subjectLimit: $subjectLimit,
                    keywordLimit: $keywordLimit,
                    videoLimit: $videoLimit,
                    reason: 'lock_busy',
                    available: true,
                    channelLimit: $channelLimit,
                ));
            }
        }

        try {
            return $this->logged($this->process(
                now: $now,
                subjects: $subjects,
                invalidSubjects: $invalidSubjects,
                daysList: $daysList,
                filters: $filters,
                subjectLimit: $subjectLimit,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                channelLimit: $channelLimit,
                execute: $execute,
            ));
        } finally {
            $this->release($lock);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function logged(array $payload): array
    {
        $context = [
            'mode' => $payload['mode'] ?? 'unknown',
            'subjects_selected' => $payload['subjects_selected'] ?? 0,
            'days_list' => $payload['days_list'] ?? [],
            'videos_scanned' => $payload['videos_scanned'] ?? 0,
            'writes' => $payload['writes'] ?? 0,
            'failed_cache_rows' => $payload['failed_cache_rows'] ?? 0,
            'blocked_reason' => $payload['blocked_reason'] ?? null,
        ];

        if (($payload['blocked_reason'] ?? null) !== null || (int) ($payload['failed_cache_rows'] ?? 0) > 0) {
            Log::warning('Keyword cloud cache build completed with gaps.', $context);
        } else {
            Log::info('Keyword cloud cache build completed.', $context);
        }

        return $payload;
    }

    /**
     * @param  list<string>  $subjects
     * @param  list<string>  $invalidSubjects
     * @param  list<int>  $daysList
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     * @return array<string, mixed>
     */
    private function process(
        CarbonImmutable $now,
        array $subjects,
        array $invalidSubjects,
        array $daysList,
        array $filters,
        int $subjectLimit,
        int $keywordLimit,
        int $videoLimit,
        int $channelLimit,
        bool $execute,
    ): array {
        try {
            $keywordSelection = $this->keywords($subjects, $keywordLimit);

            if ($keywordSelection['truncated']) {
                return $this->emptyPayload(
                    now: $now,
                    execute: $execute,
                    subjects: $subjects,
                    invalidSubjects: $invalidSubjects,
                    daysList: $daysList,
                    filters: $filters,
                    subjectLimit: $subjectLimit,
                    keywordLimit: $keywordLimit,
                    videoLimit: $videoLimit,
                    reason: 'keyword_scan_limit_exceeded',
                    available: true,
                    sourceTruncated: true,
                    keywordsSelected: $keywordSelection['scanned'],
                    channelLimit: $channelLimit,
                );
            }

            $keywords = $keywordSelection['rows'];
            $channelSelection = $this->channelIds($filters, $channelLimit);

            if ($channelSelection['truncated']) {
                return $this->emptyPayload(
                    now: $now,
                    execute: $execute,
                    subjects: $subjects,
                    invalidSubjects: $invalidSubjects,
                    daysList: $daysList,
                    filters: $filters,
                    subjectLimit: $subjectLimit,
                    keywordLimit: $keywordLimit,
                    videoLimit: $videoLimit,
                    reason: 'channel_scan_limit_exceeded',
                    available: true,
                    sourceTruncated: true,
                    keywordsSelected: count($keywords),
                    channelLimit: $channelLimit,
                    channelsMatched: $channelSelection['scanned'],
                );
            }

            $channelIds = $channelSelection['rows'];
        } catch (Throwable) {
            return $this->emptyPayload(
                now: $now,
                execute: $execute,
                subjects: $subjects,
                invalidSubjects: $invalidSubjects,
                daysList: $daysList,
                filters: $filters,
                subjectLimit: $subjectLimit,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                reason: 'source_query_failed',
                channelLimit: $channelLimit,
            );
        }

        $rows = [];
        $videosScanned = 0;
        $wouldInsert = 0;
        $wouldUpdate = 0;
        $inserted = 0;
        $updated = 0;
        $unchanged = 0;
        $failedRows = 0;
        $blockedSubjects = 0;

        foreach ($subjects as $subject) {
            try {
                $videoSelection = $this->videos($subject, max($daysList), $channelIds, $videoLimit, $now);
                $videos = $videoSelection['rows'];
                $videosScanned += min(count($videos), $videoLimit);
            } catch (Throwable) {
                foreach ($daysList as $days) {
                    $rows[] = $this->failedRow($subject, $days, 'source_query_failed');
                    $failedRows++;
                }

                continue;
            }

            $subjectBlocked = false;

            foreach ($daysList as $days) {
                try {
                    $periodVideos = $this->periodVideos($videos, $days, $now);

                    if (count($periodVideos) > $videoLimit) {
                        $subjectBlocked = true;
                        $rows[] = $this->failedRow($subject, $days, 'video_scan_limit_exceeded', status: 'blocked');
                        $failedRows++;

                        continue;
                    }

                    $computed = $this->metrics($subject, $periodVideos, $keywords);
                    $existing = $this->existing($subject, $days, $filters);
                    $same = $existing !== null && $this->same($existing, $computed);
                    $status = $same ? 'unchanged' : ($existing === null ? 'would_insert' : 'would_update');

                    if ($status === 'would_insert') {
                        $wouldInsert++;
                    } elseif ($status === 'would_update') {
                        $wouldUpdate++;
                    } else {
                        $unchanged++;
                    }

                    if ($execute && ! $same) {
                        $this->upsert($subject, $days, $filters, $computed, $now);
                        $status = $existing === null ? 'inserted' : 'updated';
                        $status === 'inserted' ? $inserted++ : $updated++;
                    }

                    $rows[] = [
                        'tag' => $subject,
                        'days' => $days,
                        'status' => $status,
                        'reason' => null,
                        'count_channels' => $computed['count_channels'],
                        'count_videos' => $computed['count_videos'],
                        'count_tags' => $computed['count_tags'],
                        'tags_count' => $computed['tags_count'],
                    ];
                } catch (Throwable) {
                    $rows[] = $this->failedRow($subject, $days, 'cache_row_failed');
                    $failedRows++;
                }
            }

            if ($subjectBlocked) {
                $blockedSubjects++;
            }
        }

        return [
            'mode' => $execute ? 'execute' : 'dry-run',
            'available' => true,
            'blocked_reason' => $blockedSubjects > 0 ? 'source_incomplete' : null,
            'source_complete' => $blockedSubjects === 0 && $failedRows === 0,
            'source_truncated' => $blockedSubjects > 0,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'subjects' => $subjects,
            'subjects_selected' => count($subjects),
            'invalid_subjects' => $invalidSubjects,
            'subject_limit' => $subjectLimit,
            'days_list' => $daysList,
            'filters' => $this->filterStrings($filters),
            'keyword_limit' => $keywordLimit,
            'keywords_selected' => count($keywords),
            'channel_limit' => $channelLimit,
            'channels_matched' => $channelIds === null ? 0 : count($channelIds),
            'video_limit_per_subject' => $videoLimit,
            'videos_scanned' => $videosScanned,
            'rows_planned' => count($subjects) * count($daysList),
            'would_insert' => $wouldInsert,
            'would_update' => $wouldUpdate,
            'inserted' => $inserted,
            'updated' => $updated,
            'unchanged' => $unchanged,
            'failed_cache_rows' => $failedRows,
            'blocked_subjects' => $blockedSubjects,
            'rows' => $rows,
            'writes' => $inserted + $updated,
            'write_targets' => ['urt_show_tag_cloud_tag'],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => $execute,
                'ttl_seconds' => self::LOCK_SECONDS,
            ],
        ];
    }

    /**
     * @param  list<string>  $subjects
     * @return array{0: list<string>, 1: list<string>}
     */
    private function subjects(array $subjects, int $limit): array
    {
        $valid = [];
        $invalid = [];

        foreach ($subjects as $subject) {
            $subject = trim((string) $subject);

            if ($subject === '') {
                continue;
            }

            if (mb_strlen($subject, 'UTF-8') > 32) {
                $invalid[] = $subject;

                continue;
            }

            $valid[] = $subject;
        }

        return [
            collect($valid)->unique()->values()->all(),
            collect($invalid)->unique()->values()->all(),
        ];
    }

    /**
     * @return list<int>
     */
    private function days(array $daysList): array
    {
        $days = collect($daysList)
            ->map(fn (mixed $days): int => max(1, min(365, (int) $days)))
            ->unique()
            ->sort()
            ->values()
            ->all();

        return $days === [] ? [3, 7, 30] : $days;
    }

    /**
     * @return list<int>
     */
    private function normalizedIds(array $ids): array
    {
        return collect($ids)
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $subjects
     * @return array{rows: list<string>, scanned: int, truncated: bool}
     */
    private function keywords(array $subjects, int $limit): array
    {
        $query = DB::table('tags')->select('tag');

        if (Schema::hasColumn('tags', 'no_tag')) {
            $query->where(function (Builder $query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', '<', 1);
            });
        }

        if (Schema::hasColumn('tags', 'hours_count')) {
            $query->orderByDesc('hours_count');
        } else {
            $query->orderBy('tag');
        }

        $sourceRows = $query
            ->limit($limit + 1)
            ->pluck('tag');
        $truncated = $sourceRows->count() > $limit;
        $rows = collect($subjects)
            ->merge($sourceRows->take($limit))
            ->map(fn (mixed $keyword): string => trim((string) $keyword))
            ->filter(fn (string $keyword): bool => $this->eligibleKeyword($keyword))
            ->unique()
            ->take($limit)
            ->values()
            ->all();

        return [
            'rows' => $rows,
            'scanned' => min($sourceRows->count(), $limit),
            'truncated' => $truncated,
        ];
    }

    private function eligibleKeyword(string $keyword): bool
    {
        if ($keyword === '' || mb_strlen($keyword, 'UTF-8') <= 1 || is_numeric($keyword)) {
            return false;
        }

        return preg_match('/^[A-Za-z]+$/', $keyword) !== 1 || strlen($keyword) >= 3;
    }

    /**
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     * @return array{rows: list<int>|null, scanned: int, truncated: bool}
     */
    private function channelIds(array $filters, int $limit): array
    {
        if ($filters['tagid'] === [] && $filters['or'] === [] && $filters['not'] === []) {
            return ['rows' => null, 'scanned' => 0, 'truncated' => false];
        }

        $query = DB::table('urt_count')->select('u_id');

        if ($filters['or'] !== []) {
            $query->where(function (Builder $query) use ($filters): void {
                foreach ($filters['or'] as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($filters['tagid'] as $tagId) {
            $query->where('tags', 'like', '%['.$tagId.']%');
        }

        if ($filters['not'] !== []) {
            $query->where(function (Builder $query) use ($filters): void {
                foreach ($filters['not'] as $tagId) {
                    $query->where('tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        $ids = $query
            ->distinct()
            ->orderBy('u_id')
            ->limit($limit + 1)
            ->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();

        return [
            'rows' => array_slice($ids, 0, $limit),
            'scanned' => min(count($ids), $limit),
            'truncated' => count($ids) > $limit,
        ];
    }

    /**
     * @param  list<int>|null  $channelIds
     * @return array{rows: list<object>, truncated: bool}
     */
    private function videos(string $subject, int $days, ?array $channelIds, int $limit, CarbonImmutable $now): array
    {
        if ($channelIds === []) {
            return ['rows' => [], 'truncated' => false];
        }

        $like = '%'.addcslashes($subject, '\\%_').'%';
        $query = DB::table('urt_video')
            ->select(['videoId', 'u_id', 'publishedAt', 'title', 'description', 'viewCount'])
            ->whereBetween('publishedAt', [
                $now->subDays($days)->startOfDay()->format('Y-m-d H:i:s'),
                $now->format('Y-m-d H:i:s'),
            ])
            ->where(function (Builder $query) use ($like): void {
                $query->where('title', 'like', $like)->orWhere('description', 'like', $like);
            });

        if ($channelIds !== null) {
            $query->whereIn('u_id', $channelIds);
        }

        $rows = $query
            ->orderByDesc('publishedAt')
            ->orderBy('videoId')
            ->limit($limit + 1)
            ->get()
            ->all();

        return [
            'rows' => $rows,
            'truncated' => count($rows) > $limit,
        ];
    }

    /**
     * @param  list<object>  $videos
     * @return list<object>
     */
    private function periodVideos(array $videos, int $days, CarbonImmutable $now): array
    {
        $from = $now->subDays($days)->startOfDay()->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        return array_values(array_filter($videos, function (object $video) use ($from, $to): bool {
            $publishedAt = (string) ($video->publishedAt ?? '');

            return $publishedAt >= $from && $publishedAt <= $to;
        }));
    }

    /**
     * @param  list<object>  $videos
     * @param  list<string>  $keywords
     * @return array{count_channels: int, count_videos: int, count_tags: int, tags_count: int, tags_result: string, videos_json: string}
     */
    private function metrics(string $subject, array $videos, array $keywords): array
    {
        $tagData = [];
        $videosById = [];
        $channels = [];
        $countTags = 0;

        foreach ($videos as $video) {
            $counts = $this->detectKeywords($video, $keywords);
            $subjectCount = $counts[$subject] ?? 0;
            $sum = array_sum($counts);
            $videoId = trim((string) ($video->videoId ?? ''));

            if ($subjectCount <= 0 || $sum <= 0 || $videoId === '') {
                continue;
            }

            $uId = (int) ($video->u_id ?? 0);
            $views = max(0, (int) ($video->viewCount ?? 0));
            $factor = sqrt($subjectCount / $sum);
            $channels[$uId] = true;
            $countTags += $sum;
            $videosById[$videoId] = [
                'u_id' => $uId,
                'views' => $views,
                'published_at' => (string) ($video->publishedAt ?? ''),
            ];

            foreach ($counts as $keyword => $count) {
                $tagData[$keyword] ??= ['videos' => 0, 'views' => 0, 'weight' => 0.0];
                $tagData[$keyword]['videos']++;
                $tagData[$keyword]['views'] += $views;
                $tagData[$keyword]['weight'] += $views * $factor;
            }
        }

        uasort($tagData, function (array $left, array $right): int {
            return $right['weight'] <=> $left['weight'];
        });
        $tagData = collect($tagData)->map(fn (array $row): array => [
            'videos' => $row['videos'],
            'views' => $row['views'],
            'weight' => sprintf('%.2f', $row['weight']),
        ])->all();

        return [
            'count_channels' => count(array_filter(array_keys($channels), fn (int $uId): bool => $uId > 0)),
            'count_videos' => count($videosById),
            'count_tags' => $countTags,
            'tags_count' => count($tagData),
            'tags_result' => $this->json($tagData),
            'videos_json' => $this->json($videosById),
        ];
    }

    /**
     * @param  list<string>  $keywords
     * @return array<string, int>
     */
    private function detectKeywords(object $video, array $keywords): array
    {
        $text = ' '.(string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');
        $counts = [];
        $lengths = [];

        foreach ($keywords as $keyword) {
            $count = substr_count($text, $keyword);

            if ($count > 0) {
                $counts[$keyword] = $count;
                $lengths[$keyword] = mb_strlen($keyword, 'UTF-8');
            }
        }

        arsort($lengths);
        $ordered = array_keys($lengths);

        for ($i = 0; $i < count($ordered); $i++) {
            for ($j = $i + 1; $j < count($ordered); $j++) {
                $longer = $ordered[$i];
                $shorter = $ordered[$j];

                if (isset($counts[$shorter]) && str_contains($longer, $shorter)) {
                    $counts[$shorter] -= $counts[$longer] ?? 0;
                }
            }
        }

        return collect($counts)
            ->filter(fn (int $count): bool => $count > 0)
            ->sortDesc()
            ->all();
    }

    /**
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     */
    private function existing(string $subject, int $days, array $filters): ?object
    {
        $query = DB::table('urt_show_tag_cloud_tag')
            ->where('tag', $subject)
            ->where('days', $days)
            ->orderByDesc('pk');
        $this->applyFilters($query, $filters);

        return $query->first();
    }

    /**
     * @param  array{count_channels: int, count_videos: int, count_tags: int, tags_count: int, tags_result: string, videos_json: string}  $computed
     */
    private function same(object $existing, array $computed): bool
    {
        return (int) ($existing->count_channels ?? 0) === $computed['count_channels']
            && (int) ($existing->count_videos ?? 0) === $computed['count_videos']
            && (int) ($existing->count_tags ?? 0) === $computed['count_tags']
            && (int) ($existing->tags_count ?? 0) === $computed['tags_count']
            && $this->decoded($existing->tags_result ?? null) === $this->decoded($computed['tags_result'])
            && $this->decoded($existing->videos_json ?? null) === $this->decoded($computed['videos_json']);
    }

    /**
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     * @param  array{count_channels: int, count_videos: int, count_tags: int, tags_count: int, tags_result: string, videos_json: string}  $computed
     */
    private function upsert(string $subject, int $days, array $filters, array $computed, CarbonImmutable $now): void
    {
        $existing = $this->existing($subject, $days, $filters);
        $payload = [
            ...$computed,
            'mtime' => $now->format('Y-m-d H:i:s'),
        ];

        if ($existing !== null) {
            DB::table('urt_show_tag_cloud_tag')->where('pk', $existing->pk)->update($payload);

            return;
        }

        DB::table('urt_show_tag_cloud_tag')->insert([
            ...$payload,
            'ctime' => $now->format('Y-m-d H:i:s'),
            'tag' => $subject,
            'tagid' => implode(',', $filters['tagid']),
            'tag_or' => implode(',', $filters['or']),
            'tag_not' => implode(',', $filters['not']),
            'days' => $days,
        ]);
    }

    /**
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     */
    private function applyFilters(Builder $query, array $filters): void
    {
        $this->whereNullableString($query, 'tagid', implode(',', $filters['tagid']));
        $this->whereNullableString($query, 'tag_or', implode(',', $filters['or']));
        $this->whereNullableString($query, 'tag_not', implode(',', $filters['not']));
    }

    private function whereNullableString(Builder $query, string $column, string $value): void
    {
        if ($value !== '') {
            $query->where($column, $value);

            return;
        }

        $query->where(function (Builder $query) use ($column): void {
            $query->whereNull($column)->orWhere($column, '');
        });
    }

    /**
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     * @return array{tagid: string, or: string, not: string}
     */
    private function filterStrings(array $filters): array
    {
        return [
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
        ];
    }

    /**
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     */
    private function schemaBlock(array $filters): ?string
    {
        $required = [
            'urt_video' => ['videoId', 'u_id', 'publishedAt', 'title', 'description', 'viewCount'],
            'tags' => ['tag'],
            'urt_show_tag_cloud_tag' => ['pk', 'ctime', 'mtime', 'tag', 'tagid', 'tag_or', 'tag_not', 'count_channels', 'count_videos', 'count_tags', 'days', 'tags_count', 'tags_result', 'videos_json'],
        ];

        if ($filters['tagid'] !== [] || $filters['or'] !== [] || $filters['not'] !== []) {
            $required['urt_count'] = ['u_id', 'tags'];
        }

        foreach ($required as $table => $columns) {
            if (! Schema::hasTable($table)) {
                return 'missing_table:'.$table;
            }

            if (! Schema::hasColumns($table, $columns)) {
                return 'missing_columns:'.$table;
            }
        }

        return null;
    }

    /**
     * @return array<string, mixed>
     */
    private function failedRow(string $subject, int $days, string $reason, string $status = 'failed'): array
    {
        return [
            'tag' => $subject,
            'days' => $days,
            'status' => $status,
            'reason' => $reason,
            'count_channels' => 0,
            'count_videos' => 0,
            'count_tags' => 0,
            'tags_count' => 0,
        ];
    }

    /**
     * @param  list<string>  $subjects
     * @param  list<string>  $invalidSubjects
     * @param  list<int>  $daysList
     * @param  array{tagid: list<int>, or: list<int>, not: list<int>}  $filters
     * @return array<string, mixed>
     */
    private function emptyPayload(
        CarbonImmutable $now,
        bool $execute,
        array $subjects,
        array $invalidSubjects,
        array $daysList,
        array $filters,
        int $subjectLimit,
        int $keywordLimit,
        int $videoLimit,
        string $reason,
        bool $available = false,
        bool $sourceTruncated = false,
        int $keywordsSelected = 0,
        int $channelLimit = 1000,
        int $channelsMatched = 0,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'dry-run',
            'available' => $available,
            'blocked_reason' => $reason,
            'source_complete' => false,
            'source_truncated' => $sourceTruncated,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'subjects' => $subjects,
            'subjects_selected' => count($subjects),
            'invalid_subjects' => $invalidSubjects,
            'subject_limit' => $subjectLimit,
            'days_list' => $daysList,
            'filters' => $this->filterStrings($filters),
            'keyword_limit' => $keywordLimit,
            'keywords_selected' => $keywordsSelected,
            'channel_limit' => $channelLimit,
            'channels_matched' => $channelsMatched,
            'video_limit_per_subject' => $videoLimit,
            'videos_scanned' => 0,
            'rows_planned' => 0,
            'would_insert' => 0,
            'would_update' => 0,
            'inserted' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'failed_cache_rows' => 0,
            'blocked_subjects' => 0,
            'rows' => [],
            'writes' => 0,
            'write_targets' => ['urt_show_tag_cloud_tag'],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => false,
                'ttl_seconds' => self::LOCK_SECONDS,
            ],
        ];
    }

    /**
     * @return array<mixed>
     */
    private function decoded(mixed $value): array
    {
        if (! is_string($value)) {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function json(array $value): string
    {
        return (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function release(?Lock $lock): void
    {
        if ($lock === null) {
            return;
        }

        try {
            $lock->release();
        } catch (Throwable) {
            // An expired lock no longer needs cleanup.
        }
    }
}
