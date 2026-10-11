<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\GroupReportsPreview;
use Illuminate\Database\QueryException;
use RuntimeException;

class ReportsGroupsBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:groups:build {--group= : Preview one tag_group group_name} {--hours=22 : 新文易數 tag.analysis.tw lookback parameter} {--limit=20 : Maximum group rows to preview or write per source batch} {--offset=0 : Remote source cursor offset, or auto for time-rotated scheduled batches} {--execute : Fetch tag.analysis.tw group JSON and upsert local tag_group} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Report Laravel local tag_group state; optional legacy external sync requires an explicit environment gate';

    public function handle(GroupReportsPreview $preview): int
    {
        try {
            $payload = $preview->preview(
                groupName: $this->option('group') ? (string) $this->option('group') : null,
                hours: (int) $this->option('hours'),
                limit: (int) $this->option('limit'),
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
                offset: (string) $this->option('offset'),
            );

            if ($this->option('json')) {
                $this->line(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'reports:groups:build mode=%s groups=%d tag_rows=%d synced=%d failed=%d active_rows=%d deleted_rows=%d latest_time=%s hours=%d generated_at=%s writes=%d',
                $payload['mode'],
                $payload['group_count'],
                $payload['tag_rows'],
                $payload['synced_rows'],
                $payload['failed_rows'],
                $payload['active_rows'],
                $payload['deleted_rows'],
                $payload['latest_time'] ?? '-',
                $payload['hours'],
                $payload['generated_at'],
                count($payload['writes']),
            ));
            $this->line(sprintf(
                'sync candidates=%d attempted=%d offset=%d offset_mode=%s next_offset=%d wrapped=%s source_truncated=%s',
                $payload['sync_candidates'],
                $payload['sync_attempted'],
                $payload['sync_offset'],
                $payload['sync_offset_mode'],
                $payload['sync_next_offset'],
                $payload['sync_batch_wrapped'] ? 'yes' : 'no',
                $payload['sync_source_truncated'] ? 'yes' : 'no',
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s active=%d deleted=%d total=%d latest_time=%s',
                    $index + 1,
                    $row['group_name'],
                    $row['active_rows'],
                    $row['deleted_rows'],
                    $row['tag_rows'],
                    $row['latest_time'] ?? '-',
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('reports:groups:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('reports:groups:build execute unavailable: failure=external_sync_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
