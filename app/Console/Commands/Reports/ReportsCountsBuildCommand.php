<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\ChannelCountsPreview;
use Illuminate\Database\QueryException;

class ReportsCountsBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:counts:build {--id= : Optional u_id to preview, matching legacy id=... behavior} {--limit=20 : Number of changed preview rows to print/update} {--execute : Update selected urt_count delta columns} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute legacy channel weekly/monthly count delta updates';

    public function handle(ChannelCountsPreview $preview): int
    {
        $uId = $this->option('id') !== null ? max(1, (int) $this->option('id')) : null;
        $limit = max(1, min(100, (int) $this->option('limit')));

        try {
            $payload = $preview->preview(
                uId: $uId,
                limit: $limit,
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
            }

            $this->line(sprintf(
                'reports:counts:build mode=%s candidates=%d with_logs=%d missing_logs=%d would_update=%d updated=%d unchanged=%d date=%s generated_at=%s writes=%d',
                $payload['mode'],
                $payload['candidates'],
                $payload['with_logs'],
                $payload['missing_logs'],
                $payload['would_update'],
                $payload['updated'],
                $payload['unchanged'],
                $payload['date'],
                $payload['generated_at'],
                count($payload['writes']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $computed = $row['computed'];
                $this->line(sprintf(
                    '#%d u_id=%d view_week=%d sub_week=%d video_week=%d view_month=%d sub_month=%d video_month=%d',
                    $index + 1,
                    $row['u_id'],
                    $computed['view_week'],
                    $computed['sub_week'] ?? 0,
                    $computed['video_week'],
                    $computed['view_month'],
                    $computed['sub_month'] ?? 0,
                    $computed['video_month'],
                ));
            }

            return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
        } catch (QueryException $exception) {
            $this->error('reports:counts:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
