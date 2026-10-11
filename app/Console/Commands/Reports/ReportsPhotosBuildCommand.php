<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\PhotoCacheBuilder;

class ReportsPhotosBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:photos:build {--tags= : Optional comma-separated subjects; defaults to capped local tags rows} {--limit=20 : Tag cap, max 100} {--refresh : Re-query subjects that already have a usable cached URL} {--execute : Fetch Wikipedia thumbnails and write urt_show_photo rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or explicitly build capped Wikipedia thumbnail cache rows from local tags; manual only';

    public function handle(PhotoCacheBuilder $builder): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $payload = $builder->build(
            onlyTags: collect(explode(',', (string) $this->option('tags')))
                ->map(fn (string $tag): string => trim($tag))
                ->filter()
                ->values()
                ->all(),
            limit: (int) $this->option('limit'),
            refresh: (bool) $this->option('refresh'),
            execute: $execute,
        );
        $failed = $payload['blocked_reason'] !== null || (int) $payload['failed_tags'] > 0;

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:photos:build mode=%s available=%s source=%s tags=%d/%d ignored=%d cached=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d no_image=%d failed=%d requests=%d writes=%d blocked_reason=%s generated_at=%s',
            $payload['mode'],
            $payload['available'] ? 'yes' : 'no',
            $payload['source'],
            $payload['tags_selected'],
            $payload['tag_limit'],
            $payload['tags_ignored'],
            $payload['cached'],
            $payload['would_insert'],
            $payload['would_update'],
            $payload['inserted'],
            $payload['updated'],
            $payload['unchanged'],
            $payload['skipped_no_image'],
            $payload['failed_tags'],
            $payload['external_requests'],
            $payload['writes'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d tag="%s" status=%s reason=%s image_url=%s',
                $index + 1,
                $row['tag'],
                $row['status'],
                $row['reason'] ?? '-',
                $row['image_url'] ?? '-',
            ));
        }

        return $failed ? 1 : 0;

    }
}
