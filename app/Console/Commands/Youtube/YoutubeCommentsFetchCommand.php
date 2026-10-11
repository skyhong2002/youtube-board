<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\CommentFetchIngestion;
use App\Services\Ingestion\CommentFetchPreview;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use Throwable;

class YoutubeCommentsFetchCommand extends Command
{
    protected $signature = 'youtube:comments:fetch {--videoId= : Optional queued video id to preview} {--limit=20 : Number of queued rows to print, capped lower for --execute} {--max-pages=1 : Maximum commentThreads pages per video in execute mode, capped at 3} {--max-reply-pages=20 : Shared comments.list reply page cap per video, max 100} {--execute : Call YouTube and drain selected local queue rows} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy comment queue drain, with explicit local-only --execute support';

    public function handle(CommentFetchPreview $preview, CommentFetchIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        try {
            $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

            if ($execute) {
                $limit = max(1, min(10, (int) $this->option('limit')));
                $maxPages = max(1, min(3, (int) $this->option('max-pages')));
                $maxReplyPages = max(1, min(100, (int) $this->option('max-reply-pages')));
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.comments.fetch',
                    effectiveCommand: sprintf(
                        'youtube:comments:fetch --execute --limit=%d --max-pages=%d --max-reply-pages=%d',
                        $limit,
                        $maxPages,
                        $maxReplyPages,
                    ),
                    callback: fn (): array => $ingestion->execute(
                        videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
                        limit: $limit,
                        maxPages: $maxPages,
                        maxReplyPages: $maxReplyPages,
                    ),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:comments:fetch execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:comments:fetch mode=local-execute selected_rows=%d claimed_rows=%d api_called_videos=%d api_attempted_videos=%d reply_pages_fetched=%d moved_to_done_rows=%d skipped_rows=%d failed_rows=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['selected_rows'],
                    $payload['claimed_rows'],
                    $payload['api_called_videos'],
                    $payload['api_attempted_videos'],
                    $payload['reply_pages_fetched'],
                    $payload['moved_to_done_rows'],
                    $payload['skipped_rows'],
                    $payload['failed_rows'],
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['secrets'],
                ));

                foreach ($payload['applied'] as $row) {
                    $this->line(sprintf(
                        'drained videoId=%s api=%s comments=%s authors=%s',
                        $row['videoId'],
                        $row['apiCalled'] ? 'yes' : 'no',
                        $row['commentsCount'] ?? 'n/a',
                        $row['authorsCount'] ?? 'n/a',
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf('skipped videoId=%s reason=%s', $row['videoId'], $row['reason']));
                }

                foreach ($payload['failed'] as $row) {
                    $this->line(sprintf(
                        'failed videoId=%s reason=%s error="%s" claim_released=%s',
                        $row['videoId'],
                        $row['reason'],
                        $row['error'],
                        $row['claim_released'] ? 'yes' : 'no',
                    ));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(
                videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
                limit: (int) $this->option('limit'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'youtube:comments:fetch mode=ingestion-preview queue_total=%d active_claim_rows=%d selected_rows=%d existing_comment_rows=%d recent_comment_cache_rows=%d would_insert_comment_rows=%d would_call_get_comment=%d would_call_comment_threads=%d would_move_to_done_rows=%d claim_expire_time=%s refresh_expire_time=%s generated_at=%s writes=0 api_call=skipped queue_move=skipped',
                $payload['queue_total'],
                $payload['active_claim_rows'],
                $payload['selected_rows'],
                $payload['existing_comment_rows'],
                $payload['recent_comment_cache_rows'],
                $payload['would_insert_comment_rows'],
                $payload['would_call_get_comment'],
                $payload['would_call_comment_threads'],
                $payload['would_move_to_done_rows'],
                $payload['claim_expire_time'],
                $payload['refresh_expire_time'],
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d pk=%s videoId=%s queued_at=%s comment_mtime=%s would_call_api=%s done=%s title="%s"',
                    $index + 1,
                    $row['pk'] !== null ? (string) $row['pk'] : '-',
                    $row['video_id'],
                    $row['queue_ctime'] ?? '-',
                    $row['comment_mtime'] ?? '-',
                    $row['would_call_comment_threads'] ? 'yes' : 'no',
                    $row['already_in_done'] ? 'yes' : 'no',
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('youtube:comments:fetch unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:comments:fetch execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
