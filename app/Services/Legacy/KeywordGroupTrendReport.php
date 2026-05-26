<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class KeywordGroupTrendReport
{
    public function __construct(private readonly LegacyKeywordGroupDefinitions $groups)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forRequest(Request $request): array
    {
        $keyword = trim((string) ($request->route('keyword') ?? $request->query('tag', '柯文哲'))) ?: '柯文哲';
        $groupKey = $this->groupKey($request);
        $group = $this->groups->get($groupKey, $request->has('all'));
        $type = $this->type($request);
        $range = $this->range($request);

        try {
            $data = $this->series($group, $keyword, $type['key'], $range);

            return $this->payload(
                available: true,
                keyword: $keyword,
                group: $group,
                type: $type,
                range: $range,
                series: $data['series'],
                cacheRows: $data['cache_rows'],
            );
        } catch (QueryException) {
            return $this->payload(
                available: false,
                keyword: $keyword,
                group: $group,
                type: $type,
                range: $range,
                series: [],
                cacheRows: 0,
            );
        }
    }

    private function groupKey(Request $request): string
    {
        $group = (string) $request->query('group', 'position');

        if ($request->filled('view')) {
            $group = (string) $request->query('view');
        }

        return $group;
    }

    /**
     * @return array{key: string, label: string}
     */
    private function type(Request $request): array
    {
        $type = (string) $request->query('type', 'total_views');
        $aliases = [
            'views' => 'total_views',
            'tags_views' => 'total_views',
            'videos' => 'count_videos',
            'tags_video' => 'count_videos',
            'average' => 'views_video',
        ];
        $key = $aliases[$type] ?? $type;

        if (! in_array($key, ['total_views', 'count_videos', 'views_video'], true)) {
            $key = 'total_views';
        }

        return [
            'key' => $key,
            'label' => [
                'total_views' => '觀看數',
                'count_videos' => '影片數',
                'views_video' => '觀注度',
            ][$key],
        ];
    }

    /**
     * @return array{from: string, to: string, cache_from: string, from_month: string, to_month: string, days: int, dates: list<string>, include_today: bool}
     */
    private function range(Request $request): array
    {
        $now = CarbonImmutable::now('Asia/Taipei');
        $days = max(1, min(366, (int) $request->query('days', 10)));
        $todayOffset = max(0, min(3650, (int) $request->query('today', 0)));
        $fallbackTo = $now->subDays($todayOffset)->toDateString();

        if ($request->filled('from') || $request->filled('to')) {
            $to = $this->dateString($request->query('to'), $fallbackTo);
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days - 1)->toDateString());
        } else {
            $to = $request->has('today') ? $fallbackTo : $now->subDay()->toDateString();
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days - 1)->toDateString();
        }

        if ((string) $request->query('from') === 'year') {
            $from = $now->format('Y-01-01');
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $dates = [];
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 366) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        $cacheFrom = CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(6);

        return [
            'from' => $from,
            'to' => $to,
            'cache_from' => $cacheFrom->toDateString(),
            'from_month' => $cacheFrom->format('Y-m-01'),
            'to_month' => CarbonImmutable::parse($to, 'Asia/Taipei')->format('Y-m-01'),
            'days' => $days,
            'dates' => $dates,
            'include_today' => $request->has('today'),
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    /**
     * @param array{name: string, label: string, groups: list<array{name: string, tag_para: string, filters: array{tagid_string: string, or_string: string, not_string: string}>} $group
     * @param array{from: string, to: string, cache_from: string, from_month: string, to_month: string, dates: list<string>} $range
     * @return array{series: list<array{date: string, values: array<string, int>, cache_entries: int}>, cache_rows: int}
     */
    private function series(array $group, string $keyword, string $type, array $range): array
    {
        if (! Schema::hasTable('urt_show_tag_month') && Schema::hasTable('urt_show_tag_date')) {
            return $this->dailyCacheSeries($group, $keyword, $type, $range);
        }

        if (! Schema::hasTable('urt_show_tag_month')) {
            DB::table('urt_show_tag_month')->limit(1)->get();
        }

        $monthly = $this->monthlyCacheSeries($group, $keyword, $type, $range);

        if (($monthly['cache_rows'] > 0 && $this->hasSeriesData($monthly['series'])) || ! Schema::hasTable('urt_show_tag_date')) {
            return $monthly;
        }

        $daily = $this->dailyCacheSeries($group, $keyword, $type, $range);

        return $this->hasSeriesData($daily['series']) ? $daily : $monthly;
    }

    /**
     * @param array{name: string, label: string, groups: list<array{name: string, tag_para: string, filters: array{tagid_string: string, or_string: string, not_string: string}>} $group
     * @param array{from: string, to: string, cache_from: string, from_month: string, to_month: string, dates: list<string>} $range
     * @return array{series: list<array{date: string, values: array<string, int>, cache_entries: int}>, cache_rows: int}
     */
    private function monthlyCacheSeries(array $group, string $keyword, string $type, array $range): array
    {
        $byGroup = [];
        $cacheRows = 0;

        foreach ($group['groups'] as $item) {
            $query = DB::table('urt_show_tag_month')
                ->where('tag', $keyword)
                ->whereBetween('the_month', [$range['from_month'], $range['to_month']])
                ->orderBy('the_month')
                ->orderByDesc('pk');

            $this->applyCacheFilters($query, $item['filters']);

            $rows = $query->get();
            $daily = [];
            $seenMonths = [];

            foreach ($rows as $row) {
                $month = (string) ($row->the_month ?? '');

                if ($month !== '' && isset($seenMonths[$month])) {
                    continue;
                }

                if ($month !== '') {
                    $seenMonths[$month] = true;
                }

                $cacheRows++;
                $daily = array_replace($daily, $this->decodeMap($row->tags_result ?? null));
            }

            $byGroup[$item['name']] = $daily;
        }

        $series = [];

        foreach ($range['dates'] as $date) {
            $values = [];
            $cacheEntries = 0;

            foreach ($group['groups'] as $item) {
                $rollingViews = 0;
                $rollingVideos = 0;

                for ($i = 0; $i <= 6; $i++) {
                    $priorDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($i)->toDateString();
                    $entry = $byGroup[$item['name']][$priorDate] ?? null;

                    if (! is_array($entry)) {
                        continue;
                    }

                    $cacheEntries++;
                    $rollingViews += (int) ($entry['tags_views'] ?? 0);
                    $rollingVideos += (int) ($entry['tags_video'] ?? $entry['count_videos'] ?? 0);
                }

                $values[$item['name']] = match ($type) {
                    'count_videos' => $rollingVideos,
                    'views_video' => $rollingVideos > 0 ? (int) floor($rollingViews / $rollingVideos) : 0,
                    default => $rollingViews,
                };
            }

            $series[] = [
                'date' => $date,
                'values' => $values,
                'cache_entries' => $cacheEntries,
            ];
        }

        return [
            'series' => $series,
            'cache_rows' => $cacheRows,
        ];
    }

    /**
     * @param array{name: string, label: string, groups: list<array{name: string, tag_para: string, filters: array{tagid_string: string, or_string: string, not_string: string}>} $group
     * @param array{from: string, to: string, cache_from: string, dates: list<string>} $range
     * @return array{series: list<array{date: string, values: array<string, int>, cache_entries: int}>, cache_rows: int}
     */
    private function dailyCacheSeries(array $group, string $keyword, string $type, array $range): array
    {
        $byGroup = [];
        $cacheRows = 0;

        foreach ($group['groups'] as $item) {
            $query = DB::table('urt_show_tag_date')
                ->whereBetween('the_date', [$range['cache_from'], $range['to']])
                ->orderBy('the_date')
                ->orderByDesc('pk');

            $this->applyCacheFilters($query, $item['filters']);

            $daily = [];
            $seenDates = [];

            foreach ($query->get() as $row) {
                $date = substr((string) ($row->the_date ?? ''), 0, 10);

                if ($date === '' || isset($seenDates[$date])) {
                    continue;
                }

                $seenDates[$date] = true;
                $cacheRows++;
                $views = $this->decodeKeywordValue($row->tags_views ?? null, $keyword);
                $videos = $this->decodeKeywordValue($row->tags_video ?? null, $keyword);
                $result = $this->decodeKeywordValue($row->tags_result ?? null, $keyword);

                $daily[$date] = [
                    'tags_views' => $views,
                    'tags_video' => $videos,
                    'count_videos' => $videos,
                    'tags_result' => $result,
                ];
            }

            $byGroup[$item['name']] = $daily;
        }

        return [
            'series' => $this->rollingSeries($group, $range['dates'], $byGroup, $type),
            'cache_rows' => $cacheRows,
        ];
    }

    /**
     * @param array{name: string, groups: list<array{name: string}>} $group
     * @param list<string> $dates
     * @param array<string, array<string, array<string, float|int>>> $byGroup
     * @return list<array{date: string, values: array<string, int>, cache_entries: int}>
     */
    private function rollingSeries(array $group, array $dates, array $byGroup, string $type): array
    {
        $series = [];

        foreach ($dates as $date) {
            $values = [];
            $cacheEntries = 0;

            foreach ($group['groups'] as $item) {
                $rollingViews = 0;
                $rollingVideos = 0;

                for ($i = 0; $i <= 6; $i++) {
                    $priorDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($i)->toDateString();
                    $entry = $byGroup[$item['name']][$priorDate] ?? null;

                    if (! is_array($entry)) {
                        continue;
                    }

                    $cacheEntries++;
                    $rollingViews += (int) ($entry['tags_views'] ?? $entry['total_views'] ?? $entry['tags_result'] ?? 0);
                    $rollingVideos += (int) ($entry['tags_video'] ?? $entry['count_videos'] ?? 0);
                }

                $values[$item['name']] = match ($type) {
                    'count_videos' => $rollingVideos,
                    'views_video' => $rollingVideos > 0 ? (int) floor($rollingViews / $rollingVideos) : 0,
                    default => $rollingViews,
                };
            }

            $series[] = [
                'date' => $date,
                'values' => $values,
                'cache_entries' => $cacheEntries,
            ];
        }

        return $series;
    }

    /**
     * @param list<array{values: array<string, int>}> $series
     */
    private function hasSeriesData(array $series): bool
    {
        return collect($series)->contains(fn (array $row): bool => collect($row['values'])->contains(fn (int $value): bool => $value > 0));
    }

    /**
     * @param Builder $query
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     */
    private function applyCacheFilters(Builder $query, array $filters): void
    {
        $this->whereNullableEmptyString($query, 'tagid', $filters['tagid_string']);
        $this->whereNullableEmptyString($query, 'tag_or', $filters['or_string']);
        $this->whereNullableEmptyString($query, 'tag_not', $filters['not_string']);
    }

    private function whereNullableEmptyString(Builder $query, string $column, string $value): void
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
     * @return array<string, mixed>
     */
    private function payload(bool $available, string $keyword, array $group, array $type, array $range, array $series, int $cacheRows): array
    {
        return [
            'available' => $available,
            'data_available' => collect($series)->contains(fn (array $row): bool => collect($row['values'])->contains(fn (int $value): bool => $value > 0)),
            'title' => $keyword.' 依 '.$group['label'].' 在 '.$range['days'].' 天的逐日線圖',
            'keyword' => $keyword,
            'group' => $group,
            'type' => $type['key'],
            'type_name' => $type['label'],
            'range' => $range,
            'series' => $series,
            'cache_rows' => $cacheRows,
            'options' => $this->groups->options(),
            'generated_at' => CarbonImmutable::now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
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

        foreach (['tags_result', 'period', 'daily', 'result', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return collect($decoded)
            ->mapWithKeys(function (mixed $value, mixed $key): array {
                if (is_array($value)) {
                    $date = (string) ($value['date'] ?? $value['the_date'] ?? $key);

                    if ($date === '') {
                        return [];
                    }

                    unset($value['date'], $value['the_date']);

                    return [$date => $value];
                }

                return is_string($key) ? [$key => $value] : [];
            })
            ->all();
    }

    private function decodeKeywordValue(mixed $json, string $keyword): float
    {
        if (! is_string($json) || trim($json) === '' || trim($json) === 'null') {
            return 0.0;
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return 0.0;
        }

        foreach (['tags_result', 'tags_views', 'tags_video', 'result', 'data', 'keywords'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        if (isset($decoded[$keyword]) && is_numeric($decoded[$keyword])) {
            return (float) $decoded[$keyword];
        }

        foreach ($decoded as $item) {
            if (! is_array($item)) {
                continue;
            }

            $tag = $item['tag'] ?? $item['keyword'] ?? $item['name'] ?? null;

            if ((string) $tag !== $keyword) {
                continue;
            }

            foreach (['value', 'count', 'score', 'views', 'videos', 'tags_views', 'tags_video', 'tags_result'] as $valueKey) {
                if (isset($item[$valueKey]) && is_numeric($item[$valueKey])) {
                    return (float) $item[$valueKey];
                }
            }
        }

        return 0.0;
    }
}
