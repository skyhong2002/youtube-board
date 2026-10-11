<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\KeywordReportsPreview;
use Illuminate\Database\QueryException;
use RuntimeException;

class ReportsKeywordsBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:keywords:build {--limit=20 : Maximum keyword rows to preview or write per source batch} {--offset=0 : Remote source cursor offset, or auto for time-rotated scheduled batches} {--recent-days=7 : Window for keyword_all preview, matching legacy weekly freshness} {--hours=2 : 新文易數 tag.analysis.tw lookback hours for execute sync} {--execute : Fetch tag.analysis.tw keyword JSON and upsert local tags} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Build bounded keyword rankings from Laravel local data; optional legacy external sync requires an explicit environment gate';

    public function handle(KeywordReportsPreview $preview): int
    {
        $limit = max(1, min(100, (int) $this->option('limit')));
        $recentDays = max(1, min(30, (int) $this->option('recent-days')));

        try {
            $payload = $preview->preview(
                limit: $limit,
                recentDays: $recentDays,
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
                hours: (int) $this->option('hours'),
                offset: (string) $this->option('offset'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'reports:keywords:build mode=%s source_tags=%d source_complete=%s source_truncated=%s synced=%d failed=%d eligible_keywords=%d recent_keywords=%d recent_since=%s generated_at=%s writes=%d',
                $payload['mode'],
                $payload['source_tags'],
                $payload['source_complete'] ? 'yes' : 'no',
                $payload['source_truncated'] ? 'yes' : 'no',
                $payload['synced_rows'],
                $payload['failed_rows'],
                $payload['eligible_keywords'],
                $payload['recent_keywords'],
                $payload['recent_since'],
                $payload['generated_at'],
                count($payload['writes']),
            ));
            $this->line(sprintf(
                'sync candidates=%d attempted=%d offset=%d offset_mode=%s next_offset=%d wrapped=%s source_truncated=%s blocked_reason=%s',
                $payload['sync_candidates'],
                $payload['sync_attempted'],
                $payload['sync_offset'],
                $payload['sync_offset_mode'],
                $payload['sync_next_offset'],
                $payload['sync_batch_wrapped'] ? 'yes' : 'no',
                $payload['sync_source_truncated'] ? 'yes' : 'no',
                $payload['blocked_reason'] ?? '-',
            ));
            $this->line(sprintf(
                'excluded no_tag=%d single_char=%d numeric=%d short_ascii=%d targets=%s',
                $payload['excluded']['no_tag'],
                $payload['excluded']['single_char'],
                $payload['excluded']['numeric'],
                $payload['excluded']['short_ascii'],
                implode(',', $payload['filesystem_targets']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s weight=%s max_count=%d hours_count=%d recent=%s mtime=%s',
                    $index + 1,
                    $row['tag'],
                    $row['legacy_weight'],
                    $row['max_count'],
                    $row['hours_count'],
                    $row['included_in_keyword_all'] ? 'yes' : 'no',
                    $row['mtime'],
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('reports:keywords:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('reports:keywords:build execute unavailable: failure=external_sync_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
