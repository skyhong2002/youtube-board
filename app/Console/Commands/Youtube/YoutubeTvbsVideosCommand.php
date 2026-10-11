<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\TvbsChannelVideosDiscoveryIngestion;
use App\Services\Ingestion\TvbsChannelVideosDiscoveryPreview;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

class YoutubeTvbsVideosCommand extends Command
{
    protected $signature = 'youtube:tvbs:videos {--tag=29 : Legacy TVBS channel tag id in urt_count.tags} {--id= : Optional u_id to fetch} {--channel= : Optional YouTube channel id to fetch} {--hours=700 : Legacy hours option, retained for compatibility} {--force=1 : Legacy duplicate-process threshold, shown only} {--limit=20 : Number of channels to print, capped lower for --execute} {--max-results=5 : Maximum playlist items per channel in execute mode, capped at 50} {--offset=0 : Wrapped channel offset, or auto for five-minute scheduler rotation} {--execute : Call YouTube and write selected TVBS playlist items to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy TVBS channel playlist discovery, with explicit local-only --execute support';

    public function handle(TvbsChannelVideosDiscoveryPreview $preview, TvbsChannelVideosDiscoveryIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $tagId = max(1, (int) $this->option('tag'));
        $uId = $this->option('id') !== null ? max(1, (int) $this->option('id')) : null;
        $channel = $this->option('channel') ? (string) $this->option('channel') : null;
        $hours = max(1, min(24 * 365, (int) $this->option('hours')));
        $force = max(1, min(20, (int) $this->option('force')));
        $limit = max(1, min(80, (int) $this->option('limit')));
        $maxResults = max(1, min(50, (int) $this->option('max-results')));
        $offsetOption = strtolower(trim((string) $this->option('offset')));
        $offset = $offsetOption === 'auto' ? 'auto' : max(0, (int) $offsetOption);
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($execute) {
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.tvbs.videos',
                    effectiveCommand: sprintf('youtube:tvbs:videos --execute --limit=%d --max-results=%d --offset=%s', $limit, $maxResults, $offset),
                    callback: fn (): array => $ingestion->execute(
                        tagId: $tagId,
                        uId: $uId,
                        channel: $channel,
                        hours: $hours,
                        force: $force,
                        limit: $limit,
                        maxResults: $maxResults,
                        offset: $offset,
                    ),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:tvbs:videos execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:tvbs:videos mode=local-execute source=%s selected_rows=%d api_requested_channels=%d api_max_results_per_channel=%d updated_channels=%d skipped_channels=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['source'],
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
                        'updated u_id=%d uploads=%s api_items=%d videos=%d schedules=%d tvbs_live=%d',
                        $row['u_id'],
                        $row['uploads'],
                        $row['api_items'],
                        $row['video_upserts'],
                        $row['schedule_upserts'],
                        $row['tvbs_live_upserts'],
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf('skipped u_id=%d reason=%s', $row['u_id'], $row['reason']));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(
                tagId: $tagId,
                uId: $uId,
                channel: $channel,
                hours: $hours,
                force: $force,
                limit: $limit,
                offset: $offset,
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return 0;
            }

            $this->line(sprintf(
                'youtube:tvbs:videos mode=ingestion-preview source=%s tag=%d active_channels=%d tagged_channels=%d eligible_rows=%d selected_rows=%d offset=%d offset_mode=%s next_offset=%d missing_uploads_playlist=%d legacy_loop_limit=%d legacy_sleep_seconds=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped video_insert=skipped schedule_insert=skipped tvbs_live_insert=skipped',
                $payload['source'],
                $payload['tvbs_tag_id'],
                $payload['active_channels'],
                $payload['tagged_channels'],
                $payload['eligible_rows'],
                $payload['selected_rows'],
                $payload['offset'],
                $payload['offset_mode'],
                $payload['next_offset'],
                $payload['missing_uploads_playlist'],
                $payload['legacy_loop_limit'],
                $payload['legacy_sleep_seconds'],
                $payload['would_call_api'] ? 'yes' : 'no',
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d u_id=%d uploads=%s local_week=%d tvbs_live=%d tvbs_active=%d title="%s"',
                    $index + 1,
                    $row['u_id'],
                    $row['uploads'] !== '' ? $row['uploads'] : '-',
                    $row['local_recent_week_count'],
                    $row['local_tvbs_live_rows'],
                    $row['local_tvbs_active_live_rows'],
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return 0;
        } catch (QueryException $exception) {
            $this->error('youtube:tvbs:videos unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('youtube:tvbs:videos execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:tvbs:videos execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
