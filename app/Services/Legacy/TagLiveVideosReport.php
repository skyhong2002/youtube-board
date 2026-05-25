<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class TagLiveVideosReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, tag: array{id: int, name: string}, filters: array<string, mixed>, period: array<string, mixed>, generated_at: string, title: string}
     */
    public function forTag(Request $request, int $tagId = 0): array
    {
        try {
            $tagNames = $this->tagFilter->tagNames();
            $filters = $this->filters($request, $tagId);
            $period = $this->period($request);
            $channelTags = $this->tagFilter->matchingChannelTags($filters);
            $rows = $this->rows($filters, $period, $channelTags, $tagNames);

            return [
                'available' => true,
                'rows' => $rows,
                'tag' => ['id' => $tagId, 'name' => $tagNames[$tagId] ?? ($tagId > 0 ? (string) $tagId : '所有頻道')],
                'filters' => $this->displayFilters($request, $period),
                'period' => $period,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'title' => $this->title($filters, $period, $tagNames),
            ];
        } catch (QueryException) {
            $period = $this->period($request);

            return [
                'available' => false,
                'rows' => [],
                'tag' => ['id' => $tagId, 'name' => $tagId > 0 ? (string) $tagId : '所有頻道'],
                'filters' => $request->query(),
                'period' => $period,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'title' => '直播觀看人數排行',
            ];
        }
    }

    /**
     * @return array{or: array<int>, tagid: array<int>, not: array<int>, limit: int}
     */
    private function filters(Request $request, int $tagId): array
    {
        $filters = $this->tagFilter->filters($request);

        if ($tagId > 0) {
            if ($filters['tagid'] === []) {
                $filters['tagid'] = [$tagId];
            } elseif (! in_array($tagId, $filters['tagid'], true)) {
                array_unshift($filters['tagid'], $tagId);
            }
        }

        return $filters;
    }

    /**
     * @return array{date: string, from: string|null, to: string|null, is_range: bool, previous: string, next: string}
     */
    private function period(Request $request): array
    {
        $today = now('Asia/Taipei')->toDateString();

        if ($request->filled('from')) {
            $from = $this->boundedDate((string) $request->query('from'), $today);
            $to = $this->boundedDate((string) $request->query('to', $today), $today);

            if ($from > $to) {
                [$from, $to] = [$to, $from];
            }

            return [
                'date' => $to,
                'from' => $from,
                'to' => $to,
                'is_range' => true,
                'previous' => Carbon::parse($from, 'Asia/Taipei')->subDay()->toDateString(),
                'next' => Carbon::parse($to, 'Asia/Taipei')->addDay()->toDateString(),
            ];
        }

        $date = $this->boundedDate((string) $request->query('date', $today), $today);

        return [
            'date' => $date,
            'from' => null,
            'to' => null,
            'is_range' => false,
            'previous' => Carbon::parse($date, 'Asia/Taipei')->subDay()->toDateString(),
            'next' => Carbon::parse($date, 'Asia/Taipei')->addDay()->toDateString(),
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
     * @param array{date: string, from: string|null, to: string|null, is_range: bool, previous: string, next: string} $period
     * @param Collection<int, object> $channelTags
     * @param array<int, string> $tagNames
     * @return array<int, array<string, mixed>>
     */
    private function rows(array $filters, array $period, Collection $channelTags, array $tagNames): array
    {
        if ($channelTags->isEmpty()) {
            return [];
        }

        $channelTagsById = $channelTags->keyBy('u_id');
        $query = DB::table('urt_video_live_log')
            ->whereIn('u_id', $channelTagsById->keys()->all());

        if ($period['is_range']) {
            $query->whereBetween('the_date', [$period['from'], $period['to']]);
        } else {
            $query->where('the_date', $period['date']);
        }

        $logs = $query->where('max_current', '>', 0)->get();

        if ($logs->isEmpty()) {
            return [];
        }

        $displayRows = DB::table('urt_show_video_live')
            ->whereIn('videoId', $logs->pluck('videoId')->filter()->unique()->values()->all())
            ->get()
            ->keyBy('videoId');

        return $logs
            ->map(function (object $log) use ($displayRows, $channelTagsById, $tagNames): array {
                $displayRow = $displayRows->get($log->videoId);
                $countRow = $channelTagsById->get($log->u_id);
                $trend = $this->trendValues($log->log_json ?? null);

                return [
                    'video_id' => (string) $log->videoId,
                    'u_id' => (int) $log->u_id,
                    'the_date' => (string) $log->the_date,
                    'thumbnail' => $displayRow->thumbnails ?? 'https://i.ytimg.com/vi/'.$log->videoId.'/default_live.jpg',
                    'channel_title' => $displayRow->channelTitle ?? 'Unknown channel',
                    'published_at' => $displayRow->publishedAt ?? $log->the_date,
                    'title' => $displayRow->title ?? (string) $log->videoId,
                    'max_current' => (int) ($log->max_current ?? 0),
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'trend_values' => $trend,
                    'trend_label' => $trend === [] ? '' : implode(', ', array_slice($trend, -8)),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$log->videoId,
                ];
            })
            ->filter(fn (array $row): bool => $row['video_id'] !== '')
            ->sortByDesc('max_current')
            ->values()
            ->take($filters['limit'])
            ->map(function (array $row, int $index): array {
                $row['rank'] = $index + 1;

                return $row;
            })
            ->all();
    }

    /**
     * @return array<int>
     */
    private function trendValues(?string $json): array
    {
        if (! is_string($json) || $json === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        return collect($decoded)
            ->values()
            ->map(fn ($value): int => (int) $value)
            ->slice(-24)
            ->values()
            ->all();
    }

    /**
     * @param array{date: string, from: string|null, to: string|null, is_range: bool, previous: string, next: string} $period
     * @return array<string, mixed>
     */
    private function displayFilters(Request $request, array $period): array
    {
        $filters = $request->query();

        if (! $period['is_range']) {
            $filters['date'] = $period['date'];
        }

        return $filters;
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, limit: int} $filters
     * @param array{date: string, from: string|null, to: string|null, is_range: bool, previous: string, next: string} $period
     * @param array<int, string> $tagNames
     */
    private function title(array $filters, array $period, array $tagNames): string
    {
        $tagIds = array_values(array_unique(array_merge($filters['tagid'], $filters['or'])));
        $prefix = collect($tagIds)
            ->map(fn (int $tagId): string => $tagNames[$tagId] ?? (string) $tagId)
            ->filter()
            ->implode(' ');

        if ($prefix === '') {
            $prefix = '所有頻道';
        }

        if ($period['is_range']) {
            return $prefix.' 從 '.$period['from'].' 到 '.$period['to'].' 直播觀看人數排行';
        }

        return $prefix.' 在 '.$period['date'].' 直播觀看人數排行';
    }
}
