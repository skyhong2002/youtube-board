<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TagTrendReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
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

        $type = $this->type($request->query('type'));
        $range = $this->range($request);
        $tagNames = $this->safeTagNames();
        $subject = $this->tagTitle($filters, $tagNames);
        $title = $subject.' 在 '.$range['display_days'].' 天的'.$this->typeName($type).'折線圖';

        try {
            $cache = $this->cache($filters, $range, $type);

            return [
                'available' => true,
                'data_available' => $cache['cache_rows'] > 0 && collect($cache['series'])->contains(fn (array $row): bool => $row['has_record']),
                'title' => $title,
                'subject' => $subject,
                'type' => $type,
                'type_name' => $this->typeName($type),
                'types' => $this->types(),
                'range' => $range,
                'filters' => $this->displayFilters($filters, $type, $range),
                'cache_rows' => $cache['cache_rows'],
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
                'filters' => $this->displayFilters($filters, $type, $range),
                'cache_rows' => 0,
                'series' => [],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    private function type(mixed $value): string
    {
        $type = is_string($value) && $value !== '' ? $value : 'total_views';

        if ($type === 'views_video') {
            $type = 'average';
        }

        return array_key_exists($type, $this->types()) ? $type : 'total_views';
    }

    /**
     * @return array<string, string>
     */
    private function types(): array
    {
        return [
            'count_videos' => '影片數',
            'total_views' => '觀看數',
            'average' => '每影片觀看',
        ];
    }

    private function typeName(string $type): string
    {
        return $this->types()[$type] ?? $this->types()['total_views'];
    }

    /**
     * @return array{from: string, to: string, dates: list<string>, cache_from: string, display_days: int, days: int|string, today: int}
     */
    private function range(Request $request): array
    {
        $now = CarbonImmutable::now('Asia/Taipei');
        $daysOption = $request->query('days', 7);
        $todayOffset = $request->has('today') ? max(0, min(3650, (int) $request->query('today', 0))) : 1;

        if ($daysOption === 'year' || $request->query('from') === 'year') {
            $to = $this->dateString($request->query('to'), $now->subDays($todayOffset)->toDateString());
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->startOfYear()->toDateString();
            $days = 'year';
        } elseif ($request->filled('from') || $request->filled('to')) {
            $fallbackTo = $now->subDays($todayOffset)->toDateString();
            $requestedDays = max(1, min(366, (int) $daysOption));
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($fallbackTo, 'Asia/Taipei')->subDays($requestedDays)->toDateString());
            $to = $this->dateString($request->query('to'), $fallbackTo);
            $days = $requestedDays;
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
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 367) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return [
            'from' => $from,
            'to' => $to,
            'dates' => $dates,
            'cache_from' => CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(6)->toDateString(),
            'display_days' => max(1, count($dates) - 1),
            'days' => $days,
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
     * @return array{cache_rows: int, series: list<array<string, mixed>>}
     */
    private function cache(array $filters, array $range, string $type): array
    {
        $query = DB::table('urt_show_tag_date')
            ->whereBetween('the_date', [$range['cache_from'], $range['to']]);

        $this->whereLegacyFilter($query, 'tagid', $this->normalizedList($filters['tagid']));
        $this->whereLegacyFilter($query, 'tag_or', $this->normalizedList($filters['or']));
        $this->whereLegacyFilter($query, 'tag_not', $this->normalizedList($filters['not']));

        $records = $query->orderByDesc('pk')->get();
        $byDate = [];

        foreach ($records as $record) {
            $date = substr((string) ($record->the_date ?? ''), 0, 10);

            if ($date !== '' && ! isset($byDate[$date])) {
                $byDate[$date] = $record;
            }
        }

        $series = [];

        foreach ($range['dates'] as $date) {
            $record = $byDate[$date] ?? null;
            $weekViews = 0;
            $weekVideos = 0;

            for ($i = 0; $i <= 6; $i++) {
                $priorDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($i)->toDateString();
                $prior = $byDate[$priorDate] ?? null;
                $weekViews += $prior ? (int) ($prior->total_views ?? 0) : 0;
                $weekVideos += $prior ? (int) ($prior->count_videos ?? 0) : 0;
            }

            $series[] = [
                'date' => $date,
                'has_record' => $record !== null,
                'count_channels' => $record ? (int) ($record->count_channels ?? 0) : null,
                'count_videos' => $record ? (int) ($record->count_videos ?? 0) : null,
                'total_views' => $record ? (int) ($record->total_views ?? 0) : null,
                'week_count_videos' => $weekVideos,
                'week_total_views' => $weekViews,
                'week_average' => $weekVideos > 0 ? $weekViews / $weekVideos : null,
                'value' => $this->valueForType($type, $weekViews, $weekVideos),
            ];
        }

        return [
            'cache_rows' => count($byDate),
            'series' => $series,
        ];
    }

    private function valueForType(string $type, int $weekViews, int $weekVideos): ?float
    {
        return match ($type) {
            'count_videos' => (float) $weekVideos,
            'average' => $weekVideos > 0 ? $weekViews / $weekVideos : null,
            default => (float) $weekViews,
        };
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
     * @param array{from: string, to: string, days: int|string, today: int} $range
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters, string $type, array $range): array
    {
        return array_filter([
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
            'type' => $type,
            'from' => $range['from'],
            'to' => $range['to'],
            'days' => $range['days'],
            'today' => $range['today'],
        ], fn (mixed $value): bool => $value !== '');
    }
}
