<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LiveChannelsReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, title: string, rows: array<int, array<string, mixed>>, generated_at: string, filters: array<string, mixed>, period: array<string, mixed>}
     */
    public function forRequest(Request $request): array
    {
        $period = $this->period($request);

        try {
            $filters = $this->tagFilter->filters($request);
            $tagNames = $this->tagFilter->tagNames();
            $channelTags = $this->tagFilter->matchingChannelTags($filters)->keyBy('u_id');
            $rows = $this->rows($filters, $period, $tagNames, $channelTags);

            return [
                'available' => true,
                'title' => $this->title($filters, $period, $tagNames),
                'rows' => $rows,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
                'period' => $period,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => $this->fallbackTitle($period),
                'rows' => [],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
                'period' => $period,
            ];
        }
    }

    /**
     * @return array{from: string, to: string, days: int, mode: string, date: string|null, previous: string, next: string}
     */
    private function period(Request $request): array
    {
        $defaultTo = $this->defaultEndDate();
        $today = now('Asia/Taipei')->toDateString();
        $days = max(1, min(366, (int) $request->query('days', 7)));

        if ($request->filled('date')) {
            $date = $this->boundedDate((string) $request->query('date'), $today);

            return [
                'from' => $date,
                'to' => $date,
                'days' => 1,
                'mode' => 'date',
                'date' => $date,
                'previous' => Carbon::parse($date, 'Asia/Taipei')->subDay()->toDateString(),
                'next' => Carbon::parse($date, 'Asia/Taipei')->addDay()->toDateString(),
            ];
        }

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
                'mode' => 'range',
                'date' => null,
                'previous' => Carbon::parse($from, 'Asia/Taipei')->subDay()->toDateString(),
                'next' => Carbon::parse($to, 'Asia/Taipei')->addDay()->toDateString(),
            ];
        }

        $to = $this->boundedDate((string) $request->query('to', $defaultTo), $today);
        $from = Carbon::parse($to, 'Asia/Taipei')->subDays($days)->toDateString();

        return [
            'from' => $from,
            'to' => $to,
            'days' => $days,
            'mode' => 'days',
            'date' => null,
            'previous' => Carbon::parse($from, 'Asia/Taipei')->subDay()->toDateString(),
            'next' => Carbon::parse($to, 'Asia/Taipei')->addDay()->toDateString(),
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
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
     * @param array{from: string, to: string, days: int, mode: string, date: string|null, previous: string, next: string} $period
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
            ->select(['videoId', 'u_id', 'the_date', 'max_current'])
            ->whereIn('u_id', $channelTagsById->keys()->all())
            ->whereBetween('the_date', [$period['from'], $period['to']])
            ->get();

        $byChannel = [];

        foreach ($logs as $log) {
            $uId = (int) $log->u_id;
            $maxCurrent = (int) ($log->max_current ?? 0);

            if ($maxCurrent <= 0) {
                continue;
            }

            if (! isset($byChannel[$uId])) {
                $byChannel[$uId] = [
                    'u_id' => $uId,
                    'total_current' => 0,
                    'live_count' => 0,
                    'max_current' => 0,
                    'max_video_id' => null,
                    'max_date' => null,
                ];
            }

            $byChannel[$uId]['total_current'] += $maxCurrent;
            $byChannel[$uId]['live_count']++;

            if ($maxCurrent > $byChannel[$uId]['max_current']) {
                $byChannel[$uId]['max_current'] = $maxCurrent;
                $byChannel[$uId]['max_video_id'] = (string) $log->videoId;
                $byChannel[$uId]['max_date'] = substr((string) $log->the_date, 0, 10);
            }
        }

        if ($byChannel === []) {
            return [];
        }

        $uIds = array_keys($byChannel);
        $maxVideoIds = collect($byChannel)
            ->pluck('max_video_id')
            ->filter()
            ->values()
            ->all();

        $channels = DB::table('urt_channel')
            ->whereIn('u_id', $uIds)
            ->get()
            ->keyBy('u_id');
        $displayRows = DB::table('urt_show_video_live')
            ->whereIn('videoId', $maxVideoIds)
            ->get()
            ->keyBy('videoId');

        return collect($byChannel)
            ->map(function (array $row) use ($channels, $displayRows, $channelTagsById, $tagNames): array {
                $channel = $channels->get($row['u_id']);
                $countRow = $channelTagsById->get($row['u_id']);
                $videoId = (string) ($row['max_video_id'] ?? '');
                $displayRow = $displayRows->get($videoId);

                return [
                    'u_id' => $row['u_id'],
                    'title' => $channel->title ?? 'Unknown channel',
                    'youtube_id' => $channel->youtube_id ?? null,
                    'thumbnail' => $channel->thumbnails ?? ($videoId !== '' ? 'https://i.ytimg.com/vi/'.$videoId.'/default_live.jpg' : 'https://page.board.tw/img/fb_img.jpg'),
                    'total_current' => $row['total_current'],
                    'live_count' => $row['live_count'],
                    'max_current' => $row['max_current'],
                    'max_video_id' => $videoId,
                    'max_video_title' => $displayRow->title ?? $videoId,
                    'max_date' => $row['max_date'],
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'channel_url' => $channel?->youtube_id ? 'https://www.youtube.com/channel/'.$channel->youtube_id : null,
                    'max_video_url' => $videoId !== '' ? 'https://www.youtube.com/watch?v='.$videoId : null,
                    'max_video_thumbnail' => $videoId !== '' ? 'https://i.ytimg.com/vi/'.$videoId.'/default_live.jpg' : null,
                ];
            })
            ->sortByDesc('total_current')
            ->values()
            ->take($filters['limit'])
            ->map(function (array $row, int $index): array {
                $row['rank'] = $index + 1;

                return $row;
            })
            ->all();
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
     * @param array{from: string, to: string, days: int, mode: string, date: string|null, previous: string, next: string} $period
     * @param array<int, string> $tagNames
     */
    private function title(array $filters, array $period, array $tagNames): string
    {
        $prefix = $this->tagTitle($filters, $tagNames);

        if ($period['mode'] === 'date') {
            return $prefix.' 在 '.$period['date'].' 直播觀看人數排行';
        }

        if ($period['mode'] === 'range') {
            return $prefix.' 從 '.$period['from'].' 到 '.$period['to'].' 直播觀看人數排行';
        }

        return $prefix.' 在 '.$period['days'].' 天內直播觀看人數排行';
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

    /**
     * @param array{from: string, to: string, days: int, mode: string, date: string|null, previous: string, next: string} $period
     */
    private function fallbackTitle(array $period): string
    {
        if ($period['mode'] === 'date') {
            return '直播頻道排行 '.$period['date'];
        }

        return '直播頻道排行 '.$period['from'].' - '.$period['to'];
    }
}
