<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\TagCloudCacheBuilder;
use Carbon\CarbonImmutable;

class ReportsTagCloudBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:tag-cloud:build {--tagid= : Comma-separated required channel tag ids, max 50} {--or= : Comma-separated OR channel tag ids, max 50} {--not= : Comma-separated excluded channel tag ids, max 50} {--days=1,3,7,30,90 : Comma-separated period list, max 10} {--channel-limit=1000 : Matched source channel scan cap, max 5000} {--video-limit=50000 : Raw video scan cap per period, max 100000} {--keyword-limit=5000 : Local keyword source scan cap, max 20000} {--keywords= : Optional comma-separated keyword subset, max 500} {--execute : Write urt_show_tag_cloud rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Build urt_show_tag_cloud rows from local videos and tags; dry-run by default';

    public function handle(TagCloudCacheBuilder $builder): int
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $tagIds = collect(explode(',', (string) $this->option('tagid')))
            ->map(fn (string $id): int => (int) trim($id))
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();

        if ($tagIds === []) {
            $this->error('reports:tag-cloud:build requires --tagid');

            return 1;
        }

        $ids = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
            ->map(fn (string $id): int => (int) trim($id))
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();
        $keywords = collect(explode(',', (string) $this->option('keywords')))
            ->map(fn (string $keyword): string => trim($keyword))
            ->filter(fn (string $keyword): bool => $keyword !== '')
            ->values()
            ->all();
        $daysList = collect(explode(',', (string) $this->option('days')))
            ->map(fn (string $d): int => max(1, min(365, (int) trim($d))))
            ->unique()
            ->values()
            ->all();

        $payload = $builder->buildMany(
            tagIds: $tagIds,
            daysList: $daysList,
            orTagIds: $ids('or'),
            notTagIds: $ids('not'),
            keywordLimit: (int) $this->option('keyword-limit'),
            onlyKeywords: $keywords,
            channelLimit: (int) $this->option('channel-limit'),
            videoLimit: (int) $this->option('video-limit'),
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            now: $now,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) $payload['exit_code'];
        }

        $this->line(sprintf(
            'reports:tag-cloud:build mode=%s status=%s tagid=%s days=%s rows=%d writes=%d source_complete=%s truncated=%s caps=periods:%d,channels:%d,videos:%d,keywords:%d blocked_reason=%s',
            $payload['mode'],
            $payload['status'],
            implode(',', $tagIds),
            implode(',', $daysList),
            count($payload['rows']),
            $payload['writes'],
            $payload['source_complete'] ? 'yes' : 'no',
            $payload['source_truncated'] ? 'yes' : 'no',
            $payload['caps']['periods'],
            $payload['caps']['channel_scan'],
            $payload['caps']['video_scan_per_period'],
            $payload['caps']['keyword_scan'],
            $payload['blocked_reason'] ?? 'none',
        ));

        foreach ($payload['rows'] as $row) {
            $this->line(sprintf(
                'days=%d status=%s channels=%d videos=%d tags=%d views=%d writes=%d truncated=%s blocked_reason=%s',
                $row['days'],
                $row['status'],
                $row['channels_matched'],
                $row['videos_scanned'],
                $row['tags_count'],
                $row['total_views'],
                $row['writes'],
                $row['source_truncated'] ? 'yes' : 'no',
                $row['blocked_reason'] ?? 'none',
            ));
        }

        return (int) $payload['exit_code'];

    }
}
