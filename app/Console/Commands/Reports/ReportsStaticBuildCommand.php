<?php

namespace App\Console\Commands\Reports;

use App\Services\Ingestion\StaticHtmlReportsPreview;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;

class ReportsStaticBuildCommand extends Command
{
    protected $signature = 'reports:static:build {--limit=20 : Number of static group targets to print} {--json : Emit JSON instead of text}';

    protected $description = 'Ingestion preview of legacy group static HTML generation mapped to dynamic Laravel routes';

    public function handle(StaticHtmlReportsPreview $preview): int
    {
        try {
            $payload = $preview->preview(limit: (int) $this->option('limit'));

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'reports:static:build mode=ingestion-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
                $payload['targets'],
                $payload['would_generate'],
                $payload['source_status'],
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s -> %s output=%s type=%s dynamic_rows=%d cache_rows=%s available=%s',
                    $index + 1,
                    $row['legacy_url'],
                    $row['modern_url'],
                    $row['output_path'],
                    $row['report_type'],
                    $row['dynamic_rows'],
                    $row['cache_rows'] !== null ? (string) $row['cache_rows'] : 'n/a',
                    $row['dynamic_report_available'] ? 'yes' : 'no',
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('reports:static:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
