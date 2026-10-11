<?php

namespace App\Console\Commands\Reports;

use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class ReportsLiveShowCommand extends Command
{
    protected $signature = 'reports:live:show {--limit=10 : Number of top live rows to print} {--json : Emit JSON instead of text}';

    protected $description = 'Live dashboard snapshot of the live display report from local live/cache rows';

    public function handle(): int
    {
        $limit = max(1, min(50, (int) $this->option('limit')));
        $now = now(config('ingestion.timezone', 'Asia/Taipei'));
        $latestTime = $now->copy()->subHour()->format('Y-m-d H:i:s');
        $today = $now->toDateString();

        try {
            $activeLive = DB::table('urt_video_live')
                ->whereNull('actualEndTime')
                ->where('concurrentViewers', '>', 0)
                ->where('mtime', '>=', $latestTime)
                ->count();

            $topRows = DB::table('urt_video_live')
                ->select(['videoId', 'u_id', 'concurrentViewers', 'max_current', 'mtime'])
                ->whereNull('actualEndTime')
                ->where('concurrentViewers', '>', 0)
                ->where('mtime', '>=', $latestTime)
                ->orderByDesc('concurrentViewers')
                ->limit($limit)
                ->get();

            $videoIds = $topRows->pluck('videoId')->filter()->unique()->values()->all();
            $displayRows = $videoIds === []
                ? collect()
                : DB::table('urt_show_video_live')
                    ->whereIn('videoId', $videoIds)
                    ->get()
                    ->keyBy('videoId');

            $logRowsToday = DB::table('urt_video_live_log')
                ->where('the_date', $today)
                ->count();

            $rows = $topRows
                ->map(function (object $row, int $index) use ($displayRows): array {
                    $display = $displayRows->get($row->videoId);

                    return [
                        'rank' => $index + 1,
                        'video_id' => (string) $row->videoId,
                        'u_id' => $row->u_id !== null ? (int) $row->u_id : null,
                        'title' => (string) ($display->title ?? $row->videoId),
                        'channel_title' => (string) ($display->channelTitle ?? 'Unknown channel'),
                        'current_viewers' => (int) $row->concurrentViewers,
                        'max_current' => $row->max_current !== null ? (int) $row->max_current : null,
                        'mtime' => (string) ($row->mtime ?? ''),
                    ];
                })
                ->values()
                ->all();

            $payload = [
                'mode' => 'dashboard-snapshot',
                'generated_at' => $now->format('Y-m-d H:i:s'),
                'active_live' => $activeLive,
                'shown' => count($rows),
                'log_rows_today' => $logRowsToday,
                'rows' => $rows,
                'writes' => [],
            ];

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'reports:live:show mode=dashboard-snapshot active_live=%d shown=%d log_rows_today=%d generated_at=%s',
                $payload['active_live'],
                $payload['shown'],
                $payload['log_rows_today'],
                $payload['generated_at'],
            ));

            foreach ($rows as $row) {
                $this->line(sprintf(
                    '#%d %s viewers=%d peak=%s channel="%s" title="%s"',
                    $row['rank'],
                    $row['video_id'],
                    $row['current_viewers'],
                    $row['max_current'] !== null ? number_format($row['max_current']) : 'n/a',
                    $row['channel_title'],
                    mb_strimwidth($row['title'], 0, 72, '...', 'UTF-8'),
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('reports:live:show unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
