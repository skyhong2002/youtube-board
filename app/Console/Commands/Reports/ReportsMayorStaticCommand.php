<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\MayorStaticReportsPreview;
use Illuminate\Database\QueryException;

class ReportsMayorStaticCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:mayor:static {--city= : Optional mayor city key to preview} {--limit=20 : Number of mayor static targets to print} {--offset=0 : Target offset, or auto for scheduler rotation} {--keyword-limit=5000 : Number of local keywords to scan when --execute builds tag-date cache} {--execute : Build missing local tag-date cache for mayor targets} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview legacy mayor static HTML generation; --execute rebuilds required local tag-date cache for dynamic Laravel routes';

    public function handle(MayorStaticReportsPreview $preview): int
    {
        try {
            $city = $this->option('city') ? (string) $this->option('city') : null;
            $limit = (int) $this->option('limit');
            $payload = (bool) $this->option('execute') && ! (bool) $this->option('dry-run')
                ? $preview->execute(city: $city, limit: $limit, keywordLimit: (int) $this->option('keyword-limit'), offset: (string) $this->option('offset'))
                : $preview->preview(city: $city, limit: $limit, offset: (string) $this->option('offset'));

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'reports:mayor:static mode=%s targets=%d would_generate=%d source_status="%s" generated_at=%s cache_jobs=%d cache_writes=%d failed=%d static_write=skipped',
                $payload['mode'],
                $payload['targets'],
                $payload['would_generate'],
                $payload['source_status'],
                $payload['generated_at'],
                $payload['cache_jobs'] ?? 0,
                $payload['cache_writes'] ?? 0,
                $payload['failed_rows'] ?? 0,
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s / %s -> %s output=%s type=%s dynamic_rows=%d cache_rows=%d available=%s has_data=%s',
                    $index + 1,
                    $row['legacy_static_url'],
                    $row['legacy_url'],
                    $row['modern_url'],
                    $row['output_path'],
                    $row['report_type'],
                    $row['dynamic_rows'],
                    $row['cache_rows'],
                    $row['dynamic_report_available'] ? 'yes' : 'no',
                    $row['dynamic_report_has_data'] ? 'yes' : 'no',
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('reports:mayor:static unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
