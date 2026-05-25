<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LiveDailyTrendReport
{
    private const GROUPS = [
        'party' => [
            'name' => '立場陣營',
            'tag_ids' => [3, 6, 4, 5, 48, 49],
        ],
        'news' => [
            'name' => '新聞媒體',
            'tag_ids' => [53, 29, 64, 63, 50, 65, 75, 19, 69, 73, 77, 80, 85, 76],
        ],
        'main' => [
            'name' => '主流新聞',
            'tag_ids' => [53, 29, 64, 63, 50, 65, 75],
        ],
        'media' => [
            'name' => '媒體類型',
            'tag_ids' => [89, 12, 9, 81],
        ],
        'china' => [
            'name' => '中國政論',
            'tag_ids' => [10, 11, 15, 22, 55],
        ],
    ];

    private const TYPES = [
        'total_views' => '觀看數',
        'count_videos' => '影片數',
    ];

    /**
     * @return array{available: bool, title: string, rows: array<int, array<string, mixed>>, series: array<int, array<string, mixed>>, dates: array<int, string>, groups: array<string, string>, types: array<string, string>, period: array<string, mixed>, filters: array<string, mixed>, generated_at: string}
     */
    public function forRequest(Request $request): array
    {
        $groupKey = $this->groupKey($request);
        $type = $this->type($request);
        $period = $this->period($request);
        $group = self::GROUPS[$groupKey];

        try {
            $tagNames = $this->tagNames();
            $daily = $this->dailyAggregates($period);
            $dates = $this->datesForChart($period);
            $series = $this->series($group['tag_ids'], $dates, $daily, $tagNames, $type);
            $rows = $this->summaryRows($group['tag_ids'], $period['range_dates'], $daily, $tagNames);
            $title = $period['explicit_from']
                ? $group['name'].' 從 '.$period['from'].' 到 '.$period['to'].' 的每日直播線上人數'
                : $group['name'].' 在 '.$period['days'].'天 的每日直播線上人數';

            return [
                'available' => true,
                'title' => $title,
                'rows' => $rows,
                'series' => $series,
                'dates' => $dates,
                'groups' => collect(self::GROUPS)->map(fn (array $row): string => $row['name'])->all(),
                'types' => self::TYPES,
                'period' => $period + ['group' => $groupKey, 'type' => $type, 'group_name' => $group['name'], 'type_name' => self::TYPES[$type]],
                'filters' => $this->displayFilters($request, $groupKey, $type, $period),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => self::GROUPS[$groupKey]['name'].' 每日直播線上人數',
                'rows' => [],
                'series' => [],
                'dates' => [],
                'groups' => collect(self::GROUPS)->map(fn (array $row): string => $row['name'])->all(),
                'types' => self::TYPES,
                'period' => $period + ['group' => $groupKey, 'type' => $type, 'group_name' => $group['name'], 'type_name' => self::TYPES[$type]],
                'filters' => $request->query(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    private function groupKey(Request $request): string
    {
        $group = (string) $request->query('group', 'party');

        return array_key_exists($group, self::GROUPS) ? $group : 'party';
    }

    private function type(Request $request): string
    {
        $type = (string) $request->query('type', 'total_views');

        return array_key_exists($type, self::TYPES) ? $type : 'total_views';
    }

    /**
     * @return array{from: string, to: string, aggregate_from: string, days: int, explicit_from: bool, include_today: bool, range_dates: array<int, string>}
     */
    private function period(Request $request): array
    {
        $latestDate = $this->latestLogDate();
        $today = now('Asia/Taipei')->toDateString();
        $defaultTo = $latestDate && $latestDate <= $today ? $latestDate : $today;
        $days = max(1, min(366, (int) $request->query('days', 7)));
        $explicitFrom = $request->filled('from');

        if ($explicitFrom) {
            $from = (string) $request->query('from');

            if ($from === 'year') {
                $from = substr($defaultTo, 0, 4).'-01-01';
            }

            $from = $this->boundedDate($from, $defaultTo);
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
            'aggregate_from' => Carbon::parse($from, 'Asia/Taipei')->subDays(6)->toDateString(),
            'days' => max(1, Carbon::parse($from, 'Asia/Taipei')->diffInDays(Carbon::parse($to, 'Asia/Taipei'))),
            'explicit_from' => $explicitFrom,
            'include_today' => (int) $request->query('today', 0) > 0,
            'range_dates' => $rangeDates,
        ];
    }

    private function latestLogDate(): ?string
    {
        try {
            $date = DB::table('urt_video_live_log')->max('the_date');
        } catch (QueryException) {
            return null;
        }

        return is_string($date) ? substr($date, 0, 10) : null;
    }

    private function boundedDate(string $date, string $today): string
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $today;
        }

        if ($date < '2022-11-19') {
            return '2022-11-19';
        }

        if ($date > $today) {
            return $today;
        }

        return $date;
    }

    /**
     * @return array<int, string>
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
     * @param array{from: string, to: string, aggregate_from: string, days: int, explicit_from: bool, include_today: bool, range_dates: array<int, string>} $period
     * @return array<string, array<int, array{max: int, count: int}>>
     */
    private function dailyAggregates(array $period): array
    {
        $rows = DB::table('urt_video_live_log as l')
            ->join('urt_count as c', 'l.u_id', '=', 'c.u_id')
            ->select(['l.the_date', 'l.max_current', 'c.tags'])
            ->whereBetween('l.the_date', [$period['aggregate_from'], $period['to']])
            ->where('l.max_current', '>', 0)
            ->get();

        $daily = [];

        foreach ($rows as $row) {
            $date = substr((string) $row->the_date, 0, 10);
            $maxCurrent = (int) ($row->max_current ?? 0);

            foreach ($this->tagIds((string) ($row->tags ?? '')) as $tagId) {
                $daily[$date][$tagId]['max'] = ($daily[$date][$tagId]['max'] ?? 0) + $maxCurrent;
                $daily[$date][$tagId]['count'] = ($daily[$date][$tagId]['count'] ?? 0) + 1;
            }
        }

        return $daily;
    }

    /**
     * @return array<int, string>
     */
    private function datesForChart(array $period): array
    {
        if ($period['include_today']) {
            return $period['range_dates'];
        }

        return array_values(array_filter(
            $period['range_dates'],
            fn (string $date): bool => $date < $period['to'],
        )) ?: $period['range_dates'];
    }

    /**
     * @param array<int, int> $tagIds
     * @param array<int, string> $dates
     * @param array<string, array<int, array{max: int, count: int}>> $daily
     * @param array<int, string> $tagNames
     * @return array<int, array{name: string, tag_id: int, values: array<int, int>}>
     */
    private function series(array $tagIds, array $dates, array $daily, array $tagNames, string $type): array
    {
        return collect($tagIds)
            ->map(function (int $tagId) use ($dates, $daily, $tagNames, $type): array {
                return [
                    'tag_id' => $tagId,
                    'name' => $tagNames[$tagId] ?? (string) $tagId,
                    'values' => collect($dates)
                        ->map(fn (string $date): int => (int) round($this->rollingValue($tagId, $date, $daily, $type) / 7))
                        ->all(),
                ];
            })
            ->all();
    }

    /**
     * @param array<string, array<int, array{max: int, count: int}>> $daily
     */
    private function rollingValue(int $tagId, string $date, array $daily, string $type): int
    {
        $value = 0;
        $current = Carbon::parse($date, 'Asia/Taipei');

        for ($offset = 0; $offset <= 6; $offset++) {
            $key = $current->copy()->subDays($offset)->toDateString();
            $value += (int) ($daily[$key][$tagId][$type === 'count_videos' ? 'count' : 'max'] ?? 0);
        }

        return $value;
    }

    /**
     * @param array<int, int> $tagIds
     * @param array<int, string> $dates
     * @param array<string, array<int, array{max: int, count: int}>> $daily
     * @param array<int, string> $tagNames
     * @return array<int, array{name: string, tag_id: int, count: int, total_views: int, views_per_video: float|null}>
     */
    private function summaryRows(array $tagIds, array $dates, array $daily, array $tagNames): array
    {
        return collect($tagIds)
            ->map(function (int $tagId) use ($dates, $daily, $tagNames): array {
                $count = 0;
                $totalViews = 0;

                foreach ($dates as $date) {
                    $count += (int) ($daily[$date][$tagId]['count'] ?? 0);
                    $totalViews += (int) ($daily[$date][$tagId]['max'] ?? 0);
                }

                return [
                    'tag_id' => $tagId,
                    'name' => $tagNames[$tagId] ?? (string) $tagId,
                    'count' => $count,
                    'total_views' => $totalViews,
                    'views_per_video' => $count > 0 ? $totalViews / $count : null,
                ];
            })
            ->all();
    }

    /**
     * @return array<int, string>
     */
    private function tagNames(): array
    {
        return DB::table('urt_tag')
            ->orderBy('tag_id')
            ->pluck('tag_name', 'tag_id')
            ->mapWithKeys(fn ($name, $id) => [(int) $id => (string) $name])
            ->all();
    }

    /**
     * @return array<int>
     */
    private function tagIds(string $tagString): array
    {
        preg_match_all('/\[(\d+)\]/', $tagString, $matches);

        return collect($matches[1] ?? [])
            ->map(fn (string $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function displayFilters(Request $request, string $groupKey, string $type, array $period): array
    {
        return array_merge($request->query(), [
            'group' => $groupKey,
            'type' => $type,
            'from' => $period['from'],
            'to' => $period['to'],
        ]);
    }
}
