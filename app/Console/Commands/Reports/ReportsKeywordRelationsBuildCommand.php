<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\KeywordRelationCacheBuilder;

class ReportsKeywordRelationsBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:keyword-relations:build {--from= : First cache date YYYY-MM-DD; preview defaults to yesterday} {--to= : Last cache date YYYY-MM-DD; preview defaults to --from} {--keywords= : Optional comma-separated cache subjects} {--keyword-limit=100 : Keyword dictionary and subject cap, max 5000} {--video-limit=1000 : Raw video scan cap, max 10000} {--execute : Write urt_show_video_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or explicitly rebuild capped keyword/date relation cache rows from local videos and tags';

    public function handle(KeywordRelationCacheBuilder $builder): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $from = trim((string) $this->option('from'));
        $to = trim((string) $this->option('to'));

        if ($execute && ($from === '' || $to === '')) {
            $this->error('reports:keyword-relations:build unavailable: --execute requires explicit --from and --to dates');

            return 1;
        }

        $payload = $builder->build(
            from: $from !== '' ? $from : null,
            to: $to !== '' ? $to : null,
            onlyKeywords: collect(explode(',', (string) $this->option('keywords')))
                ->map(fn (string $keyword): string => trim($keyword))
                ->filter()
                ->values()
                ->all(),
            keywordLimit: (int) $this->option('keyword-limit'),
            videoLimit: (int) $this->option('video-limit'),
            execute: $execute,
        );
        $failed = (int) $payload['failed_cache_rows'] > 0
            || $payload['blocked_reason'] !== null;

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:keyword-relations:build mode=%s available=%s from=%s to=%s keywords=%d/%d videos=%d/%d truncated=%s rows=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d failed=%d blocked_reason=%s generated_at=%s',
            $payload['mode'],
            $payload['available'] ? 'yes' : 'no',
            $payload['from'],
            $payload['to'],
            $payload['keywords_selected'],
            $payload['keyword_limit'],
            $payload['videos_scanned'],
            $payload['video_limit'],
            ($payload['source_truncated'] ?? false) ? 'yes' : 'no',
            $payload['rows_planned'],
            $payload['would_insert'],
            $payload['would_update'],
            $payload['inserted'],
            $payload['updated'],
            $payload['unchanged'],
            $payload['failed_cache_rows'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d tag="%s" date=%s status=%s reason=%s channels=%d videos=%d tags=%d',
                $index + 1,
                $row['tag'],
                $row['date'],
                $row['status'],
                $row['reason'] ?? '-',
                $row['count_channels'],
                $row['count_videos'],
                $row['count_tags'],
            ));
        }

        return $failed ? 1 : 0;

    }
}
