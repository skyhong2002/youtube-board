<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
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
            $filters = $this->tagFilter->filters($request);
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
        $today = now('Asia/Taipei')->toDateString();
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

        $from = now('Asia/Taipei')->subDays($days)->toDateString();

        return [
            'from' => $from,
            'to' => $today,
            'days' => $days,
            'is_range' => false,
        ];
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
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
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

        $logs = DB::table('urt_video_live_log')
            ->whereIn('u_id', $channelTagsById->keys()->all())
            ->whereBetween('the_date', [$period['from'], $period['to']])
            ->orderBy('videoId')
            ->orderBy('the_date')
            ->get();

        $videos = [];
        $today = now('Asia/Taipei')->toDateString();

        foreach ($logs as $log) {
            $videoId = (string) $log->videoId;

            if (! isset($videos[$videoId])) {
                $videos[$videoId] = [
                    'video_id' => $videoId,
                    'u_id' => (int) $log->u_id,
                    'sum' => 0,
                    'days' => 0,
                    'weekly_peak' => 0,
                    'today_peak' => null,
                ];
            }

            $maxCurrent = (int) ($log->max_current ?? 0);
            $videos[$videoId]['sum'] += $maxCurrent;
            $videos[$videoId]['days']++;
            $videos[$videoId]['weekly_peak'] = max($videos[$videoId]['weekly_peak'], $maxCurrent);

            if ((string) $log->the_date === $today) {
                $videos[$videoId]['today_peak'] = $maxCurrent;
            }
        }

        $videos = collect($videos)
            ->filter(fn (array $row): bool => $row['days'] >= 7)
            ->values();

        if ($videos->isEmpty()) {
            return [];
        }

        $videoIds = $videos->pluck('video_id')->all();
        $uIds = $videos->pluck('u_id')->unique()->all();
        $channels = DB::table('urt_channel')
            ->whereIn('u_id', $uIds)
            ->get()
            ->keyBy('u_id');
        $liveRows = DB::table('urt_video_live')
            ->whereIn('videoId', $videoIds)
            ->get()
            ->keyBy('videoId');
        $displayRows = DB::table('urt_show_video_live')
            ->whereIn('videoId', $videoIds)
            ->get()
            ->keyBy('videoId');

        return $videos
            ->map(function (array $row) use ($channels, $liveRows, $displayRows, $channelTagsById, $tagNames): array {
                $liveRow = $liveRows->get($row['video_id']);
                $displayRow = $displayRows->get($row['video_id']);
                $channel = $channels->get($row['u_id']);
                $countRow = $channelTagsById->get($row['u_id']);
                $current = (int) ($liveRow->concurrentViewers ?? 0);

                return [
                    'video_id' => $row['video_id'],
                    'u_id' => $row['u_id'],
                    'thumbnail' => 'https://i.ytimg.com/vi/'.$row['video_id'].'/default_live.jpg',
                    'channel_title' => $channel->title ?? $displayRow->channelTitle ?? 'Unknown channel',
                    'title' => $displayRow->title ?? $row['video_id'],
                    'current_viewers' => $current,
                    'today_peak' => $row['today_peak'],
                    'weekly_average' => (int) round($row['sum'] / max(1, $row['days'])),
                    'weekly_peak' => $row['weekly_peak'],
                    'all_time_peak' => $liveRow?->max_current !== null ? (int) $liveRow->max_current : null,
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$row['video_id'],
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
}
