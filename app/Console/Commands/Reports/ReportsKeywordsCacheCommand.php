<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\TagsAllCacheBuilder;
use Illuminate\Database\QueryException;

class ReportsKeywordsCacheCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:keywords:cache {--execute : Write the rebuilt tags_all cache to local DB} {--dry-run : Force preview mode; this is the default} {--days=31 : Calendar-day window to aggregate, matching legacy tags_all.php} {--recent-days=7 : Recent window used for video/views metrics; legacy includes today plus this many previous days} {--keyword-limit=1000 : Ranked keyword source scan cap, max 10000} {--video-limit=50000 : Raw video source scan cap, max 200000} {--json : Emit JSON instead of text}';

    protected $description = 'Rebuild legacy urt_show_data.tags_all keyword metric cache from local videos; dry-run by default';

    public function handle(TagsAllCacheBuilder $builder): int
    {
        $days = max(1, min(90, (int) $this->option('days')));
        $recentDays = max(1, min($days, (int) $this->option('recent-days')));
        $keywordLimit = max(1, min(10000, (int) $this->option('keyword-limit')));
        $videoLimit = max(1, min(200000, (int) $this->option('video-limit')));
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            $payload = $builder->build(
                days: $days,
                recentDays: $recentDays,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                execute: $execute,
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'reports:keywords:cache mode=%s status=%s days=%d recent_days=%d keyword_limit=%d video_limit=%d videos_scanned=%d tags_with_metrics=%d writes=%d source_complete=%s truncated=%s blocked_reason=%s',
                $payload['mode'],
                $payload['status'],
                $days,
                $recentDays,
                $keywordLimit,
                $videoLimit,
                $payload['videos_scanned'],
                $payload['tags_with_metrics'],
                $payload['writes'],
                $payload['source_complete'] ? 'yes' : 'no',
                $payload['source_truncated'] ? 'yes' : 'no',
                $payload['blocked_reason'] ?? 'none',
            ));
            $this->line('write_targets='.implode('; ', $payload['write_targets']));
            $this->line(sprintf(
                'source=local_db legacy=api/tags_all.php force=1 external_api=none categories=%s generated_at=%s',
                implode(',', $payload['category_tags']),
                $payload['generated_at'],
            ));

            foreach ($payload['sample'] as $tag => $metrics) {
                $this->line(sprintf(
                    '%s video=%d views=%d video_all=%d views_all=%d',
                    $tag,
                    $metrics['video'],
                    $metrics['views'],
                    $metrics['video_all'],
                    $metrics['views_all'],
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('reports:keywords:cache unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
