<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\ScheduleReportsPreview;
use Illuminate\Database\QueryException;

class ReportsScheduleBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:schedule:build {--videoId= : Preview one scheduled video} {--hours=1 : Lookback window for recently refreshed schedule rows} {--limit=20 : Number of schedule rows to print/update} {--execute : Update selected urt_video_schedule stime rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute legacy schedule stime recalculation updates';

    public function handle(ScheduleReportsPreview $preview): int
    {
        try {
            $payload = $preview->preview(
                videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
                hours: (int) $this->option('hours'),
                limit: (int) $this->option('limit'),
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            );

            if ($this->option('json')) {
                $this->line(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

                return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
            }

            $this->line(sprintf(
                'reports:schedule:build mode=%s candidates=%d with_history=%d missing_history=%d would_update=%d updated=%d window_start=%s generated_at=%s writes=%d',
                $payload['mode'],
                $payload['candidates'],
                $payload['with_history'],
                $payload['missing_history'],
                $payload['would_update'],
                $payload['updated'],
                $payload['window_start'],
                $payload['generated_at'],
                count($payload['writes']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s views_delta=%d views_per_hour=%.3f current_stime=%s estimated_stime=%s cap=%s',
                    $index + 1,
                    $row['video_id'],
                    $row['view_delta'],
                    $row['views_per_hour'],
                    $row['current_stime'] ?? '-',
                    $row['estimated_stime'],
                    $row['cap'],
                ));
            }

            return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
        } catch (QueryException $exception) {
            $this->error('reports:schedule:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
