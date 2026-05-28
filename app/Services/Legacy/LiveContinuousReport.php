<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class LiveContinuousReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, generated_at: string, filters: array<string, mixed>, period: array<string, mixed>}
     */
    public function forRequest(Request $request): array
    {
        try {
            $filters = $this->filters($request);
            $period = $this->period($request);
            $tagNames = $this->tagFilter->tagNames();
            $channelTags = $this->tagFilter->matchingChannelTags($filters);
            $rows = $this->rows($filters, $period, $tagNames, $channelTags->keyBy('u_id'));

            return [
                'available' => true,
                'rows' => $rows,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
                'period' => $period,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'rows' => [],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
                'period' => $this->period($request),
            ];
        }
    }

    /**
     * @return array{from: string, to: string, days: int, is_range: bool}
     */
    private function period(Request $request): array
    {
        $today = $this->latestLogDate() ?? now('Asia/Taipei')->toDateString();
        $days = max(1, min(366, (int) $request->query('days', 7)));

        if ($request->filled('from')) {
            $from = $this->boundedDate((string) $request->query('from'), $today);
            $to = $this->boundedDate((string) $request->query('to', $today), $today);

            if ($from > $to) {
                [$from, $to] = [$to, $from];
            }

            return [
                'from' => $from,
                'to' => $to,
                'days' => max(1, Carbon::parse($from, 'Asia/Taipei')->diffInDays(Carbon::parse($to, 'Asia/Taipei')) + 1),
                'is_range' => true,
            ];
        }

        $from = Carbon::parse($today, 'Asia/Taipei')->subDays($days - 1)->toDateString();

        return [
            'from' => $from,
            'to' => $today,
            'days' => $days,
            'is_range' => false,
        ];
    }

    private function latestLogDate(): ?string
    {
        try {
            $date = DB::table('urt_video_live_log')->max('the_date');

            return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}/', $date)
                ? substr($date, 0, 10)
                : null;
        } catch (QueryException) {
            return null;
        }
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
     * @return array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, hours: int}
     */
    private function filters(Request $request): array
    {
        $filters = $this->tagFilter->filters($request);
        $filters['hours'] = max(1, min(168, (int) $request->query('hours', 24)));

        return $filters;
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int, hours: int} $filters
     * @param array{from: string, to: string, days: int, is_range: bool} $period
     * @param array<int, string> $tagNames
     * @param \Illuminate\Support\Collection<int, object> $channelTagsById
     * @return array<int, array<string, mixed>>
     */
    private function rows(array $filters, array $period, array $tagNames, $channelTagsById): array
    {
        if ($channelTagsById->isEmpty()) {
            return [];
        }

        $now = now('Asia/Taipei');
        $freshSince = $now->copy()->subHour()->format('Y-m-d H:i:s');
        $continuousCutoff = $now->copy()->subHours($filters['hours'])->format('Y-m-d H:i:s');

        $activeRows = DB::table('urt_video_live')
            ->whereIn('u_id', $channelTagsById->keys()->all())
            ->whereNull('actualEndTime')
            ->where('concurrentViewers', '>', 0)
            ->where('mtime', '>=', $freshSince)
            ->where(function ($query) use ($continuousCutoff): void {
                $query->whereNull('actualStartTime')
                    ->orWhere('actualStartTime', '<', $continuousCutoff);
            })
            ->orderByDesc('concurrentViewers')
            ->limit($filters['limit'])
            ->get();

        if ($activeRows->isEmpty()) {
            return [];
        }

        $videoIds = $activeRows->pluck('videoId')->filter()->unique()->values()->all();
        $uIds = $activeRows->pluck('u_id')->unique()->values()->all();
        $logs = DB::table('urt_video_live_log')
            ->whereIn('videoId', $videoIds)
            ->whereBetween('the_date', [$period['from'], $period['to']])
            ->orderBy('videoId')
            ->orderBy('the_date')
            ->get();

        $statsByVideo = $this->statsByVideo($logs, $period['to']);

        $channels = DB::table('urt_channel')
            ->whereIn('u_id', $uIds)
            ->get()
            ->keyBy('u_id');
        $displayRows = DB::table('urt_show_video_live')
            ->whereIn('videoId', $videoIds)
            ->get()
            ->keyBy('videoId');

        return $activeRows
            ->map(function (object $liveRow) use ($channels, $displayRows, $channelTagsById, $tagNames, $statsByVideo): array {
                $videoId = (string) $liveRow->videoId;
                $displayRow = $displayRows->get($videoId);
                $channel = $channels->get($liveRow->u_id);
                $countRow = $channelTagsById->get($liveRow->u_id);
                $current = (int) ($liveRow->concurrentViewers ?? 0);
                $stats = $statsByVideo[$videoId] ?? [
                    'sum' => 0,
                    'days' => 0,
                    'weekly_peak' => 0,
                    'today_peak' => null,
                ];
                $allTimePeak = $liveRow->max_current !== null ? (int) $liveRow->max_current : null;
                $todayPeak = $stats['today_peak'] ?? $current;
                $weeklyPeak = $stats['weekly_peak'] > 0 ? $stats['weekly_peak'] : $current;
                $weeklyAverage = $stats['days'] > 0
                    ? (int) round($stats['sum'] / $stats['days'])
                    : $current;

                return [
                    'video_id' => $videoId,
                    'u_id' => (int) $liveRow->u_id,
                    'thumbnail' => $displayRow->thumbnails ?? 'https://i.ytimg.com/vi/'.$videoId.'/default_live.jpg',
                    'channel_title' => $channel->title ?? $displayRow->channelTitle ?? 'Unknown channel',
                    'title' => $displayRow->title ?? $videoId,
                    'current_viewers' => $current,
                    'today_peak' => $todayPeak,
                    'weekly_average' => $weeklyAverage,
                    'weekly_peak' => $weeklyPeak,
                    'all_time_peak' => $allTimePeak,
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$videoId,
                ];
            })
            ->sortByDesc('current_viewers')
            ->values()
            ->take($filters['limit'])
            ->map(function (array $row, int $index): array {
                $row['rank'] = $index + 1;

                return $row;
            })
            ->all();
    }

    /**
     * @return array<string, array{sum: int, days: int, weekly_peak: int, today_peak: int|null}>
     */
    private function statsByVideo(Collection $logs, string $today): array
    {
        $stats = [];

        foreach ($logs as $log) {
            $videoId = (string) $log->videoId;

            if (! isset($stats[$videoId])) {
                $stats[$videoId] = [
                    'sum' => 0,
                    'days' => 0,
                    'weekly_peak' => 0,
                    'today_peak' => null,
                ];
            }

            $maxCurrent = (int) ($log->max_current ?? 0);
            $stats[$videoId]['sum'] += $maxCurrent;
            $stats[$videoId]['days']++;
            $stats[$videoId]['weekly_peak'] = max($stats[$videoId]['weekly_peak'], $maxCurrent);

            if ((string) $log->the_date === $today) {
                $stats[$videoId]['today_peak'] = $maxCurrent;
            }
        }

        return $stats;
    }
}
