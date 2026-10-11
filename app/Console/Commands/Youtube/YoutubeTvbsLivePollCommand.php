<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\TvbsLivePollingIngestion;
use App\Services\Ingestion\TvbsLivePollingPreview;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

class YoutubeTvbsLivePollCommand extends Command
{
    protected $signature = 'youtube:tvbs:live:poll {--videoId= : Optional TVBS live video id to preview} {--interval=11 : Legacy interval option retained; get_live_tvbs.php uses a hard-coded 40 seconds} {--stale-seconds=40 : Actual TVBS freshness cutoff in seconds} {--limit=20 : Number of live rows to print, capped at the legacy batch count} {--execute : Call YouTube and write selected TVBS live rows to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy TVBS live stream polling, with explicit local-only --execute support';

    public function handle(TvbsLivePollingPreview $preview, TvbsLivePollingIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;
        $interval = max(1, min(240, (int) $this->option('interval')));
        $staleSeconds = max(10, min(3600, (int) $this->option('stale-seconds')));
        $limit = max(1, min(50, (int) $this->option('limit')));
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($execute) {
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.tvbs.live.poll',
                    effectiveCommand: sprintf('youtube:tvbs:live:poll --execute --limit=%d', $limit),
                    callback: fn (): array => $ingestion->execute(videoId: $videoId, intervalMinutes: $interval, staleSeconds: $staleSeconds, limit: $limit),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:tvbs:live:poll execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:tvbs:live:poll mode=local-execute source=%s selected_rows=%d api_requested_videos=%d updated_videos=%d skipped_videos=%d write_targets="%s" external_calls="%s" secrets=%s',
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
                        'updated videoId=%s viewers=%s minute=%s ended=%s',
                        $row['videoId'],
                        $row['concurrentViewers'] !== null ? number_format($row['concurrentViewers']) : 'n/a',
                        $row['loggedMinute'] ?? 'n/a',
                        $row['actualEndTime'] ?? 'n/a',
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf('skipped videoId=%s reason=%s', $row['videoId'], $row['reason']));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(videoId: $videoId, intervalMinutes: $interval, staleSeconds: $staleSeconds, limit: $limit);

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'youtube:tvbs:live:poll mode=ingestion-preview source=%s active_live_rows=%d eligible_rows=%d selected_rows=%d existing_today_log_rows=%d missing_today_log_rows=%d effective_stale_seconds=%d too_soon=%s would_call_api=%s generated_at=%s writes=0 api_call=skipped tvbs_live_update=skipped tvbs_log_update=skipped',
                $payload['source'],
                $payload['active_live_rows'],
                $payload['eligible_rows'],
                $payload['selected_rows'],
                $payload['existing_today_log_rows'],
                $payload['missing_today_log_rows'],
                $payload['effective_stale_seconds'],
                $payload['too_soon'],
                $payload['would_call_api'] ? 'yes' : 'no',
                $payload['generated_at'],
            ));

            if ($payload['single_video_table_note'] !== null) {
                $this->line('compatibility_note='.$payload['single_video_table_note']);
            }

            if ($payload['skip_reason'] !== null) {
                $this->line('skip_reason='.$payload['skip_reason']);
            }

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d videoId=%s u_id=%s mtime=%s viewers=%s max=%s today_log=%s log_points=%d minute=%s title="%s"',
                    $index + 1,
                    $row['video_id'],
                    $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                    $row['mtime'] ?? '-',
                    $row['concurrent_viewers'] !== null ? number_format($row['concurrent_viewers']) : 'n/a',
                    $row['max_current'] !== null ? number_format($row['max_current']) : 'n/a',
                    $row['today_log_exists'] ? 'yes' : 'no',
                    $row['today_log_points'],
                    $row['would_write_minute'],
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('youtube:tvbs:live:poll unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('youtube:tvbs:live:poll execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:tvbs:live:poll execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
