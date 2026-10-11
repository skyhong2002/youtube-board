<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\VideoStatisticsIngestion;
use App\Services\Ingestion\VideoStatisticsPreview;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

class YoutubeVideosStatsCommand extends Command
{
    protected $signature = 'youtube:videos:stats {--videoId= : Optional video id to preview through the legacy single-video branch} {--today : Preview the legacy today/missing-viewCount branch from urt_video} {--batch-size=50 : Legacy batch size, capped at 50} {--limit= : Alias for --batch-size when running limited smoke checks} {--loops=1 : Number of batches to preview, capped at the legacy loop count} {--execute : Call YouTube and write selected video statistics to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy video statistics refresh queue, with explicit local-only --execute support';

    public function handle(VideoStatisticsPreview $preview, VideoStatisticsIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $batchSizeOption = $this->option('limit') !== null ? $this->option('limit') : $this->option('batch-size');
        $batchSize = max(1, min(50, (int) $batchSizeOption));
        $loops = max(1, min(31, (int) $this->option('loops')));
        $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($execute) {
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.videos.stats',
                    effectiveCommand: sprintf('youtube:videos:stats --execute --limit=%d --loops=%d', $batchSize, $loops),
                    callback: fn (): array => $ingestion->execute(
                        videoId: $videoId,
                        today: (bool) $this->option('today'),
                        batchSize: $batchSize,
                        loops: $loops,
                    ),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:videos:stats execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:videos:stats mode=local-execute source=%s selected_rows=%d api_requested_videos=%d updated_videos=%d skipped_videos=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['source'],
                    $payload['selected_rows'],
                    $payload['api_requested_videos'],
                    $payload['updated_videos'],
                    $payload['skipped_videos'],
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['secrets'],
                ));

                foreach ($payload['applied'] as $row) {
                    $this->line(sprintf(
                        'updated videoId=%s view=%s like=%s comments=%s',
                        $row['videoId'],
                        number_format($row['viewCount']),
                        number_format($row['likeCount']),
                        number_format($row['commentCount']),
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf('skipped videoId=%s reason=%s', $row['videoId'], $row['reason']));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(
                videoId: $videoId,
                today: (bool) $this->option('today'),
                batchSize: $batchSize,
                loops: $loops,
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'youtube:videos:stats mode=ingestion-preview source=%s schedule_total=%d due_schedule_rows=%d today_missing_rows=%d eligible_rows=%d selected_rows=%d first_batch_rows=%d batch_size=%d loops=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped stats_update=skipped',
                $payload['source'],
                $payload['schedule_total'],
                $payload['due_schedule_rows'],
                $payload['today_missing_rows'],
                $payload['eligible_rows'],
                $payload['selected_rows'],
                $payload['first_batch_rows'],
                $payload['batch_size'],
                $payload['loops'],
                $payload['would_call_api'] ? 'yes' : 'no',
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d %s published=%s view=%s stime=%s would_set_stime=%s title="%s"',
                    $index + 1,
                    $row['video_id'],
                    $row['published_at'] ?? '-',
                    $row['current_view_count'] !== null ? number_format($row['current_view_count']) : 'n/a',
                    $row['current_stime'] ?? '-',
                    $row['would_set_stime'],
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('youtube:videos:stats unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('youtube:videos:stats execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:videos:stats execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
