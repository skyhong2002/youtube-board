<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\ChannelCloudCacheBuilder;
use Carbon\CarbonImmutable;

class ReportsChannelCloudBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:channel-cloud:build {--u_id= : Comma-separated channel u_id values, max 500} {--channel= : Alias for --u_id} {--days=1,3,7,30,90 : Comma-separated period list, max 10} {--limit=50 : Channel target cap when --u_id is omitted, max 500} {--offset=0 : Recent-channel target cursor, or auto for time-rotated scheduled batches} {--recent-days=14 : Recent video window when --u_id is omitted} {--video-limit=10000 : Raw video scan cap per channel/period, max 100000} {--keyword-limit=5000 : Local keyword source scan cap, max 20000} {--keywords= : Optional comma-separated keyword subset, max 500} {--execute : Write urt_show_cloud rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Build urt_show_cloud channel word-cloud rows from local videos and tags; dry-run by default';

    public function handle(ChannelCloudCacheBuilder $builder): int
    {
        $idsOption = collect([$this->option('u_id'), $this->option('channel')])
            ->map(fn (mixed $value): string => trim((string) $value))
            ->first(fn (string $value): bool => $value !== '', '');
        $uIds = collect(explode(',', $idsOption))
            ->map(fn (string $id): int => (int) trim($id))
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();
        $daysList = collect(explode(',', (string) $this->option('days')))
            ->map(fn (string $days): int => max(1, min(365, (int) trim($days))))
            ->filter(fn (int $days): bool => $days > 0)
            ->unique()
            ->values()
            ->all();
        $keywords = collect(explode(',', (string) $this->option('keywords')))
            ->map(fn (string $keyword): string => trim($keyword))
            ->filter(fn (string $keyword): bool => $keyword !== '')
            ->values()
            ->all();

        $payload = $builder->buildMany(
            uIds: $uIds,
            daysList: $daysList,
            limit: (int) $this->option('limit'),
            recentDays: (int) $this->option('recent-days'),
            keywordLimit: (int) $this->option('keyword-limit'),
            onlyKeywords: $keywords,
            videoLimit: (int) $this->option('video-limit'),
            offset: (string) $this->option('offset'),
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            now: CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'))),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:channel-cloud:build mode=%s status=%s channels=%d/%d offset=%d(%s) next_offset=%d wrapped=%s days=%s rows=%d writes=%d source_complete=%s source_truncated=%s selection_truncated=%s caps=channels:%d,periods:%d,videos:%d,keywords:%d blocked_reason=%s',
            $payload['mode'],
            $payload['status'],
            $payload['channels_selected'],
            $payload['channel_selection_candidates'],
            $payload['channel_selection_offset'],
            $payload['channel_selection_offset_mode'],
            $payload['channel_selection_next_offset'],
            $payload['channel_selection_wrapped'] ? 'yes' : 'no',
            implode(',', $payload['days_list']),
            count($payload['rows']),
            $payload['writes'],
            $payload['source_complete'] ? 'yes' : 'no',
            $payload['source_truncated'] ? 'yes' : 'no',
            $payload['channel_selection_truncated'] ? 'yes' : 'no',
            $payload['caps']['explicit_channels'],
            $payload['caps']['periods'],
            $payload['caps']['video_scan_per_channel_period'],
            $payload['caps']['keyword_scan'],
            $payload['blocked_reason'] ?? 'none',
        ));

        foreach ($payload['rows'] as $row) {
            $this->line(sprintf(
                'u_id=%d days=%d status=%s videos=%d keywords=%d tags=%d views=%d writes=%d truncated=%s blocked_reason=%s',
                $row['u_id'],
                $row['days'],
                $row['status'],
                $row['count_videos'],
                $row['keywords_count'],
                $row['count_tags'],
                $row['total_views'],
                $row['writes'],
                $row['source_truncated'] ? 'yes' : 'no',
                $row['blocked_reason'] ?? 'none',
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);

    }
}
