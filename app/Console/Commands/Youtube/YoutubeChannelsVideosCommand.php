<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\ChannelVideosDiscoveryIngestion;
use App\Services\Ingestion\ChannelVideosDiscoveryPreview;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\IngestionCommandLock;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

class YoutubeChannelsVideosCommand extends Command
{
    protected $signature = 'youtube:channels:videos {--id= : Optional legacy channel u_id to preview} {--channel= : Alias for --id when running a local execute smoke} {--live= : Legacy live filter, 1 uses tag 52 and 2 uses tag 89} {--rescan : Preview legacy large-channel rescan branch} {--hours=700 : Legacy hours option, retained for compatibility} {--force=1 : Legacy duplicate-process threshold, shown only} {--limit=20 : Number of channels to print, capped at legacy loop count} {--max-results=5 : Execute-mode playlist item cap, max 50} {--execute : Call YouTube and write selected playlist items to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy channel playlist discovery, with explicit local-only --execute support';

    public function handle(ChannelVideosDiscoveryPreview $preview, ChannelVideosDiscoveryIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard, IngestionCommandLock $commandLock): int
    {
        $channelOption = $this->option('channel') ?? $this->option('id');
        $uId = $channelOption !== null ? max(1, (int) $channelOption) : null;
        $live = $this->option('live') !== null ? (int) $this->option('live') : null;
        $hours = max(1, min(24 * 365, (int) $this->option('hours')));
        $force = max(1, min(20, (int) $this->option('force')));
        $limit = max(1, min(81, (int) $this->option('limit')));
        $maxResults = max(1, min(50, (int) $this->option('max-results')));
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($execute) {
                $executeLimit = min($limit, 10);
                $jobKey = $commandLock->jobKeyForCommand('youtube:channels:videos', ['live' => $live]);

                if ($jobKey === null) {
                    $blocked = [
                        'mode' => 'execute',
                        'available' => false,
                        'blocked_reason' => 'command_lock_mapping_unavailable',
                        'writes' => 0,
                        'job_key' => null,
                        'lock' => null,
                        'secrets' => 'not_printed',
                        'exit_code' => 1,
                    ];
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:channels:videos execute unavailable: command_lock_mapping_unavailable secrets=not_printed');

                    return 1;
                }

                $quotaRun = $quotaGuard->run(
                    jobKey: $jobKey,
                    effectiveCommand: sprintf('youtube:channels:videos --execute --limit=%d --max-results=%d', $executeLimit, $maxResults),
                    callback: fn (): array => $ingestion->execute(
                        uId: $uId,
                        live: $live,
                        rescan: (bool) $this->option('rescan'),
                        hours: $hours,
                        force: $force,
                        limit: $executeLimit,
                        maxResults: $maxResults,
                    ),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:channels:videos execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:channels:videos mode=local-execute selected_rows=%d api_requested_channels=%d max_results=%d updated_channels=%d skipped_channels=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['selected_rows'],
                    $payload['api_requested_channels'],
                    $payload['api_max_results_per_channel'],
                    $payload['updated_channels'],
                    $payload['skipped_channels'],
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['secrets'],
                ));

                foreach ($payload['applied'] as $row) {
                    $this->line(sprintf(
                        'updated u_id=%d uploads=%s api_items=%d videos=%d schedules=%d live=%d final_vtime=%s',
                        $row['u_id'],
                        $row['uploads'],
                        $row['api_items'],
                        $row['video_upserts'],
                        $row['schedule_upserts'],
                        $row['live_upserts'],
                        $row['final_vtime'],
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf(
                        'skipped u_id=%d uploads=%s reason=%s',
                        $row['u_id'],
                        $row['uploads'],
                        $row['reason'],
                    ));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(
                uId: $uId,
                live: $live,
                rescan: (bool) $this->option('rescan'),
                hours: $hours,
                force: $force,
                limit: $limit,
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'youtube:channels:videos mode=ingestion-preview source=%s active_channels=%d due_channels=%d tagged_channels=%s eligible_rows=%d selected_rows=%d missing_uploads_playlist=%d live=%s limit=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped video_insert=skipped schedule_insert=skipped live_insert=skipped channel_vtime_update=skipped',
                $payload['source'],
                $payload['active_channels'],
                $payload['due_channels'],
                $payload['tagged_channels'] !== null ? (string) $payload['tagged_channels'] : 'n/a',
                $payload['eligible_rows'],
                $payload['selected_rows'],
                $payload['missing_uploads_playlist'],
                $payload['live'] !== null ? (string) $payload['live'] : 'none',
                $payload['limit'],
                $payload['would_call_api'] ? 'yes' : 'no',
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d u_id=%d uploads=%s vtime=%s local_week=%d estimated_next_vtime=%s title="%s"',
                    $index + 1,
                    $row['u_id'],
                    $row['uploads'] !== '' ? $row['uploads'] : '-',
                    $row['current_vtime'] ?? '-',
                    $row['local_recent_week_count'],
                    $row['estimated_next_vtime_from_local_week_count'],
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('youtube:channels:videos unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('youtube:channels:videos execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:channels:videos execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
