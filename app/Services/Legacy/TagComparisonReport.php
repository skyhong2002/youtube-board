<?php

namespace App\Services\Legacy;

use App\Services\Ingestion\TagDateCacheBuilder;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class TagComparisonReport
{
    private const DEFAULT_TAGS = ['蔡英文', '柯文哲', '侯友宜', '陳時中'];

    public function __construct(
        private readonly LegacyTagFilter $tagFilter,
        private readonly TagDateCacheBuilder $tagDateCacheBuilder,
    )
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forRequest(Request $request): array
    {
        $filters = $this->tagFilter->filters($request);

        if ($filters['tagid'] === [] && $filters['or'] === [] && $filters['not'] === []) {
            $filters['tagid'] = [1];
        }

        $type = $this->type($request->query('type'));
        $range = $this->range($request);
        $keywords = $this->keywords($request->query('tags'));
        $tagNames = $this->safeTagNames();
        $subject = $this->tagTitle($filters, $tagNames);
        $title = $subject.' 多關鍵字趨勢比較';

        try {
            $cache = $this->cache($filters, $range, $type, $keywords);

            return [
                'available' => true,
                'data_available' => collect($cache['series'])->contains(function (array $row): bool {
                    return collect($row['values'])->contains(fn (float $value): bool => $value > 0);
                }),
                'title' => $title,
                'subject' => $subject,
                'type' => $type,
                'type_name' => $this->typeName($type),
                'types' => $this->types(),
                'range' => $range,
                'keywords' => $keywords,
                'filters' => $this->displayFilters($filters, $type, $range, $keywords),
                'cache_rows' => $cache['cache_rows'],
                'source' => $cache['source'],
                'series' => $cache['series'],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'data_available' => false,
                'title' => $title,
                'subject' => $subject,
                'type' => $type,
                'type_name' => $this->typeName($type),
                'types' => $this->types(),
                'range' => $range,
                'keywords' => $keywords,
                'filters' => $this->displayFilters($filters, $type, $range, $keywords),
                'cache_rows' => 0,
                'source' => 'unavailable',
                'series' => [],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    private function type(mixed $value): string
    {
        $type = is_string($value) && $value !== '' ? $value : 'tags_views';

        $aliases = [
            'tags_view' => 'tags_views',
            'total_views' => 'tags_views',
            'count_videos' => 'tags_video',
        ];

        $type = $aliases[$type] ?? $type;

        return array_key_exists($type, $this->types()) ? $type : 'tags_views';
    }

    /**
     * @return array<string, string>
     */
    private function types(): array
    {
        return [
            'tags_video' => '影片數',
            'tags_views' => '觀看數',
            'tags_result' => '重要度',
        ];
    }

    private function typeName(string $type): string
    {
        return $this->types()[$type] ?? $this->types()['tags_views'];
    }

    /**
     * @return list<string>
     */
    private function keywords(mixed $value): array
    {
        if (! is_string($value) || trim($value) === '') {
            return self::DEFAULT_TAGS;
        }

        $keywords = collect(explode(',', $value))
            ->map(fn (string $keyword): string => trim($keyword))
            ->filter(fn (string $keyword): bool => $keyword !== '')
            ->unique()
            ->take(12)
            ->values()
            ->all();

        return $keywords !== [] ? $keywords : self::DEFAULT_TAGS;
    }

    /**
     * @return array{from: string, to: string, dates: list<string>, cache_from: string, display_days: int, days: int, today: int}
     */
    private function range(Request $request): array
    {
        $now = CarbonImmutable::now('Asia/Taipei');
        $requestedDays = max(1, min(90, (int) $request->query('days', 7)));
        $todayOffset = max(0, min(3650, (int) $request->query('today', 0)));
        $fallbackTo = $now->subDays($todayOffset)->toDateString();

        if ($request->filled('from') || $request->filled('to')) {
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($fallbackTo, 'Asia/Taipei')->subDays($requestedDays)->toDateString());
            $to = $this->dateString($request->query('to'), $fallbackTo);
        } else {
            $to = $fallbackTo;
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($requestedDays)->toDateString();
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $dates = [];
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 91) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return [
            'from' => $from,
            'to' => $to,
            'dates' => $dates,
            'cache_from' => CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(6)->toDateString(),
            'display_days' => max(1, count($dates) - 1),
            'days' => $requestedDays,
            'today' => $todayOffset,
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array{from: string, to: string, dates: list<string>, cache_from: string} $range
     * @param list<string> $keywords
     * @return array{cache_rows: int, source: string, series: list<array<string, mixed>>}
     */
    private function cache(array $filters, array $range, string $type, array $keywords): array
    {
        $query = DB::table('urt_show_tag_date')
            ->whereBetween('the_date', [$range['cache_from'], $range['to']]);

        $this->whereLegacyFilter($query, 'tagid', $this->normalizedList($filters['tagid']));
        $this->whereLegacyFilter($query, 'tag_or', $this->normalizedList($filters['or']));
        $this->whereLegacyFilter($query, 'tag_not', $this->normalizedList($filters['not']));

        $records = $query->orderByDesc('pk')->get();
        $byDate = $this->rowsByDate($records, $type);
        $source = 'urt_show_tag_date cache';

        if (! $this->hasKeywordData($byDate, $keywords) && $this->canAggregateSingletonTagRows($filters)) {
            $fallback = $this->aggregatedSingletonRowsByDate($filters['tagid'], $range, $type);

            if ($fallback !== [] && ($byDate === [] || $this->hasKeywordData($fallback, $keywords))) {
                $byDate = $fallback;
                $source = 'aggregated singleton urt_show_tag_date cache';
            }
        }

        if (! $this->hasKeywordData($byDate, $keywords)) {
            $fallback = $this->derivedRowsByDate($filters, $range, $type, $keywords);

            if ($fallback !== [] && ($byDate === [] || $this->hasKeywordData($fallback, $keywords))) {
                $byDate = $fallback;
                $source = 'derived local video fallback';
            }
        }

        $series = [];

        foreach ($range['dates'] as $date) {
            $values = [];

            foreach ($keywords as $keyword) {
                $sum = 0.0;

                for ($i = 0; $i <= 6; $i++) {
                    $priorDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($i)->toDateString();
                    $prior = $byDate[$priorDate] ?? null;

                    if (! $prior) {
                        continue;
                    }

                    $value = (float) ($prior['pairs'][$keyword] ?? 0);
                    $sum += $type === 'tags_result' ? $value * 100 : $value;
                }

                $values[$keyword] = $sum;
            }

            $record = $byDate[$date] ?? null;
            $series[] = [
                'date' => $date,
                'has_record' => $record !== null,
                'values' => $values,
                'count_channels' => $record ? $record['count_channels'] : null,
                'count_videos' => $record ? $record['count_videos'] : null,
                'total_views' => $record ? $record['total_views'] : null,
            ];
        }

        return [
            'cache_rows' => (int) collect($byDate)->sum('cache_rows'),
            'source' => $source,
            'series' => $series,
        ];
    }

    /**
     * @param array<string, array{pairs: array<string, float>}> $byDate
     * @param list<string> $keywords
     */
    private function hasKeywordData(array $byDate, array $keywords): bool
    {
        foreach ($byDate as $row) {
            foreach ($keywords as $keyword) {
                if ((float) ($row['pairs'][$keyword] ?? 0) > 0) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * @return array<string, array{pairs: array<string, float>, count_channels: int, count_videos: int, total_views: int, cache_rows: int}>
     */
    private function rowsByDate(iterable $records, string $type): array
    {
        $byDate = [];

        foreach ($records as $record) {
            $date = substr((string) ($record->the_date ?? ''), 0, 10);

            if ($date === '' || isset($byDate[$date])) {
                continue;
            }

            $byDate[$date] = [
                'pairs' => $this->decodePairs($record->{$type} ?? null),
                'count_channels' => (int) ($record->count_channels ?? 0),
                'count_videos' => (int) ($record->count_videos ?? 0),
                'total_views' => (int) ($record->total_views ?? 0),
                'cache_rows' => 1,
            ];
        }

        return $byDate;
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     */
    private function canAggregateSingletonTagRows(array $filters): bool
    {
        return count($filters['tagid']) > 1
            && $filters['or'] === []
            && $filters['not'] === [];
    }

    /**
     * @param list<int> $tagIds
     * @param array{cache_from: string, to: string} $range
     * @return array<string, array{pairs: array<string, float>, count_channels: int, count_videos: int, total_views: int, cache_rows: int}>
     */
    private function aggregatedSingletonRowsByDate(array $tagIds, array $range, string $type): array
    {
        $records = DB::table('urt_show_tag_date')
            ->whereBetween('the_date', [$range['cache_from'], $range['to']])
            ->whereIn('tagid', collect($tagIds)->map(fn (int $tagId): string => (string) $tagId)->all())
            ->where(function (Builder $query): void {
                $query->whereNull('tag_or')->orWhere('tag_or', '');
            })
            ->where(function (Builder $query): void {
                $query->whereNull('tag_not')->orWhere('tag_not', '');
            })
            ->orderByDesc('pk')
            ->get();

        $latest = [];

        foreach ($records as $record) {
            $date = substr((string) ($record->the_date ?? ''), 0, 10);
            $tagId = (int) ($record->tagid ?? 0);
            $key = $date.'|'.$tagId;

            if ($date === '' || $tagId <= 0 || isset($latest[$key])) {
                continue;
            }

            $latest[$key] = $record;
        }

        $byDate = [];

        foreach ($latest as $record) {
            $date = substr((string) ($record->the_date ?? ''), 0, 10);

            if ($date === '') {
                continue;
            }

            if (! isset($byDate[$date])) {
                $byDate[$date] = [
                    'pairs' => [],
                    'count_channels' => 0,
                    'count_videos' => 0,
                    'total_views' => 0,
                    'cache_rows' => 0,
                ];
            }

            foreach ($this->decodePairs($record->{$type} ?? null) as $keyword => $value) {
                $byDate[$date]['pairs'][$keyword] = (float) ($byDate[$date]['pairs'][$keyword] ?? 0) + $value;
            }

            $byDate[$date]['count_channels'] += (int) ($record->count_channels ?? 0);
            $byDate[$date]['count_videos'] += (int) ($record->count_videos ?? 0);
            $byDate[$date]['total_views'] += (int) ($record->total_views ?? 0);
            $byDate[$date]['cache_rows']++;
        }

        return $byDate;
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array{cache_from: string, to: string} $range
     * @param list<string> $keywords
     * @return array<string, array{pairs: array<string, float>, count_channels: int, count_videos: int, total_views: int, cache_rows: int}>
     */
    private function derivedRowsByDate(array $filters, array $range, string $type, array $keywords): array
    {
        if (! $this->canDeriveRows()) {
            return [];
        }

        if ($this->canAggregateSingletonTagRows($filters)) {
            return $this->derivedSingletonRowsByDate($filters['tagid'], $range, $type, $keywords);
        }

        return $this->derivedFilterRowsByDate($filters['tagid'], $filters['or'], $filters['not'], $range, $type, $keywords);
    }

    private function canDeriveRows(): bool
    {
        return Schema::hasTable('urt_video')
            && Schema::hasTable('urt_count')
            && Schema::hasTable('tags');
    }

    /**
     * @param list<int> $tagIds
     * @param array{cache_from: string, to: string} $range
     * @param list<string> $keywords
     * @return array<string, array{pairs: array<string, float>, count_channels: int, count_videos: int, total_views: int, cache_rows: int}>
     */
    private function derivedSingletonRowsByDate(array $tagIds, array $range, string $type, array $keywords): array
    {
        $byDate = [];

        foreach ($this->datesForCacheRange($range) as $date) {
            foreach ($tagIds as $tagId) {
                $row = $this->derivedBuildRow([$tagId], [], [], $date, $type, $keywords);

                if ($row === null) {
                    continue;
                }

                if (! isset($byDate[$date])) {
                    $byDate[$date] = [
                        'pairs' => [],
                        'count_channels' => 0,
                        'count_videos' => 0,
                        'total_views' => 0,
                        'cache_rows' => 0,
                    ];
                }

                foreach ($row['pairs'] as $keyword => $value) {
                    $byDate[$date]['pairs'][$keyword] = (float) ($byDate[$date]['pairs'][$keyword] ?? 0) + $value;
                }

                $byDate[$date]['count_channels'] += $row['count_channels'];
                $byDate[$date]['count_videos'] += $row['count_videos'];
                $byDate[$date]['total_views'] += $row['total_views'];
                $byDate[$date]['cache_rows'] += $row['cache_rows'];
            }
        }

        return $byDate;
    }

    /**
     * @param list<int> $tagIds
     * @param list<int> $orTagIds
     * @param list<int> $notTagIds
     * @param array{cache_from: string, to: string} $range
     * @param list<string> $keywords
     * @return array<string, array{pairs: array<string, float>, count_channels: int, count_videos: int, total_views: int, cache_rows: int}>
     */
    private function derivedFilterRowsByDate(array $tagIds, array $orTagIds, array $notTagIds, array $range, string $type, array $keywords): array
    {
        $byDate = [];

        foreach ($this->datesForCacheRange($range) as $date) {
            $row = $this->derivedBuildRow($tagIds, $orTagIds, $notTagIds, $date, $type, $keywords);

            if ($row !== null) {
                $byDate[$date] = $row;
            }
        }

        return $byDate;
    }

    /**
     * @param list<int> $tagIds
     * @param list<int> $orTagIds
     * @param list<int> $notTagIds
     * @param list<string> $keywords
     * @return array{pairs: array<string, float>, count_channels: int, count_videos: int, total_views: int, cache_rows: int}|null
     */
    private function derivedBuildRow(array $tagIds, array $orTagIds, array $notTagIds, string $date, string $type, array $keywords): ?array
    {
        $result = $this->tagDateCacheBuilder->build(
            tagIds: $tagIds,
            date: $date,
            orTagIds: $orTagIds,
            notTagIds: $notTagIds,
            onlyKeywords: $keywords,
            execute: false,
        );
        $pairs = collect($result[$type] ?? [])
            ->filter(fn (mixed $value, mixed $keyword): bool => is_string($keyword) && is_numeric($value))
            ->map(fn (mixed $value): float => (float) $value)
            ->all();

        if ($pairs === [] && (int) ($result['videos_scanned'] ?? 0) <= 0) {
            return null;
        }

        return [
            'pairs' => $pairs,
            'count_channels' => (int) ($result['channels_matched'] ?? 0),
            'count_videos' => (int) ($result['count_videos'] ?? 0),
            'total_views' => (int) ($result['total_views'] ?? 0),
            'cache_rows' => 1,
        ];
    }

    /**
     * @param array{cache_from: string, to: string} $range
     * @return list<string>
     */
    private function datesForCacheRange(array $range): array
    {
        $dates = [];
        $cursor = CarbonImmutable::parse($range['cache_from'], 'Asia/Taipei');
        $end = CarbonImmutable::parse($range['to'], 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 98) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return $dates;
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

        $pairs = [];

        foreach ($decoded as $key => $value) {
            if (! is_numeric($value)) {
                continue;
            }

            $keyword = (string) $key;
            $pairs[$keyword] = (float) $value;
            $decodedKeyword = urldecode($keyword);

            if ($decodedKeyword !== $keyword) {
                $pairs[$decodedKeyword] = (float) $value;
            }
        }

        return $pairs;
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
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array{from: string, to: string, days: int, today: int} $range
     * @param list<string> $keywords
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters, string $type, array $range, array $keywords): array
    {
        return array_filter([
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
            'type' => $type,
            'tags' => implode(',', $keywords),
            'from' => $range['from'],
            'to' => $range['to'],
            'days' => $range['days'],
            'today' => $range['today'],
        ], fn (mixed $value): bool => $value !== '');
    }
}
