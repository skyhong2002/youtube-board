<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\LiveDisplayCachePreview;
use Illuminate\Database\QueryException;

class ReportsLiveBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:live:build {--hours=2 : Live rows newer than this many hours are considered} {--limit=20 : Number of preview rows to print} {--execute : Write missing urt_show_video_live display cache rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute legacy live display cache inserts from local live rows';

    public function handle(LiveDisplayCachePreview $preview): int
    {
        $hours = max(1, min(720, (int) $this->option('hours')));
        $limit = max(1, min(100, (int) $this->option('limit')));
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            $payload = $preview->preview(hours: $hours, limit: $limit, execute: $execute);

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
            }

            $this->line(sprintf(
                'reports:live:build mode=%s candidates=%d already_cached=%d would_insert=%d missing_video_metadata=%d hours=%d expire_time=%s generated_at=%s writes=%d',
                $payload['mode'],
                $payload['candidates'],
                $payload['already_cached'],
                $payload['would_insert'],
                $payload['missing_video_metadata'],
                $payload['hours'],
                $payload['expire_time'],
                $payload['generated_at'],
                $payload['cache_writes'] ?? (is_array($payload['writes']) ? count($payload['writes']) : (int) $payload['writes']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d pk_live=%d video=%s v_pk=%d channel="%s" title="%s"',
                    $index + 1,
                    $row['pk_live'],
                    $row['video_id'],
                    $row['v_pk'],
                    $row['channel_title'],
                    mb_strimwidth($row['title'], 0, 72, '...', 'UTF-8'),
                ));
            }

            return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
        } catch (QueryException $exception) {
            $this->error('reports:live:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
