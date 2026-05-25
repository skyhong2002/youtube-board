<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LiveHoursReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, title: string, rows: array<int, array<string, mixed>>, totals: array<string, array{views: int, videos: int}>, dates: array<int, string>, generated_at: string, filters: array<string, mixed>, period: array<string, mixed>}
     */
    public function forRequest(Request $request): array
    {
        $period = $this->period($request);

        try {
            $filters = $this->tagFilter->filters($request);
            $tagNames = $this->tagFilter->tagNames();
            $channelTags = $this->tagFilter->matchingChannelTags($filters)->keyBy('u_id');
            $aggregate = $this->aggregate($period, $channelTags);

            return [
                'available' => true,
                'title' => $this->title($filters, $period, $tagNames),
                'rows' => $aggregate['rows'],
                'totals' => $aggregate['totals'],
                'dates' => $period['dates'],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
                'period' => $period,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => '直播小時熱度',
                'rows' => [],
                'totals' => [],
                'dates' => $period['dates'],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
                'period' => $period,
            ];
        }
    }

    /**
     * @return array{from: string, to: string, days: int, dates: array<int, string>, mode: string}
     */
    private function period(Request $request): array
    {
        $defaultTo = $this->defaultEndDate();
        $today = now('Asia/Taipei')->toDateString();
        $days = max(1, min(31, (int) $request->query('days', 7)));

        if ($request->filled('from')) {
            $from = $this->boundedDate((string) $request->query('from'), $today);
            $to = $this->boundedDate((string) $request->query('to', $defaultTo), $today);

            if ($from > $to) {
                [$from, $to] = [$to, $from];
            }

            return [
                'from' => $from,
                'to' => $to,
                'days' => Carbon::parse($from, 'Asia/Taipei')->diffInDays(Carbon::parse($to, 'Asia/Taipei')) + 1,
                'dates' => $this->dateRange($from, $to),
                'mode' => 'range',
            ];
        }

        $to = $this->boundedDate((string) $request->query('to', $defaultTo), $today);

        if ((int) $request->query('today', 0) > 0) {
            $to = Carbon::parse($to, 'Asia/Taipei')->subDays((int) $request->query('today'))->toDateString();
        }

        $from = Carbon::parse($to, 'Asia/Taipei')->subDays($days)->toDateString();

        return [
            'from' => $from,
            'to' => $to,
            'days' => $days,
            'dates' => $this->dateRange($from, $to),
            'mode' => 'days',
        ];
    }

    private function defaultEndDate(): string
    {
        $today = now('Asia/Taipei')->toDateString();
        $latestDate = $this->latestLogDate();

        if (is_string($latestDate) && $latestDate <= $today) {
            return $latestDate;
        }

        return $today;
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
     * @param array{from: string, to: string, days: int, dates: array<int, string>, mode: string} $period
     * @param \Illuminate\Support\Collection<int, object> $channelTagsById
     * @return array{rows: array<int, array<string, mixed>>, totals: array<string, array{views: int, videos: int}>}
     */
    private function aggregate(array $period, $channelTagsById): array
    {
        if ($channelTagsById->isEmpty()) {
            return [
                'rows' => $this->emptyRows($period['dates']),
                'totals' => $this->emptyTotals($period['dates']),
            ];
        }

        $logs = DB::table('urt_video_live_log')
            ->select(['videoId', 'u_id', 'the_date', 'log_json'])
            ->whereIn('u_id', $channelTagsById->keys()->all())
            ->whereBetween('the_date', [$period['from'], $period['to']])
            ->get();

        $perVideo = [];

        foreach ($logs as $log) {
            $date = substr((string) $log->the_date, 0, 10);
            $videoId = (string) $log->videoId;

            foreach ($this->hourlyPeaks($log->log_json) as $hour => $views) {
                $perVideo[$date][$videoId][$hour] = max($perVideo[$date][$videoId][$hour] ?? 0, $views);
            }
        }

        $matrix = [];
        $totals = $this->emptyTotals($period['dates']);

        foreach ($period['dates'] as $date) {
            for ($hour = 0; $hour < 24; $hour++) {
                $hourKey = sprintf('%02d', $hour);
                $matrix[$hourKey][$date] = ['views' => 0, 'videos' => 0];
            }
        }

        foreach ($perVideo as $date => $videos) {
            foreach ($videos as $hours) {
                foreach ($hours as $hour => $views) {
                    if (! isset($matrix[$hour][$date])) {
                        continue;
                    }

                    $matrix[$hour][$date]['views'] += $views;
                    $matrix[$hour][$date]['videos']++;
                    $totals[$date]['views'] += $views;
                    $totals[$date]['videos']++;
                }
            }
        }

        $rows = collect(range(0, 23))
            ->map(function (int $hour) use ($matrix): array {
                $hourKey = sprintf('%02d', $hour);
                $cells = $matrix[$hourKey] ?? [];

                return [
                    'hour' => $hourKey,
                    'views' => collect($cells)->sum('views'),
                    'videos' => collect($cells)->sum('videos'),
                    'cells' => $cells,
                ];
            })
            ->all();

        return ['rows' => $rows, 'totals' => $totals];
    }

    /**
     * @return array<int, array{hour: string, views: int, videos: int, cells: array<string, array{views: int, videos: int}>}>
     */
    private function emptyRows(array $dates): array
    {
        return collect(range(0, 23))
            ->map(function (int $hour) use ($dates): array {
                $hourKey = sprintf('%02d', $hour);

                return [
                    'hour' => $hourKey,
                    'views' => 0,
                    'videos' => 0,
                    'cells' => collect($dates)->mapWithKeys(fn (string $date): array => [$date => ['views' => 0, 'videos' => 0]])->all(),
                ];
            })
            ->all();
    }

    /**
     * @return array<string, array{views: int, videos: int}>
     */
    private function emptyTotals(array $dates): array
    {
        return collect($dates)
            ->mapWithKeys(fn (string $date): array => [$date => ['views' => 0, 'videos' => 0]])
            ->all();
    }

    /**
     * @return array<string, int>
     */
    private function hourlyPeaks(?string $json): array
    {
        if (! is_string($json) || $json === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        $hours = [];

        foreach ($decoded as $time => $views) {
            $hour = substr((string) $time, 0, 2);

            if (! preg_match('/^\d{2}$/', $hour)) {
                continue;
            }

            $hourInt = (int) $hour;

            if ($hourInt < 0 || $hourInt > 23) {
                continue;
            }

            $hours[$hour] = max($hours[$hour] ?? 0, (int) $views);
        }

        return $hours;
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
     * @param array{from: string, to: string, days: int, dates: array<int, string>, mode: string} $period
     * @param array<int, string> $tagNames
     */
    private function title(array $filters, array $period, array $tagNames): string
    {
        $prefix = $this->tagTitle($filters, $tagNames);

        if ($period['mode'] === 'range') {
            return $prefix.' 從 '.$period['from'].' 到 '.$period['to'].' 的直播小時熱度';
        }

        return $prefix.' 在 '.$period['days'].' 天的直播小時熱度';
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
     * @param array<int, string> $tagNames
     */
    private function tagTitle(array $filters, array $tagNames): string
    {
        $selected = collect([...$filters['tagid'], ...$filters['or']])
            ->unique()
            ->map(fn (int $tagId): string => $tagNames[$tagId] ?? (string) $tagId)
            ->filter()
            ->implode(' ');

        return $selected !== '' ? $selected : '所有頻道';
    }
}
