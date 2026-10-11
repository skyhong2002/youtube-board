<?php

namespace App\Console\Commands\Reports;

use App\Services\Ingestion\LiveStaticHtmlPreview;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;

class ReportsLiveStaticCommand extends Command
{
    protected $signature = 'reports:live:static {--limit=20 : Number of static live targets to print} {--json : Emit JSON instead of text}';

    protected $description = 'Ingestion preview of legacy static live HTML generation mapped to dynamic Laravel routes';

    public function handle(LiveStaticHtmlPreview $preview): int
    {
        try {
            $payload = $preview->preview(limit: (int) $this->option('limit'));

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'reports:live:static mode=ingestion-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
                $payload['targets'],
                $payload['would_generate'],
                $payload['source_status'],
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s -> %s output=%s dynamic_rows=%d available=%s',
                    $index + 1,
                    $row['legacy_url'],
                    $row['modern_url'],
                    $row['output_path'],
                    $row['dynamic_rows'],
                    $row['dynamic_report_available'] ? 'yes' : 'no',
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('reports:live:static unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
