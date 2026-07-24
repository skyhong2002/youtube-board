<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class LiveCurrentReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, generated_at: string, filters: array<string, mixed>}
     */
    public function forRequest(Request $request): array
    {
        try {
            $filters = $this->filters($request);
            $tagNames = $this->tagFilter->tagNames();
            $channelTags = $this->tagFilter->matchingChannelTags($filters);
            $rows = $this->liveRows($filters, $tagNames, $channelTags);

            return [
                'available' => true,
                'rows' => $rows,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'rows' => [],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'filters' => $request->query(),
            ];
        }
    }

    /**
     * @return array{or: array<int>, tagid: array<int>, not: array<int>, hours: int|null, limit: int}
     */
    private function filters(Request $request): array
    {
        $filters = $this->tagFilter->filters($request);
        $filters['hours'] = $request->has('hours') ? max(1, min(168, (int) $request->query('hours', 24))) : null;

        return $filters;
    }

    /**
     * @param array{or: array<int>, tagid: array<int>, not: array<int>, hours: int|null, limit: int} $filters
     * @param array<int, string> $tagNames
     * @param Collection<int, object> $channelTags
     * @return array<int, array<string, mixed>>
     */
    private function liveRows(array $filters, array $tagNames, Collection $channelTags): array
    {
        if ($channelTags->isEmpty()) {
            return [];
        }

        $now = now('Asia/Taipei');
        $latestTime = $now->copy()->subHour()->format('Y-m-d H:i:s');
        $today = $now->toDateString();
        $channelTagsById = $channelTags->keyBy('u_id');

        $query = DB::table('urt_video_live')
            ->whereIn('u_id', $channelTagsById->keys()->all())
            ->whereNull('actualEndTime')
            ->where('concurrentViewers', '>', 0)
            ->where('mtime', '>=', $latestTime);

        if ($filters['hours'] !== null) {
            $query->where('actualStartTime', '>=', $now->copy()->subHours($filters['hours'])->format('Y-m-d H:i:s'));
        }

        $liveRows = $query
            ->orderByDesc('concurrentViewers')
            ->limit($filters['limit'])
            ->get();

        if ($liveRows->isEmpty()) {
            return [];
        }

        $videoIds = $liveRows->pluck('videoId')->filter()->unique()->values()->all();
        $displayRows = DB::table('urt_show_video_live')
            ->whereIn('videoId', $videoIds)
            ->get()
            ->keyBy('videoId');
        $logRows = DB::table('urt_video_live_log')
            ->whereIn('videoId', $videoIds)
            ->where('the_date', $today)
            ->get()
            ->keyBy('videoId');

        return $liveRows
            ->map(function ($liveRow, int $index) use ($displayRows, $logRows, $channelTagsById, $tagNames): array {
                $displayRow = $displayRows->get($liveRow->videoId);
                $logRow = $logRows->get($liveRow->videoId);
                $countRow = $channelTagsById->get($liveRow->u_id);
                $trend = $this->trendValues($logRow->log_json ?? null);

                // Every row here is actively live (no end time, positive viewers,
                // polled within the hour). A stream whose same-day log row has not
                // been written yet must not vanish behind the today_peak filter:
                // fall back from the stored aggregate to the log history, then to
                // the currently observed viewers (a true floor for today's peak).
                $todayPeak = $logRow?->max_current !== null ? (int) $logRow->max_current : 0;
                if ($todayPeak <= 0) {
                    $todayPeak = $this->peakFromLog($logRow->log_json ?? null);
                }
                if ($todayPeak <= 0) {
                    $todayPeak = (int) $liveRow->concurrentViewers;
                }

                return [
                    'rank' => $index + 1,
                    'video_id' => $liveRow->videoId,
                    'u_id' => (int) $liveRow->u_id,
                    'thumbnail' => $displayRow->thumbnails ?? null,
                    'channel_title' => $displayRow->channelTitle ?? 'Unknown channel',
                    'published_at' => $displayRow->publishedAt ?? $liveRow->publishedAt,
                    'title' => $displayRow->title ?? $liveRow->videoId,
                    'current_viewers' => (int) $liveRow->concurrentViewers,
                    'today_peak' => $todayPeak > 0 ? $todayPeak : null,
                    'all_time_peak' => $liveRow->max_current !== null ? (int) $liveRow->max_current : null,
                    'tags' => $this->tagFilter->visibleTags($countRow->tags ?? '', $tagNames),
                    'trend_values' => $trend,
                    'trend_label' => $trend === [] ? '' : implode(', ', array_slice($trend, -8)),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$liveRow->videoId,
                ];
            })
            ->filter(fn (array $row): bool => ($row['today_peak'] ?? 0) > 0)
            ->values()
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
