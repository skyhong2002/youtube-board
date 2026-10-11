<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\ChannelStatisticsIngestion;
use App\Services\Ingestion\ChannelStatisticsPreview;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use Illuminate\Console\Command;
use Illuminate\Database\QueryException;
use RuntimeException;
use Throwable;

class YoutubeChannelsStatsCommand extends Command
{
    protected $signature = 'youtube:channels:stats {--u_id= : Optional channel u_id to preview} {--channel= : Alias for --u_id when running a local execute smoke} {--hours=22 : Legacy stime expiration window} {--limit=20 : Number of channels to print, capped at the legacy loop count} {--execute : Call YouTube and write the selected rows to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of channel statistics polling, with explicit local-only --execute support';

    public function handle(ChannelStatisticsPreview $preview, ChannelStatisticsIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $channelOption = $this->option('channel') ?? $this->option('u_id');
        $uId = $channelOption !== null ? max(1, (int) $channelOption) : null;
        $hours = max(1, min(168, (int) $this->option('hours')));
        $limit = max(1, min(61, (int) $this->option('limit')));
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($execute) {
                $executeLimit = min($limit, 50);
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.channels.stats',
                    effectiveCommand: sprintf('youtube:channels:stats --execute --limit=%d', $executeLimit),
                    callback: fn (): array => $ingestion->execute(uId: $uId, hours: $hours, limit: $executeLimit),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:channels:stats execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:channels:stats mode=local-execute selected_rows=%d api_requested_rows=%d updated_rows=%d skipped_rows=%d write_targets="%s" external_calls="%s" secrets=%s',
                    $payload['selected_rows'],
                    $payload['api_requested_rows'],
                    $payload['updated_rows'],
                    $payload['skipped_rows'],
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['secrets'],
                ));

                foreach ($payload['applied'] as $row) {
                    $this->line(sprintf(
                        'updated u_id=%d youtube_id=%s view=%s sub=%s videos=%s',
                        $row['u_id'],
                        $row['youtube_id'],
                        number_format($row['viewCount']),
                        $row['subscriberCount'] !== null ? number_format($row['subscriberCount']) : 'hidden',
                        number_format($row['videoCount']),
                    ));
                }

                foreach ($payload['skipped'] as $row) {
                    $this->line(sprintf(
                        'skipped u_id=%d youtube_id=%s reason=%s',
                        $row['u_id'],
                        $row['youtube_id'],
                        $row['reason'],
                    ));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $preview->preview(uId: $uId, hours: $hours, limit: $limit);

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'youtube:channels:stats mode=ingestion-preview source=%s active_channels=%d unchecked_channels=%d stale_channels=%d missing_log_channels=%d eligible_rows=%d selected_rows=%d missing_youtube_id=%d hours=%d expire_time=%s would_call_api=%s generated_at=%s writes=0 api_call=skipped channel_update=skipped count_update=skipped log_update=skipped',
                $payload['source'],
                $payload['active_channels'],
                $payload['unchecked_channels'],
                $payload['stale_channels'],
                $payload['missing_log_channels'],
                $payload['eligible_rows'],
                $payload['selected_rows'],
                $payload['missing_youtube_id'],
                $payload['hours'],
                $payload['expire_time'],
                $payload['would_call_api'] ? 'yes' : 'no',
                $payload['generated_at'],
            ));

            foreach ($payload['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d u_id=%d youtube_id=%s stime=%s would_set_stime=%s view=%s sub=%s videos=%s title="%s"',
                    $index + 1,
                    $row['u_id'],
                    $row['youtube_id'],
                    $row['current_stime'] ?? '-',
                    $row['would_set_stime'],
                    $row['channel_counts']['viewCount'] !== null ? number_format($row['channel_counts']['viewCount']) : 'n/a',
                    $row['channel_counts']['subscriberCount'] !== null ? number_format($row['channel_counts']['subscriberCount']) : 'n/a',
                    $row['channel_counts']['videoCount'] !== null ? number_format($row['channel_counts']['videoCount']) : 'n/a',
                    mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (QueryException $exception) {
            $this->error('youtube:channels:stats unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (RuntimeException $exception) {
            $this->line('youtube:channels:stats execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        } catch (Throwable $exception) {
            $this->line('youtube:channels:stats execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

            return 1;
        }

    }
}
