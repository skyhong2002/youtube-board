<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TagCloudReport
{
    public function __construct(
        private readonly LegacyTagFilter $tagFilter,
        private readonly LegacyStopwords $stopwords,
        private readonly KeywordRelationFallback $keywordRelationFallback,
    )
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forTagFilters(Request $request, ?int $tagId = null): array
    {
        $filters = $this->cacheFilters($request, $tagId);
        $days = $this->days($request, 3);
        $longDays = $this->longDays($days);
        $limit = $this->limit($request);
        $short = $this->tagCache($filters, $days);
        $long = $this->tagCache($filters, $longDays);
        $rows = $this->adjustedRows($short['words'], $long['words'], $days, $longDays, $limit);

        if (! $request->query->has('days') && $rows === []) {
            foreach ([7, 30] as $fallbackDays) {
                $fallbackLongDays = $this->longDays($fallbackDays);
                $fallbackShort = $this->tagCache($filters, $fallbackDays);
                $fallbackLong = $this->tagCache($filters, $fallbackLongDays);
                $fallbackRows = $this->adjustedRows($fallbackShort['words'], $fallbackLong['words'], $fallbackDays, $fallbackLongDays, $limit);

                if (count($fallbackRows) >= 2) {
                    $days = $fallbackDays;
                    $longDays = $fallbackLongDays;
                    $short = $fallbackShort;
                    $long = $fallbackLong;
                    $rows = $fallbackRows;
                    break;
                }
            }
        }

        $subject = $this->tagTitle($filters);

        return $this->payload(
            mode: 'tag',
            subject: $subject,
            title: $subject.' 在 '.$days.' 天的文字雲',
            legacyFile: 'cloud.php + api/tags_video.php',
            cacheTable: 'urt_show_tag_cloud',
            dependencies: ['urt_show_tag_cloud', 'urt_video', 'urt_count'],
            filters: $filters,
            days: $days,
            longDays: $longDays,
            limit: $limit,
            rows: $rows,
            short: $short,
            long: $long,
            blockedReason: 'local tag cloud cache is missing or empty; legacy `api/tags_video.php` generation is intentionally not run',
            keyword: null,
            tagId: $tagId,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function forKeyword(Request $request, string $keyword): array
    {
        $keyword = trim(urldecode($keyword)) ?: '蔡英文';
        $filters = $this->cacheFilters($request);
        $days = $this->days($request, 7);
        $longDays = $this->longDays($days);
        $limit = $this->limit($request);
        $short = $this->keywordCache($keyword, $filters, $days);
        $long = $this->keywordCache($keyword, $filters, $longDays);
        $rows = $this->adjustedRows($short['words'], $long['words'], $days, $longDays, $limit);
        $subject = $this->tagTitle($filters);

        return $this->payload(
            mode: 'keyword',
            subject: $keyword,
            title: $keyword.' 用 '.$subject.' 在 '.$days.' 天的文字雲',
            legacyFile: 'tag_cloud.php + api/tag_tags_days.php',
            cacheTable: 'urt_show_tag_cloud_tag',
            dependencies: ['urt_show_tag_cloud_tag', 'urt_show_video_tag', 'urt_video_log_history'],
            filters: $filters,
            days: $days,
            longDays: $longDays,
            limit: $limit,
            rows: $rows,
            short: $short,
            long: $long,
            blockedReason: 'local keyword cloud cache and raw video/title fallback are empty; legacy `api/tag_tags_days.php` generation is intentionally not run',
            keyword: $keyword,
            tagId: null,
        );
    }

    /**
     * @param array<string, mixed> $filters
     * @param array<string, mixed> $short
     * @param array<string, mixed> $long
     * @param list<array<string, mixed>> $dependencies
     * @param list<array{word: string, score: float, short_score: float, long_score: float}> $rows
     * @return array<string, mixed>
     */
    private function payload(
        string $mode,
        string $subject,
        string $title,
        string $legacyFile,
        string $cacheTable,
        array $dependencies,
        array $filters,
        int $days,
        int $longDays,
        int $limit,
        array $rows,
        array $short,
        array $long,
        string $blockedReason,
        ?string $keyword,
        ?int $tagId,
    ): array {
        return [
            'mode' => $mode,
            'subject' => $subject,
            'section_title' => $mode === 'keyword' ? '關鍵字文字雲' : '標籤文字雲',
            'title' => $title,
            'legacy_file' => $legacyFile,
            'cache_table' => $cacheTable,
            'filters' => $this->displayFilters($filters, $keyword),
            'cache_filters' => $filters,
            'keyword' => $keyword,
            'tag_id' => $tagId,
            'days' => $days,
            'long_days' => $longDays,
            'limit' => $limit,
            'rows' => $rows,
            'short_rows' => $this->rawRows($short['words'], $limit),
            'long_rows' => $this->rawRows($long['words'], $limit),
            'max_score' => collect($rows)->max('score') ?: 0.0,
            'short_cache' => $short,
            'long_cache' => $long,
            'data_available' => $rows !== [],
            'blocked_reason' => $rows === [] ? $blockedReason : null,
            'dependencies' => collect($dependencies)
                ->map(fn (string $table): array => $this->dependency($table))
                ->values()
                ->all(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     * @return array{available: bool, source: string, row: object|null, counts: array<string, int>, mtime: mixed, words: array<string, float>}
     */
    private function tagCache(array $filters, int $days): array
    {
        try {
            $query = DB::table('urt_show_tag_cloud')
                ->where('days', $days)
                ->where('tags_count', '>', 0)
                ->orderByDesc('pk');
            $this->applyCacheFilters($query, $filters);
            $row = $query->first();

            return $this->cachePayload('urt_show_tag_cloud', $row, $this->normalizeWords($this->decodeMap($row->tags_result ?? null)));
        } catch (QueryException) {
            return $this->cachePayload('urt_show_tag_cloud', null, []);
        }
    }

    /**
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     * @return array{available: bool, source: string, row: object|null, counts: array<string, int>, mtime: mixed, words: array<string, float>}
     */
    private function keywordCache(string $keyword, array $filters, int $days): array
    {
        try {
            $query = DB::table('urt_show_tag_cloud_tag')
                ->where('tag', $keyword)
                ->where('days', $days)
                ->orderByDesc('pk');
            $this->applyCacheFilters($query, $filters);
            $row = $query->first();
            $words = $this->normalizeWords($this->decodeMap($row->tags_result ?? null));

            if ($row !== null && $words !== []) {
                return $this->cachePayload('urt_show_tag_cloud_tag', $row, $words);
            }

            return $this->keywordRelationFallback->cloud($keyword, $filters, $days);
        } catch (QueryException) {
            return $this->keywordRelationFallback->cloud($keyword, $filters, $days);
        }
    }

    /**
     * @param array<string, float> $words
     * @return array{available: bool, source: string, row: object|null, counts: array<string, int>, mtime: mixed, words: array<string, float>}
     */
    private function cachePayload(string $source, ?object $row, array $words): array
    {
        return [
            'available' => $row !== null && $words !== [],
            'source' => $source,
            'row' => $row,
            'counts' => [
                'channels' => (int) ($row->count_channels ?? 0),
                'videos' => (int) ($row->count_videos ?? 0),
                'tags' => (int) ($row->count_tags ?? 0),
                'tags_count' => (int) ($row->tags_count ?? 0),
            ],
            'mtime' => $row->mtime ?? null,
            'words' => $words,
        ];
    }

    /**
     * @param array<string, float> $short
     * @param array<string, float> $long
     * @return list<array{word: string, score: float, short_score: float, long_score: float}>
     */
    private function adjustedRows(array $short, array $long, int $days, int $longDays, int $limit): array
    {
        $ratio = ($longDays + 1) / ($days + 1);
        $stopwords = $this->stopwords->lookup();
        $rows = [];

        foreach ($short as $word => $shortScore) {
            if (isset($stopwords[$word])) {
                continue;
            }

            $longScore = $long[$word] ?? 0.0;
            $score = $shortScore - ($longScore / $ratio);

            if ($score <= 0) {
                continue;
            }

            $rows[] = [
                'word' => $word,
                'score' => round($score, 3),
                'short_score' => round($shortScore, 3),
                'long_score' => round($longScore, 3),
            ];
        }

        usort($rows, fn (array $a, array $b): int => $b['score'] <=> $a['score']);

        return array_slice($rows, 0, $limit);
    }

    /**
     * @param array<string, float> $words
     * @return list<array{word: string, score: float}>
     */
    private function rawRows(array $words, int $limit): array
    {
        $stopwords = $this->stopwords->lookup();
        arsort($words);

        return collect($words)
            ->reject(fn (float $score, string $word): bool => isset($stopwords[$word]))
            ->take($limit)
            ->map(fn (float $score, string $word): array => [
                'word' => $word,
                'score' => round($score, 3),
            ])
            ->values()
            ->all();
    }

    /**
     * @param array<string, mixed> $decoded
     * @return array<string, float>
     */
    private function normalizeWords(array $decoded): array
    {
        $words = [];

        foreach ($decoded as $word => $value) {
            if (is_array($value) && array_is_list($decoded)) {
                $word = $value['word'] ?? $value['keyword'] ?? $value['tag'] ?? '';
                $value = $value['weight'] ?? $value['count'] ?? $value['score'] ?? $value['value'] ?? null;
            }

            $word = trim((string) $word);

            if ($word === '') {
                continue;
            }

            if (is_array($value)) {
                $value = $value['weight'] ?? $value['count'] ?? $value['score'] ?? null;
            }

            if (! is_numeric($value)) {
                continue;
            }

            $score = (float) $value;

            if ($score > 0) {
                $words[$word] = $score;
            }
        }

        arsort($words);

        return $words;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMap(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '' || trim($json) === 'null') {
            return [];
        }

        $decoded = json_decode($json, true);

        foreach (['result', 'keywords', 'keywords_json', 'tags_result', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return $decoded[$key];
            }
        }

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}
     */
    private function cacheFilters(Request $request, ?int $routeTagId = null): array
    {
        $tagid = $this->integerList($request->query('tagid'));

        if ($routeTagId !== null && $routeTagId > 0) {
            $tagid[] = $routeTagId;
        }

        $tagid = $this->uniqueSorted($tagid);
        $or = $this->uniqueSorted($this->integerList($request->query('or')));
        $not = $this->uniqueSorted($this->integerList($request->query('not')));

        return [
            'tagid' => $tagid,
            'or' => $or,
            'not' => $not,
            'tagid_string' => implode(',', $tagid),
            'or_string' => implode(',', $or),
            'not_string' => implode(',', $not),
        ];
    }

    /**
     * @return list<int>
     */
    private function integerList(mixed $value): array
    {
        if (is_array($value)) {
            $items = $value;
        } else {
            $items = explode(',', (string) $value);
        }

        return collect($items)
            ->map(fn (mixed $item): int => (int) trim((string) $item))
            ->filter(fn (int $item): bool => $item > 0)
            ->values()
            ->all();
    }

    /**
     * @param list<int> $values
     * @return list<int>
     */
    private function uniqueSorted(array $values): array
    {
        $values = collect($values)->unique()->values()->all();
        sort($values);

        return $values;
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters, ?string $keyword): array
    {
        return array_filter([
            'tag' => $keyword,
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
        ], fn (mixed $value): bool => $value !== null && $value !== '');
    }

    /**
     * @param array{tagid: list<int>, or: list<int>} $filters
     */
    private function tagTitle(array $filters): string
    {
        $ids = collect([...$filters['tagid'], ...$filters['or']])
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return '全部標籤';
        }

        try {
            $tagNames = $this->tagFilter->tagNames();
        } catch (QueryException) {
            $tagNames = [];
        }

        return $ids
            ->map(fn (int $id): string => $tagNames[$id] ?? (string) $id)
            ->implode(' ');
    }

    private function days(Request $request, int $fallback): int
    {
        return max(1, min(365, (int) $request->query('days', $fallback)));
    }

    private function longDays(int $days): int
    {
        return match ($days) {
            1 => 3,
            3 => 7,
            7 => 30,
            30 => 90,
            90 => 365,
            default => min(365, $days * 3),
        };
    }

    private function limit(Request $request): int
    {
        return max(1, min(1000, (int) $request->query('limit', 200)));
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     */
    private function applyCacheFilters($query, array $filters): void
    {
        $this->whereNullableEmptyString($query, 'tagid', $filters['tagid_string']);
        $this->whereNullableEmptyString($query, 'tag_or', $filters['or_string']);
        $this->whereNullableEmptyString($query, 'tag_not', $filters['not_string']);
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     */
    private function whereNullableEmptyString($query, string $column, string $value): void
    {
        if ($value !== '') {
            $query->where($column, $value);

            return;
        }

        $query->where(function ($query) use ($column): void {
            $query->where($column, '')
                ->orWhereNull($column);
        });
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table): array
    {
        try {
            $rows = DB::table($table)->count();

            return [
                'table' => $table,
                'rows' => $rows,
                'status' => $rows > 0 ? 'present' : 'empty',
            ];
        } catch (QueryException) {
            return [
                'table' => $table,
                'rows' => null,
                'status' => 'missing',
            ];
        }
    }
}
