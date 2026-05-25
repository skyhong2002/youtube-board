<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GroupMetricReport
{
    public function __construct(private readonly LegacyLiveGroupDefinitions $groups)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function ranking(Request $request): array
    {
        $group = $this->group($request);
        $range = $this->range($request, rolling: false);

        try {
            $rows = collect($group['groups'])
                ->map(function (array $item) use ($range): array {
                    $records = $this->records($item['filters'], $range['from'], $range['to']);
                    $displayRecords = collect($range['dates'])
                        ->mapWithKeys(fn (string $date): array => [$date => $records[$date] ?? null]);
                    $views = $displayRecords->map(fn (?object $record): int => (int) ($record->total_views ?? 0))->values()->all();
                    $videos = $displayRecords->map(fn (?object $record): int => (int) ($record->count_videos ?? 0))->values()->all();

                    return [
                        'name' => $item['name'],
                        'tag_para' => $item['tag_para'],
                        'filters' => $item['filters'],
                        'cache_rows' => $displayRecords->filter()->count(),
                        'views_sum' => array_sum($views),
                        'views_median' => $this->median($views),
                        'videos_sum' => array_sum($videos),
                        'videos_median' => $this->median($videos),
                    ];
                })
                ->values()
                ->all();

            return [
                'available' => true,
                'data_available' => collect($rows)->contains(fn (array $row): bool => $row['views_sum'] > 0 || $row['videos_sum'] > 0),
                'title' => $group['label'].' 在 '.$range['display_days'].'天 的排行',
                'group' => $group,
                'range' => $range,
                'rows' => $rows,
                'cache_rows' => collect($rows)->sum('cache_rows'),
                'options' => $this->groups->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->unavailable($group, $range, ranking: true);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function trend(Request $request): array
    {
        $group = $this->group($request);
        $range = $this->range($request, rolling: true);
        $type = $this->type($request);

        try {
            $recordsByGroup = [];

            foreach ($group['groups'] as $item) {
                $recordsByGroup[$item['name']] = $this->records($item['filters'], $range['cache_from'], $range['to']);
            }

            $series = collect($range['dates'])
                ->map(function (string $date) use ($group, $recordsByGroup, $type): array {
                    $values = [];
                    $cacheRows = 0;

                    foreach ($group['groups'] as $item) {
                        $sum = 0;

                        for ($i = 0; $i <= 6; $i++) {
                            $priorDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($i)->toDateString();
                            $record = $recordsByGroup[$item['name']][$priorDate] ?? null;

                            if (! $record) {
                                continue;
                            }

                            $cacheRows++;
                            $sum += (int) ($record->{$type} ?? 0);
                        }

                        $values[$item['name']] = $sum;
                    }

                    return [
                        'date' => $date,
                        'values' => $values,
                        'cache_rows' => $cacheRows,
                    ];
                })
                ->values()
                ->all();

            return [
                'available' => true,
                'data_available' => collect($series)->contains(fn (array $row): bool => collect($row['values'])->contains(fn (int $value): bool => $value > 0)),
                'title' => $group['label'].' 在 '.$range['display_days'].'天 的逐日線圖',
                'group' => $group,
                'range' => $range,
                'type' => $type,
                'type_name' => $this->types()[$type],
                'types' => $this->types(),
                'series' => $series,
                'cache_rows' => collect($series)->sum('cache_rows'),
                'options' => $this->groups->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->unavailable($group, $range, ranking: false, type: $type);
        }
    }

    /**
     * @return array{name: string, label: string, groups: list<array<string, mixed>>}
     */
    private function group(Request $request): array
    {
        return $this->groups->get((string) ($request->route('groupName') ?? $request->query('group', 'media')));
    }

    /**
     * @return array{from: string, to: string, dates: list<string>, cache_from: string, display_days: int, days: int|string, today: int}
     */
    private function range(Request $request, bool $rolling): array
    {
        $now = CarbonImmutable::now('Asia/Taipei');
        $daysOption = $request->query('days', 7);
        $todayOffset = max(0, min(3650, (int) $request->query('today', 0)));

        if ($daysOption === 'year' || $request->query('from') === 'year') {
            $to = $this->dateString($request->query('to'), $now->subDays($todayOffset)->toDateString());
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->startOfYear()->toDateString();
            $days = 'year';
        } elseif ($request->filled('from') || $request->filled('to')) {
            $fallbackTo = $now->subDays($todayOffset)->toDateString();
            $requestedDays = max(1, min(366, (int) $daysOption));
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($fallbackTo, 'Asia/Taipei')->subDays($requestedDays)->toDateString());
            $to = $this->dateString($request->query('to'), $fallbackTo);
            $days = max(1, CarbonImmutable::parse($from, 'Asia/Taipei')->diffInDays(CarbonImmutable::parse($to, 'Asia/Taipei')));
        } else {
            $requestedDays = max(1, min(366, (int) $daysOption));
            $to = $now->subDays($todayOffset)->toDateString();
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($requestedDays)->toDateString();
            $days = $requestedDays;
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $dates = [];
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei')->addDay();
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 366) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        if ($dates === []) {
            $dates[] = $to;
        }

        return [
            'from' => $from,
            'to' => $to,
            'dates' => $dates,
            'cache_from' => $rolling ? CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(6)->toDateString() : $from,
            'display_days' => max(1, count($dates)),
            'days' => $days,
            'today' => $todayOffset,
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    private function type(Request $request): string
    {
        $type = (string) $request->query('type', 'total_views');
        $aliases = [
            'tags_views' => 'total_views',
            'tags_video' => 'count_videos',
            'views' => 'total_views',
            'videos' => 'count_videos',
        ];
        $type = $aliases[$type] ?? $type;

        return array_key_exists($type, $this->types()) ? $type : 'total_views';
    }

    /**
     * @return array<string, string>
     */
    private function types(): array
    {
        return [
            'total_views' => '觀看數',
            'count_videos' => '影片數',
        ];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, object>
     */
    private function records(array $filters, string $from, string $to): array
    {
        $query = DB::table('urt_show_tag_date')
            ->whereBetween('the_date', [$from, $to]);

        $this->whereLegacyFilter($query, 'tagid', (string) ($filters['tagid_string'] ?? ''));
        $this->whereLegacyFilter($query, 'tag_or', (string) ($filters['or_string'] ?? ''));
        $this->whereLegacyFilter($query, 'tag_not', (string) ($filters['not_string'] ?? ''));

        $records = $query->orderByDesc('pk')->get();
        $byDate = [];

        foreach ($records as $record) {
            $date = substr((string) ($record->the_date ?? ''), 0, 10);

            if ($date !== '' && ! isset($byDate[$date])) {
                $byDate[$date] = $record;
            }
        }

        return $byDate;
    }

    private function whereLegacyFilter(Builder $query, string $column, string $value): void
    {
        if ($value === '') {
            $query->where(function (Builder $query) use ($column): void {
                $query->whereNull($column)->orWhere($column, '');
            });

            return;
        }

        $query->where($column, $value);
    }

    /**
     * @param list<int> $values
     */
    private function median(array $values): float
    {
        $values = collect($values)
            ->map(fn (mixed $value): int => (int) $value)
            ->sort()
            ->values()
            ->all();
        $count = count($values);

        if ($count === 0) {
            return 0.0;
        }

        $middle = intdiv($count, 2);

        if ($count % 2 === 1) {
            return (float) $values[$middle];
        }

        return ($values[$middle - 1] + $values[$middle]) / 2;
    }

    /**
     * @return array<string, mixed>
     */
    private function unavailable(array $group, array $range, bool $ranking, ?string $type = null): array
    {
        $base = [
            'available' => false,
            'data_available' => false,
            'title' => $ranking
                ? $group['label'].' 在 '.$range['display_days'].'天 的排行'
                : $group['label'].' 在 '.$range['display_days'].'天 的逐日線圖',
            'group' => $group,
            'range' => $range,
            'cache_rows' => 0,
            'options' => $this->groups->options(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];

        if ($ranking) {
            return $base + ['rows' => []];
        }

        $type ??= 'total_views';

        return $base + [
            'type' => $type,
            'type_name' => $this->types()[$type] ?? $this->types()['total_views'],
            'types' => $this->types(),
            'series' => [],
        ];
    }
}
