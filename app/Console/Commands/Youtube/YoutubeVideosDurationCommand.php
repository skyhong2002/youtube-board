<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\VideoDurationsIngestion;
use App\Services\Ingestion\VideoDurationsPreview;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

class YoutubeVideosDurationCommand extends Command
{
    protected $signature = 'youtube:videos:duration {--videoId= : Optional queued video id to preview} {--batch-size=50 : Legacy batch size, capped at 50} {--limit= : Alias for --batch-size when running limited smoke checks} {--loops=1 : Number of batches to preview} {--enqueue-missing : With --execute, create duration queue rows from existing urt_video when missing} {--execute : Call YouTube and write selected video durations to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy video duration refresh queue, with explicit local-only --execute support';

    public function handle(VideoDurationsPreview $preview, VideoDurationsIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $batchSizeOption = $this->option('limit') !== null ? $this->option('limit') : $this->option('batch-size');
        $batchSize = max(1, min(50, (int) $batchSizeOption));
        $loops = max(1, min(20, (int) $this->option('loops')));
        $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($execute) {
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.videos.duration',
                    effectiveCommand: sprintf('youtube:videos:duration --execute --limit=%d --loops=%d', $batchSize, $loops),
                    callback: fn (): array => $ingestion->execute(
                        videoId: $videoId,
                        batchSize: $batchSize,
                        loops: $loops,
                        enqueueMissing: (bool) $this->option('enqueue-missing'),
                    ),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:videos:duration execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:videos:duration mode=local-execute selected_rows=%d queued_videos=%d api_requested_videos=%d updated_videos=%d skipped_videos=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['selected_rows'],
                    $payload['queued_videos'],
                    $payload['api_requested_videos'],
                    $payload['updated_videos'],
                    $payload['skipped_videos'],
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['secrets'],
                ));

                foreach ($payload['applied'] as $row) {
                    $this->line(sprintf(
                        'updated videoId=%s duration=%s seconds=%d caption=%s',
                        $row['videoId'],
                        $row['duration'] ?? 'n/a',
                        $row['durationSeconds'],
                        $row['caption'] ?? 'n/a',
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf('skipped videoId=%s reason=%s', $row['videoId'], $row['reason']));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(
                videoId: $videoId,
                batchSize: $batchSize,
                loops: $loops,
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'youtube:videos:duration mode=ingestion-preview queue_total=%d ready_queue_rows=%d selected_rows=%d completed_rows=%d reserved_rows=%d failed_or_missing_rows=%d unqueued_missing_videos=%s batch_size=%d loops=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped queue_update=skipped',
                $payload['queue_total'],
                $payload['ready_queue_rows'],
                $payload['selected_rows'],
                $payload['completed_rows'],
                $payload['reserved_rows'],
                $payload['failed_or_missing_rows'],
                $payload['unqueued_missing_videos'] !== null ? (string) $payload['unqueued_missing_videos'] : 'n/a',
                $payload['batch_size'],
                $payload['loops'],
                $payload['would_call_api'] ? 'yes' : 'no',
                $payload['generated_at'],
            ));

            if ($payload['would_reserve_until'] !== null) {
                $this->line('would_reserve_until='.$payload['would_reserve_until']);
            }

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d pk_video=%d video=%s u_id=%s published=%s reserve_until=%s title="%s"',
                    $index + 1,
                    $row['pk_video'],
                    $row['video_id'],
                    $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                    $row['published_at'] ?? '-',
                    $row['would_set_stime'],
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('youtube:videos:duration unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('youtube:videos:duration execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:videos:duration execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
