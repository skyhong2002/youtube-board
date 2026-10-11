<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\KeywordCloudCacheBuilder;

class ReportsKeywordCloudBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:keyword-cloud:build {--keywords= : Required comma-separated keyword cloud subjects} {--tagid= : Comma-separated required channel tag ids} {--or= : Comma-separated OR channel tag ids} {--not= : Comma-separated excluded channel tag ids} {--days=3,7,30 : Comma-separated periods, max 10 values from 1 to 365} {--subject-limit=20 : Subject cap, max 100} {--keyword-limit=5000 : Local keyword dictionary cap, max 5000} {--channel-limit=1000 : Matching channel source cap, max 5000} {--video-limit=10000 : Raw video cap per subject, max 10000} {--execute : Write urt_show_tag_cloud_tag rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or explicitly rebuild capped keyword cloud cache rows from local videos and tags';

    public function handle(KeywordCloudCacheBuilder $builder): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $list = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
            ->map(fn (string $value): string => trim($value))
            ->filter(fn (string $value): bool => $value !== '')
            ->values()
            ->all();
        $ids = fn (string $option): array => collect($list($option))
            ->map(fn (string $value): int => (int) $value)
            ->filter(fn (int $value): bool => $value > 0)
            ->values()
            ->all();
        $payload = $builder->build(
            subjects: $list('keywords'),
            daysList: collect($list('days'))->map(fn (string $days): int => (int) $days)->all(),
            tagIds: $ids('tagid'),
            orTagIds: $ids('or'),
            notTagIds: $ids('not'),
            subjectLimit: (int) $this->option('subject-limit'),
            keywordLimit: (int) $this->option('keyword-limit'),
            channelLimit: (int) $this->option('channel-limit'),
            videoLimit: (int) $this->option('video-limit'),
            execute: $execute,
        );
        $failed = $payload['blocked_reason'] !== null || (int) $payload['failed_cache_rows'] > 0;

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:keyword-cloud:build mode=%s available=%s subjects=%d/%d days=%s channels=%d/%d keywords=%d/%d videos=%d/%d-per-subject truncated=%s rows=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d failed=%d blocked_reason=%s generated_at=%s',
            $payload['mode'],
            $payload['available'] ? 'yes' : 'no',
            $payload['subjects_selected'],
            $payload['subject_limit'],
            implode(',', $payload['days_list']),
            $payload['channels_matched'],
            $payload['channel_limit'],
            $payload['keywords_selected'],
            $payload['keyword_limit'],
            $payload['videos_scanned'],
            $payload['video_limit_per_subject'],
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
                '#%d tag="%s" days=%d status=%s reason=%s channels=%d videos=%d tags=%d/%d',
                $index + 1,
                $row['tag'],
                $row['days'],
                $row['status'],
                $row['reason'] ?? '-',
                $row['count_channels'],
                $row['count_videos'],
                $row['count_tags'],
                $row['tags_count'],
            ));
        }

        return $failed ? 1 : 0;

    }
}
