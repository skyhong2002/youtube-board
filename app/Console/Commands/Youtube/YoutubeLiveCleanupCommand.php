<?php

namespace App\Console\Commands\Youtube;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\LiveCleanupPreview;
use Illuminate\Database\QueryException;

class YoutubeLiveCleanupCommand extends GuardedIngestionCommand
{
    protected $signature = 'youtube:live:cleanup {--limit=20 : Number of stale live rows to print} {--execute : Mark selected stale urt_video_live rows deleted} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Ingestion preview of legacy stale live cleanup; execute mode updates urt_video_live';

    public function handle(LiveCleanupPreview $preview): int
    {
        try {
            $payload = $preview->staleLivePreview(
                limit: (int) $this->option('limit'),
                execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'youtube:live:cleanup mode=%s candidates=%d would_mark_deleted=%d updated=%d grace_rows=%d too_soon=%s scheduled_before=%s generated_at=%s writes=%d',
                $payload['mode'],
                $payload['candidates'],
                $payload['would_mark_deleted'],
                $payload['updated'],
                $payload['grace_rows'],
                $payload['too_soon'],
                $payload['scheduled_before'],
                $payload['generated_at'],
                count($payload['writes']),
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s mtime=%s scheduledStartTime=%s max_current=%s',
                    $index + 1,
                    $row['video_id'],
                    $row['mtime'] ?? '-',
                    $row['scheduled_start_time'] ?? '-',
                    $row['max_current'] ?? '-',
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('youtube:live:cleanup unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
