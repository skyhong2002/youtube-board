<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\ChannelPredictionIngestion;

class ReportsChannelPredictionsBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:channel-predictions:build {--u_id= : Optional channel u_id} {--limit=20 : Number of channels to process, capped at 100} {--offset=0 : Channel offset for bounded manual pagination} {--execute : Update selected urt_count prediction columns} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview legacy channel prediction writeback; --execute idempotently updates capped local urt_count rows';

    public function handle(ChannelPredictionIngestion $ingestion): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $uId = $this->option('u_id');
        $payload = $ingestion->run(
            uId: $uId !== null ? (int) $uId : null,
            limit: (int) $this->option('limit'),
            execute: $execute,
            offset: (int) $this->option('offset'),
        );
        $failed = (int) $payload['failed'] > 0
            || ($execute && (! (bool) $payload['available'] || ($payload['blocked_reason'] ?? null) !== null));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:channel-predictions:build mode=%s available=%s candidates=%d/%d would_update=%d updated=%d unchanged=%d skipped=%d failed=%d blocked_reason=%s generated_at=%s',
            $payload['mode'],
            $payload['available'] ? 'yes' : 'no',
            $payload['candidates'],
            $payload['candidate_total'],
            $payload['would_update'],
            $payload['updated'],
            $payload['unchanged'],
            $payload['skipped'],
            $payload['failed'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d u_id=%d status=%s reason=%s logs=%d invalid_logs=%d valid_points=%d week=%s month=%s',
                $index + 1,
                $row['u_id'],
                $row['status'],
                $row['reason'] ?? '-',
                $row['log_rows'],
                $row['invalid_log_rows'],
                $row['valid_points'],
                is_array($row['computed']) ? (string) $row['computed']['views_pred_week'] : '-',
                is_array($row['computed']) ? (string) $row['computed']['views_pred_month'] : '-',
            ));
        }

        return $failed ? 1 : 0;

    }
}
