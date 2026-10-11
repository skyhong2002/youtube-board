<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\LiveCleanupPreview;
use Illuminate\Database\QueryException;

class ReportsLiveCleanCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:live:clean {--limit=20 : Number of invalid live tag-date cache rows to print} {--execute : Delete selected invalid urt_show_live_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Ingestion preview of legacy live tag-date cache cleanup; execute mode deletes selected cache rows';

    public function handle(LiveCleanupPreview $preview): int
    {
        try {
            $payload = $preview->tagDateCachePreview(
                limit: (int) $this->option('limit'),
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'reports:live:clean mode=%s total_rows=%d would_delete=%d deleted=%d retained_rows=%d generated_at=%s writes=%d',
                $payload['mode'],
                $payload['total_rows'],
                $payload['would_delete'],
                $payload['deleted'],
                $payload['retained_rows'],
                $payload['generated_at'],
                count($payload['writes']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d pk=%d ctime=%s the_date=%s tagid=%s count_videos=%s',
                    $index + 1,
                    $row['pk'],
                    $row['ctime'],
                    $row['the_date'],
                    $row['tagid'] ?? '-',
                    $row['count_videos'] ?? '-',
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('reports:live:clean unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
