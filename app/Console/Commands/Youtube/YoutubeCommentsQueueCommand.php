<?php

namespace App\Console\Commands\Youtube;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\CommentQueueIngestion;
use App\Services\Ingestion\CommentQueuePreview;
use Illuminate\Database\QueryException;
use Throwable;

class YoutubeCommentsQueueCommand extends GuardedIngestionCommand
{
    protected $signature = 'youtube:comments:queue {--tagid= : Legacy AND tag filter} {--or= : Legacy OR tag filter} {--not= : Legacy NOT tag filter} {--hours=24 : Recent publishedAt window} {--min=500 : Minimum viewCount and commentCount threshold} {--limit=20 : Number of candidate rows to print, capped lower for --execute} {--execute : Insert selected queue rows into local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy comment queue generation, with explicit local-only --execute support';

    public function handle(CommentQueuePreview $preview, CommentQueueIngestion $ingestion): int
    {
        try {
            $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

            if ($execute) {
                $payload = $ingestion->execute(
                    tagid: $this->option('tagid') ? (string) $this->option('tagid') : null,
                    or: $this->option('or') ? (string) $this->option('or') : null,
                    not: $this->option('not') ? (string) $this->option('not') : null,
                    min: (int) $this->option('min'),
                    hours: (int) $this->option('hours'),
                    limit: (int) $this->option('limit'),
                );

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:comments:queue mode=local-execute matching_channels=%d recent_video_rows=%d comment_threshold_rows=%d would_insert_queue_rows=%d inserted_queue_rows=%d skipped_rows=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['matching_channels'],
                    $payload['recent_video_rows'],
                    $payload['comment_threshold_rows'],
                    $payload['would_insert_queue_rows'],
                    $payload['inserted_queue_rows'],
                    $payload['skipped_rows'],
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['secrets'],
                ));

                foreach ($payload['inserted'] as $row) {
                    $this->line(sprintf('queued videoId=%s', $row['videoId']));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf('skipped videoId=%s reason=%s', $row['videoId'], $row['reason']));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(
                tagid: $this->option('tagid') ? (string) $this->option('tagid') : null,
                or: $this->option('or') ? (string) $this->option('or') : null,
                not: $this->option('not') ? (string) $this->option('not') : null,
                min: (int) $this->option('min'),
                hours: (int) $this->option('hours'),
                limit: (int) $this->option('limit'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'youtube:comments:queue mode=ingestion-preview matching_channels=%d recent_video_rows=%d comment_threshold_rows=%d already_queued_rows=%d already_done_rows=%d would_insert_queue_rows=%d hours=%d min=%d published_after=%s generated_at=%s writes=0 queue_insert=skipped',
                $payload['matching_channels'],
                $payload['recent_video_rows'],
                $payload['comment_threshold_rows'],
                $payload['already_queued_rows'],
                $payload['already_done_rows'],
                $payload['would_insert_queue_rows'],
                $payload['hours'],
                $payload['min'],
                $payload['published_after'],
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d videoId=%s u_id=%s publishedAt=%s views=%s comments=%s queued=%s done=%s title="%s"',
                    $index + 1,
                    $row['video_id'],
                    $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                    $row['published_at'] ?? '-',
                    $row['view_count'] !== null ? number_format($row['view_count']) : 'n/a',
                    $row['comment_count'] !== null ? number_format($row['comment_count']) : 'n/a',
                    $row['already_queued'] ? 'yes' : 'no',
                    $row['already_done'] ? 'yes' : 'no',
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('youtube:comments:queue unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:comments:queue execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
