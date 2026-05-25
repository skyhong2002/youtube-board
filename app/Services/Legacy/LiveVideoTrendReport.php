<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LiveVideoTrendReport
{
    /**
     * @return array{available: bool, video: array<string, mixed>|null, hourly: array<int, array{label: string, value: int}>, daily: array<int, array{label: string, value: int}>, generated_at: string, limit: int}
     */
    public function forVideo(Request $request, string $videoId): array
    {
        $limit = max(1, min(200, (int) $request->query('limit', 50)));

        try {
            $display = DB::table('urt_show_video_live')->where('videoId', $videoId)->first();
            $live = DB::table('urt_video_live')->where('videoId', $videoId)->first();
            $logs = DB::table('urt_video_live_log')
                ->where('videoId', $videoId)
                ->orderBy('the_date')
                ->get();

            if (! $display && ! $live && $logs->isEmpty()) {
                return $this->empty($limit, true);
            }

            $series = $this->series($logs, $limit);

            return [
                'available' => true,
                'video' => [
                    'video_id' => $videoId,
                    'u_id' => $live?->u_id ?? $display?->u_id,
                    'title' => $display->title ?? $videoId,
                    'channel_title' => $display->channelTitle ?? 'Unknown channel',
                    'thumbnail' => $display->thumbnails ?? 'https://i.ytimg.com/vi/'.$videoId.'/default_live.jpg',
                    'published_at' => $display->publishedAt ?? $live?->publishedAt,
                    'actual_start_time' => $live?->actualStartTime,
                    'actual_end_time' => $live?->actualEndTime,
                    'current_viewers' => $live?->concurrentViewers !== null ? (int) $live->concurrentViewers : null,
                    'max_current' => $live?->max_current !== null ? (int) $live->max_current : null,
                    'del_flag' => $live?->del_flag,
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$videoId,
                ],
                'hourly' => $series['hourly'],
                'daily' => $series['daily'],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'limit' => $limit,
            ];
        } catch (QueryException) {
            return $this->empty($limit, false);
        }
    }

    /**
     * @param \Illuminate\Support\Collection<int, object> $logs
     * @return array{hourly: array<int, array{label: string, value: int}>, daily: array<int, array{label: string, value: int}>}
     */
    private function series($logs, int $limit): array
    {
        $hourly = [];
        $daily = [];

        foreach ($logs as $log) {
            $date = (string) $log->the_date;
            $decoded = json_decode($log->log_json ?? '', true);

            if (! is_array($decoded)) {
                continue;
            }

            foreach ($decoded as $time => $views) {
                $value = (int) $views;
                $hour = date('Y-m-d H:00:00', strtotime($date.' '.$time.':00'));
                $hourly[$hour] = max($hourly[$hour] ?? 0, $value);
                $daily[$date] = max($daily[$date] ?? 0, $value);
            }
        }

        ksort($hourly);
        ksort($daily);

        return [
            'hourly' => $this->formatSeries(array_slice($hourly, -($limit + 1), null, true), 'm-d H'),
            'daily' => $this->formatSeries(array_slice($daily, -($limit + 1), null, true), 'Y-m-d'),
        ];
    }

    /**
     * @param array<string, int> $series
     * @return array<int, array{label: string, value: int}>
     */
    private function formatSeries(array $series, string $format): array
    {
        return collect($series)
            ->map(fn (int $value, string $label): array => [
                'label' => date($format, strtotime($label)),
                'value' => $value,
            ])
            ->values()
            ->all();
    }

    /**
     * @return array{available: bool, video: null, hourly: array<int, array{label: string, value: int}>, daily: array<int, array{label: string, value: int}>, generated_at: string, limit: int}
     */
    private function empty(int $limit, bool $available): array
    {
        return [
            'available' => $available,
            'video' => null,
            'hourly' => [],
            'daily' => [],
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'limit' => $limit,
        ];
    }
}
