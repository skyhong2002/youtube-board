<?php

namespace App\Services\Legacy;

use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class TagDailyRelationReport
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
        $filters = $this->tagFilter->filters($request);

        if ($tagId !== null && $tagId > 0) {
            array_unshift($filters['tagid'], $tagId);
            $filters['tagid'] = collect($filters['tagid'])->unique()->values()->all();
        }

        $type = $this->type($request->query('type'), 'tags_result');
        $range = $this->range($request);
        $tagNames = $this->safeTagNames();
        $title = $this->tagTitle($filters, $tagNames).' 在 '.$range['display_days'].' 天的逐日排行';

        try {
            return $this->result([
                'mode' => 'tag',
                'title' => $title,
                'subject' => $this->tagTitle($filters, $tagNames),
                'type' => $type,
                'range' => $range,
                'filters' => $this->displayTagFilters($filters, $type, $range, $request),
            ], $this->tagCache($filters, $range, $type, (bool) $request->boolean('diff', true)));
        } catch (QueryException) {
            return $this->empty($title, 'tag', $type, $range, '本機尚未匯入 `urt_show_tag_date` cache table。', $this->tagTitle($filters, $tagNames));
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function forKeyword(Request $request, string $keyword): array
    {
        $keyword = trim(urldecode($keyword)) ?: '蔡英文';
        $type = $this->type($request->query('type'), 'tags_video');
        $range = $this->range($request);
        $title = $keyword.' 在 '.$range['display_days'].' 天的逐日排行';
        $base = [
            'mode' => 'keyword',
            'title' => $title,
            'subject' => $keyword,
            'type' => $type,
            'range' => $range,
            'filters' => $this->displayKeywordFilters($keyword, $type, $range, $request),
        ];

        try {
            $cache = $this->keywordCache($keyword, $range, (bool) $request->boolean('diff', true));

            if ($cache['rows'] === []) {
                $fallback = $this->keywordDerivedCache($keyword, $range, (bool) $request->boolean('diff', true));

                if ($fallback['rows'] !== []) {
                    $cache = $fallback;
                }
            }

            return $this->result($base, $cache);
        } catch (QueryException) {
            $fallback = $this->keywordDerivedCache($keyword, $range, (bool) $request->boolean('diff', true));

            if ($fallback['rows'] !== []) {
                return $this->result($base, $fallback);
            }

            return $this->empty($title, 'keyword', $type, $range, '本機尚未匯入 `urt_show_video_tag_date` cache table，且無法從本機 `urt_video` / `tags` 推導資料。', $keyword);
        }
    }

    private function type(mixed $value, string $default): string
    {
        $type = is_string($value) && $value !== '' ? $value : $default;

        if ($type === 'tags_view') {
            $type = 'tags_views';
        }

        return in_array($type, ['tags_result', 'tags_video', 'tags_views'], true) ? $type : $default;
    }

    /**
     * @return array{from: string, to: string, dates: list<string>, display_days: int}
     */
    private function range(Request $request): array
    {
        $requestedDays = max(1, min(90, (int) $request->query('days', 7)));
        $todayOffset = max(0, min(3650, (int) $request->query('today', 0)));

        if ($request->filled('from') || $request->filled('to')) {
            $fallbackTo = now('Asia/Taipei')->subDays($todayOffset)->toDateString();
            $from = $this->dateString($request->query('from'), Carbon::parse($fallbackTo, 'Asia/Taipei')->subDays($requestedDays)->toDateString());
            $to = $this->dateString($request->query('to'), $fallbackTo);
        } else {
            $to = now('Asia/Taipei')->subDays($todayOffset)->toDateString();
            $from = Carbon::parse($to, 'Asia/Taipei')->subDays($requestedDays)->toDateString();
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $dates = [];
        $cursor = Carbon::parse($from, 'Asia/Taipei');
        $end = Carbon::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 91) {
            $dates[] = $cursor->toDateString();
            $cursor->addDay();
        }

        return [
            'from' => $from,
            'to' => $to,
            'dates' => $dates,
            'display_days' => max(1, count($dates) - 1),
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array{from: string, to: string, dates: list<string>} $range
     * @return array<string, mixed>
     */
    private function tagCache(array $filters, array $range, string $type, bool $diff): array
    {
        $query = DB::table('urt_show_tag_date')
            ->whereBetween('the_date', [$range['from'], $range['to']]);

        $this->whereLegacyFilter($query, 'tagid', $this->normalizedList($filters['tagid']));
        $this->whereLegacyFilter($query, 'tag_or', $this->normalizedList($filters['or']));
        $this->whereLegacyFilter($query, 'tag_not', $this->normalizedList($filters['not']));

        $records = $query->orderByDesc('pk')->get();

        return $this->buildCache($range['dates'], $records, $type, $diff, 'tags') + [
            'source' => 'urt_show_tag_date cache',
        ];
    }

    /**
     * @param array{from: string, to: string, dates: list<string>} $range
     * @return array<string, mixed>
     */
    private function keywordCache(string $keyword, array $range, bool $diff): array
    {
        $records = DB::table('urt_show_video_tag_date')
            ->where('tag', $keyword)
            ->whereBetween('the_date', [$range['from'], $range['to']])
            ->orderByDesc('pk')
            ->get();

        return $this->buildCache($range['dates'], $records, 'tags_json', $diff, 'keyword') + [
            'source' => 'urt_show_video_tag_date cache',
        ];
    }

    /**
     * @param array{from: string, to: string, dates: list<string>} $range
     * @return array<string, mixed>
     */
    private function keywordDerivedCache(string $keyword, array $range, bool $diff): array
    {
        $records = $this->keywordRelationFallback->relationRecords($keyword, $range['dates']);
        $cache = $this->buildCache($range['dates'], $records, 'tags_json', $diff, 'keyword');
        $cache['cache_rows'] = 0;

        return $cache + [
            'source' => 'urt_video + tags derived real-time YouTube dashboard',
        ];
    }

    /**
     * @param list<string> $dates
     * @param iterable<object> $records
     * @return array{cache_rows: int, rows: list<array{rank: int, cells: array<string, array{tag: string, value: float, total: float}|null>}>, metrics: array<string, array{count_channels: int|null, count_videos: int|null, total_views: int|null}>, diff: bool}
     */
    private function buildCache(array $dates, iterable $records, string $jsonColumn, bool $diff, string $mode): array
    {
        $byDate = [];
        $cacheRows = 0;

        foreach ($records as $record) {
            $date = (string) ($record->the_date ?? '');

            if ($date === '' || isset($byDate[$date])) {
                continue;
            }

            $cacheRows++;
            $byDate[$date] = $record;
        }

        $stopwords = $this->stopwords->lookup();
        $daily = [];
        $totals = [];
        $metrics = [];

        foreach ($dates as $date) {
            $record = $byDate[$date] ?? null;
            $pairs = $record ? $this->decodePairs($record->{$jsonColumn} ?? null) : [];
            $pairs = collect($pairs)
                ->reject(fn (float $value, string $tag): bool => isset($stopwords[$tag]))
                ->all();

            arsort($pairs);
            $daily[$date] = $pairs;
            $metrics[$date] = [
                'count_channels' => $record ? (int) ($record->count_channels ?? 0) : null,
                'count_videos' => $record ? (int) ($record->count_videos ?? 0) : null,
                'total_views' => $mode === 'tags' && $record ? (int) ($record->total_views ?? 0) : null,
            ];

            foreach ($pairs as $tag => $value) {
                $totals[$tag] = ($totals[$tag] ?? 0) + $value;
            }
        }

        $ranked = [];
        $dayCount = max(1, count($dates));

        foreach ($dates as $date) {
            $pairs = $daily[$date];

            if ($diff) {
                $pairs = collect($pairs)
                    ->mapWithKeys(fn (float $value, string $tag): array => [$tag => $value - (($totals[$tag] ?? 0) / $dayCount)])
                    ->sortDesc()
                    ->all();
            }

            $ranked[$date] = collect($pairs)
                ->take(31)
                ->map(fn (float $value, string $tag): array => [
                    'tag' => $tag,
                    'value' => $value,
                    'total' => (float) ($totals[$tag] ?? $value),
                ])
                ->values()
                ->all();
        }

        $rows = [];

        for ($rank = 0; $rank < 31; $rank++) {
            $cells = [];
            $hasCell = false;

            foreach ($dates as $date) {
                $cells[$date] = $ranked[$date][$rank] ?? null;
                $hasCell = $hasCell || $cells[$date] !== null;
            }

            if ($hasCell) {
                $rows[] = ['rank' => $rank + 1, 'cells' => $cells];
            }
        }

        return [
            'cache_rows' => $cacheRows,
            'rows' => $rows,
            'metrics' => $metrics,
            'diff' => $diff,
        ];
    }

    /**
     * @return array<string, float>
     */
    private function decodePairs(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        $decoded = $this->unwrapPairs($decoded);

        return collect($decoded)
            ->mapWithKeys(function (mixed $value, mixed $key): array {
                if (is_array($value)) {
                    $tag = (string) ($value['tag'] ?? $value['keyword'] ?? $value['word'] ?? $key);
                    $count = $value['count'] ?? $value['weight'] ?? $value['score'] ?? $value['value'] ?? null;

                    return $tag !== '' && is_numeric($count) ? [$tag => (float) $count] : [];
                }

                return is_string($key) && is_numeric($value) ? [$key => (float) $value] : [];
            })
            ->all();
    }

    /**
     * @param array<mixed> $decoded
     * @return array<mixed>
     */
    private function unwrapPairs(array $decoded): array
    {
        foreach (['tags_result', 'tags_video', 'tags_views', 'tags_json', 'tags', 'result', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return $decoded[$key];
            }
        }

        return $decoded;
    }

    /**
     * @param list<int> $values
     */
    private function normalizedList(array $values): ?string
    {
        $values = collect($values)
            ->map(fn (mixed $value): int => (int) $value)
            ->filter(fn (int $value): bool => $value > 0)
            ->unique()
            ->sort()
            ->values();

        return $values->isEmpty() ? null : $values->implode(',');
    }

    private function whereLegacyFilter(Builder $query, string $column, ?string $value): void
    {
        if ($value === null || $value === '') {
            $query->where(function (Builder $query) use ($column): void {
                $query->whereNull($column)->orWhere($column, '');
            });

            return;
        }

        $query->where($column, $value);
    }

    /**
     * @return array<int, string>
     */
    private function safeTagNames(): array
    {
        try {
            return $this->tagFilter->tagNames();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array<int, string> $tagNames
     */
    private function tagTitle(array $filters, array $tagNames): string
    {
        $ids = collect([...$filters['tagid'], ...$filters['or']])
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return '全部標籤';
        }

        return $ids
            ->map(fn (int $id): string => $tagNames[$id] ?? (string) $id)
            ->implode(' ');
    }

    /**
     * @param array<string, mixed> $base
     * @param array<string, mixed> $cache
     * @return array<string, mixed>
     */
    private function result(array $base, array $cache): array
    {
        return $base + $cache + [
            'available' => true,
            'unavailable_reason' => null,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array{from: string, to: string} $range
     * @return array<string, string|int>
     */
    private function displayTagFilters(array $filters, string $type, array $range, Request $request): array
    {
        return array_filter([
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
            'type' => $type,
            'from' => $range['from'],
            'to' => $range['to'],
            'diff' => $request->boolean('diff', true) ? 1 : 0,
        ], fn (mixed $value): bool => $value !== '');
    }

    /**
     * @param array{from: string, to: string} $range
     * @return array<string, string|int>
     */
    private function displayKeywordFilters(string $keyword, string $type, array $range, Request $request): array
    {
        return [
            'tag' => $keyword,
            'type' => $type,
            'from' => $range['from'],
            'to' => $range['to'],
            'diff' => $request->boolean('diff', true) ? 1 : 0,
        ];
    }

    /**
     * @param array{from: string, to: string, dates: list<string>, display_days: int} $range
     * @return array<string, mixed>
     */
    private function empty(string $title, string $mode, string $type, array $range, string $reason, string $subject): array
    {
        return [
            'available' => false,
            'unavailable_reason' => $reason,
            'mode' => $mode,
            'title' => $title,
            'subject' => $subject,
            'type' => $type,
            'range' => $range,
            'filters' => [],
            'cache_rows' => 0,
            'rows' => [],
            'metrics' => [],
            'diff' => true,
            'source' => 'unavailable',
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
