<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class LiveDayReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, generated_at: string, filters: array<string, mixed>, period: array<string, mixed>}
     */
    public function forRequest(Request $request, ?string $pathDate = null): array
    {
        try {
            $filters = $this->tagFilter->filters($request);
            $period = $this->period($request, $pathDate);
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
                'period' => $this->period($request, $pathDate),
            ];
        }
    }

    /**
     * @return array{date: string, from: string|null, to: string|null, is_range: bool, previous: string, next: string}
     */
    private function period(Request $request, ?string $pathDate): array
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

        $date = $this->boundedDate($pathDate ?: (string) $request->query('date', $today), $today);

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
     * @param array<int, string> $tagNames
     * @param \Illuminate\Support\Collection<int, object> $channelTagsById
     * @return array<int, array<string, mixed>>
     */
    private function rows(array $filters, array $period, array $tagNames, $channelTagsById): array
    {
        if ($channelTagsById->isEmpty()) {
            return [];
        }

        $query = DB::table('urt_video_live_log')
            ->whereIn('u_id', $channelTagsById->keys()->all());

        if ($period['is_range']) {
            $query->whereBetween('the_date', [$period['from'], $period['to']]);
        } else {
            $query->where('the_date', $period['date']);
        }

        $logs = $query->get();
        $byVideo = [];

        foreach ($logs as $log) {
            $videoId = (string) $log->videoId;
            $maxCurrent = (int) ($log->max_current ?? 0);

            // Legacy-imported rows may carry a null/zero aggregate while the
            // log itself holds real viewer history; derive the peak so the
            // stream is ranked instead of silently dropped by the > 0 filter.
            if ($maxCurrent <= 0) {
                $maxCurrent = $this->peakFromLog($log->log_json);
            }

            if (! isset($byVideo[$videoId]) || $maxCurrent > $byVideo[$videoId]['max_current']) {
                $byVideo[$videoId] = [
                    'video_id' => $videoId,
                    'u_id' => (int) $log->u_id,
                    'max_current' => $maxCurrent,
                    'log_json' => $log->log_json,
                    'the_date' => (string) $log->the_date,
                ];
            }
        }

        if ($byVideo === []) {
            return [];
        }

        $videoIds = array_keys($byVideo);
        $displayRows = DB::table('urt_show_video_live')
            ->whereIn('videoId', $videoIds)
            ->get()
            ->keyBy('videoId');

        return collect($byVideo)
            ->map(function (array $row) use ($displayRows, $channelTagsById, $tagNames): array {
                $displayRow = $displayRows->get($row['video_id']);
                $countRow = $channelTagsById->get($row['u_id']);
                $trend = $this->trendValues($row['log_json']);

                return [
                    'video_id' => $row['video_id'],
                    'u_id' => $row['u_id'],
                    'thumbnail' => $displayRow->thumbnails ?? 'https://i.ytimg.com/vi/'.$row['video_id'].'/default_live.jpg',
                    'channel_title' => $displayRow->channelTitle ?? 'Unknown channel',
                    'published_at' => $displayRow->publishedAt ?? $row['the_date'],
                    'title' => $displayRow->title ?? $row['video_id'],
                    'max_current' => $row['max_current'],
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'trend_values' => $trend,
                    'trend_label' => $trend === [] ? '' : implode(', ', array_slice($trend, -8)),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$row['video_id'],
                ];
            })
            ->filter(fn (array $row): bool => $row['max_current'] > 0 && strlen($row['video_id']) > 1)
            ->sortByDesc('max_current')
            ->values()
            ->take($filters['limit'])
            ->map(function (array $row, int $index): array {
                $row['rank'] = $index + 1;

                return $row;
            })
            ->all();
    }

    private function peakFromLog(?string $json): int
    {
        if (! is_string($json) || $json === '') {
            return 0;
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded) || $decoded === []) {
            return 0;
        }

        return (int) collect($decoded)
            ->map(fn ($value): int => (int) $value)
            ->max();
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
}
