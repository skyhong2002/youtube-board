<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LiveTagReport
{
    private const TYPES = [
        'tags_result' => '重要度',
        'tags_video' => '影片數',
        'tags_views' => '觀看數',
    ];

    public function __construct(
        private readonly LegacyTagFilter $tagFilter,
        private readonly LegacyStopwords $stopwords,
    )
    {
    }

    /**
     * @return array{available: bool, title: string, rows: list<array<string, mixed>>, dates: list<string>, totals: list<array<string, mixed>>, period: array<string, mixed>, filters: array<string, mixed>, types: array<string, string>, generated_at: string}
     */
    public function forRequest(Request $request): array
    {
        $filters = $this->filters($request);
        $type = $this->type($request);

        try {
            $period = $this->period($request, $filters);
            $tagNames = $this->tagFilter->tagNames();
            $rows = DB::table('urt_show_live_tag_date')
                ->where('tagid', $filters['tagid_string'])
                ->where('tag_or', $filters['or_string'])
                ->where('tag_not', $filters['not_string'])
                ->whereBetween('the_date', [$period['from'], $period['to']])
                ->orderBy('the_date')
                ->get();

            $dates = $period['range_dates'];

            return [
                'available' => true,
                'title' => $this->title($filters, $tagNames, $period),
                'rows' => $this->keywordRows($rows, $dates, $type, $filters['limit']),
                'dates' => $dates,
                'totals' => $this->totals($rows, $dates),
                'period' => $period + ['type' => $type, 'type_name' => self::TYPES[$type]],
                'filters' => $this->displayFilters($filters),
                'types' => self::TYPES,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => '直播標籤熱度',
                'rows' => [],
                'dates' => [],
                'totals' => [],
                'period' => ['from' => null, 'to' => null, 'days' => null, 'type' => $type, 'type_name' => self::TYPES[$type]],
                'filters' => $this->displayFilters($filters),
                'types' => self::TYPES,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    /**
     * @return array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string, limit: int}
     */
    private function filters(Request $request): array
    {
        $tagid = $this->sortedIntegers($request->query('tagid'));
        $or = $this->sortedIntegers($request->query('or'));
        $not = $this->sortedIntegers($request->query('not'));

        return [
            'tagid' => $tagid,
            'or' => $or,
            'not' => $not,
            'tagid_string' => implode(',', $tagid),
            'or_string' => implode(',', $or),
            'not_string' => implode(',', $not),
            'limit' => max(1, min(200, (int) $request->query('limit', 100))),
        ];
    }

    /**
     * @return list<int>
     */
    private function sortedIntegers(mixed $value): array
    {
        $items = $this->tagFilter->integerList($value);
        sort($items);

        return $items;
    }

    private function type(Request $request): string
    {
        $type = (string) $request->query('type', 'tags_result');

        return array_key_exists($type, self::TYPES) ? $type : 'tags_result';
    }

    /**
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     * @return array{from: string, to: string, days: int, explicit_from: bool, range_dates: list<string>}
     */
    private function period(Request $request, array $filters): array
    {
        $latestDate = $this->latestCacheDate($filters) ?? now('Asia/Taipei')->toDateString();
        $todayOffset = max(0, min(365, (int) $request->query('today', 0)));
        $defaultTo = Carbon::parse($latestDate, 'Asia/Taipei')->subDays($todayOffset)->toDateString();
        $days = max(1, min(90, (int) $request->query('days', 7)));
        $explicitFrom = $request->filled('from');

        if ($explicitFrom) {
            $from = $this->boundedDate((string) $request->query('from'), $defaultTo);
            $to = $this->boundedDate((string) $request->query('to', $defaultTo), $defaultTo);
        } else {
            $to = $this->boundedDate((string) $request->query('to', $defaultTo), $defaultTo);
            $from = Carbon::parse($to, 'Asia/Taipei')->subDays($days)->toDateString();
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $rangeDates = $this->dateRange($from, $to);

        return [
            'from' => $from,
            'to' => $to,
            'days' => max(1, Carbon::parse($from, 'Asia/Taipei')->diffInDays(Carbon::parse($to, 'Asia/Taipei'))),
            'explicit_from' => $explicitFrom,
            'range_dates' => $rangeDates,
        ];
    }

    /**
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     */
    private function latestCacheDate(array $filters): ?string
    {
        $date = DB::table('urt_show_live_tag_date')
            ->where('tagid', $filters['tagid_string'])
            ->where('tag_or', $filters['or_string'])
            ->where('tag_not', $filters['not_string'])
            ->max('the_date');

        if ($date === null) {
            $date = DB::table('urt_show_live_tag_date')->max('the_date');
        }

        return is_string($date) ? substr($date, 0, 10) : null;
    }

    private function boundedDate(string $date, string $fallback): string
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $fallback;
        }

        if ($date < '2010-01-01') {
            return '2010-01-01';
        }

        if ($date > $fallback) {
            return $fallback;
        }

        return $date;
    }

    /**
     * @return list<string>
     */
    private function dateRange(string $from, string $to): array
    {
        $dates = [];
        $current = Carbon::parse($from, 'Asia/Taipei');
        $end = Carbon::parse($to, 'Asia/Taipei');

        while ($current <= $end) {
            $dates[] = $current->toDateString();
            $current->addDay();
        }

        return $dates;
    }

    /**
     * @param \Illuminate\Support\Collection<int, object> $cacheRows
     * @param list<string> $dates
     * @return list<array{keyword: string, score: float, total: int, values: array<string, int>}>
     */
    private function keywordRows($cacheRows, array $dates, string $type, int $limit): array
    {
        $dataColumn = $type === 'tags_video' ? 'tags_video' : 'tags_views';
        $keywords = [];
        $stopwords = $this->stopwords->lookup();

        foreach ($cacheRows as $cacheRow) {
            $date = substr((string) $cacheRow->the_date, 0, 10);
            $tagHours = $this->decodeMap($cacheRow->{$dataColumn} ?? null);

            foreach ($tagHours as $keyword => $hours) {
                $keyword = trim((string) $keyword);

                if ($keyword === '' || isset($stopwords[$keyword])) {
                    continue;
                }

                $value = $this->maxHourValue($hours);

                if ($value <= 0) {
                    continue;
                }

                if (! isset($keywords[$keyword])) {
                    $keywords[$keyword] = [
                        'keyword' => $keyword,
                        'score' => 0.0,
                        'total' => 0,
                        'values' => array_fill_keys($dates, 0),
                    ];
                }

                $keywords[$keyword]['values'][$date] = $value;
                $keywords[$keyword]['total'] += $value;
                $keywords[$keyword]['score'] += $type === 'tags_result' ? log($value) * 100 : $value;
            }
        }

        return collect($keywords)
            ->sortByDesc('score')
            ->take($limit)
            ->values()
            ->map(function (array $row): array {
                $row['score'] = round($row['score'], 1);

                return $row;
            })
            ->all();
    }

    /**
     * @param \Illuminate\Support\Collection<int, object> $cacheRows
     * @param list<string> $dates
     * @return list<array{date: string, count_videos: int, count_tags: int, total_views: int}>
     */
    private function totals($cacheRows, array $dates): array
    {
        $byDate = $cacheRows->keyBy(fn (object $row): string => substr((string) $row->the_date, 0, 10));

        return collect($dates)
            ->map(function (string $date) use ($byDate): array {
                $row = $byDate->get($date);

                return [
                    'date' => $date,
                    'count_videos' => (int) ($row->count_videos ?? 0),
                    'count_tags' => (int) ($row->count_tags ?? 0),
                    'total_views' => (int) ($row->total_views ?? 0),
                ];
            })
            ->all();
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

        if (! is_array($decoded)) {
            return [];
        }

        foreach (['tags_views', 'tags_video', 'views', 'videos', 'result', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return $decoded[$key];
            }
        }

        return $decoded;
    }

    private function maxHourValue(mixed $hours): int
    {
        if (! is_array($hours)) {
            return 0;
        }

        return collect($hours)
            ->filter(fn (mixed $value): bool => is_scalar($value))
            ->map(fn (mixed $value): int => (int) $value)
            ->max() ?? 0;
    }

    /**
     * @param array{tagid: list<int>, or: list<int>, not: list<int>} $filters
     * @param array<int, string> $tagNames
     * @param array{from: string, to: string, days: int, explicit_from: bool} $period
     */
    private function title(array $filters, array $tagNames, array $period): string
    {
        $names = collect(array_merge($filters['tagid'], $filters['or']))
            ->map(fn (int $tagId): string => $tagNames[$tagId] ?? (string) $tagId)
            ->filter()
            ->implode(' ');

        $prefix = $names !== '' ? $names : '全部頻道';

        if ($period['explicit_from']) {
            return $prefix.' 從 '.$period['from'].' 到 '.$period['to'].' 的直播熱度字';
        }

        return $prefix.' 在 '.$period['days'].' 天的直播熱度字';
    }

    /**
     * @param array{tagid_string: string, or_string: string, not_string: string, limit: int} $filters
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters): array
    {
        return array_filter([
            'tagid' => $filters['tagid_string'],
            'or' => $filters['or_string'],
            'not' => $filters['not_string'],
            'limit' => $filters['limit'],
        ], fn (mixed $value): bool => $value !== '');
    }
}
