<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\ChannelRetirementIngestion;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use Illuminate\Console\Command;
use Throwable;

class YoutubeChannelsRetireCommand extends Command
{
    protected $signature = 'youtube:channels:retire {--u_id= : Explicit channel u_id instead of the stale-statistics candidate scan} {--stale-days=14 : Days without a successful statistics publication before a channel is a candidate, min 7} {--limit=50 : Candidate cap per run, max 50 (one channels.list request)} {--offset=0 : Skip this many ordered candidates so still_on_youtube rows cannot clog the batch head} {--restore : With --u_id, clear flag_del after confirming the channel exists again} {--execute : Confirm absence with YouTube channels.list(part=id) and write urt_channel.flag_del} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Retire urt_channel rows whose YouTube channels no longer exist; preview by default, execute confirms absence via channels.list before writing flag_del';

    public function handle(ChannelRetirementIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $uIdOption = $this->option('u_id');
        $uId = $uIdOption !== null && trim((string) $uIdOption) !== '' ? max(1, (int) $uIdOption) : null;
        $staleDays = max(ChannelRetirementIngestion::MIN_STALE_DAYS, min(ChannelRetirementIngestion::MAX_STALE_DAYS, (int) $this->option('stale-days')));
        $limit = max(1, min(ChannelRetirementIngestion::MAX_LIMIT, (int) $this->option('limit')));
        $offset = max(0, (int) $this->option('offset'));
        $restore = (bool) $this->option('restore');
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

        try {
            if ($restore) {
                if ($uId === null) {
                    $failure = ['mode' => 'local-execute-restore', 'blocked_reason' => 'restore_requires_u_id', 'exit_code' => 1, 'secrets' => 'not_printed'];
                    $this->line((bool) $this->option('json')
                        ? json_encode($failure, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:channels:retire --restore requires an explicit --u_id');

                    return 1;
                }

                if (! $execute) {
                    $preview = ['mode' => 'ingestion-preview', 'u_id' => $uId, 'blocked_reason' => null, 'exit_code' => 0, 'would_restore' => true, 'api_call_skipped' => 'presence confirmation runs only in execute mode', 'writes' => [], 'secrets' => 'not_printed'];
                    $this->line((bool) $this->option('json')
                        ? json_encode($preview, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : sprintf('youtube:channels:retire mode=ingestion-preview restore u_id=%d would_call_api=execute-only writes=0 secrets=not_printed', $uId));

                    return 0;
                }

                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.channels.retire',
                    effectiveCommand: 'youtube:channels:retire --restore --execute --limit=1',
                    callback: fn (): array => $ingestion->restore($uId),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:channels:retire execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                } else {
                    $this->line(sprintf(
                        'youtube:channels:retire mode=%s restore u_id=%d restored=%s blocked_reason=%s secrets=not_printed',
                        $payload['mode'],
                        $uId,
                        ($payload['restored'] ?? false) ? 'yes' : 'no',
                        $payload['blocked_reason'] ?? 'none',
                    ));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            if ($execute) {
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.channels.retire',
                    effectiveCommand: sprintf('youtube:channels:retire --execute --limit=%d', $limit),
                    callback: fn (): array => $ingestion->execute(uId: $uId, staleDays: $staleDays, limit: $limit, offset: $offset),
                );

                if (! $quotaRun['allowed']) {
                    $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                    $this->line((bool) $this->option('json')
                        ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : 'youtube:channels:retire execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                    return 1;
                }

                $payload = $quotaRun['payload'];

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                    return (int) ($payload['exit_code'] ?? 0);
                }

                $this->line(sprintf(
                    'youtube:channels:retire mode=%s selected_rows=%d retired_rows=%d skipped_rows=%d failed_rows=%d write_targets="%s" external_calls="%s" blocked_reason=%s secrets=not_printed',
                    $payload['mode'],
                    (int) ($payload['selected_rows'] ?? 0),
                    (int) ($payload['retired_rows'] ?? 0),
                    (int) ($payload['skipped_rows'] ?? 0),
                    (int) ($payload['failed_rows'] ?? 0),
                    implode(',', $payload['write_targets']),
                    implode(',', $payload['external_calls']),
                    $payload['blocked_reason'] ?? 'none',
                ));

                foreach ($payload['retired'] ?? [] as $row) {
                    $this->line(sprintf('retired u_id=%d youtube_id=%s title=%s', $row['u_id'], $row['youtube_id'], $row['title']));
                }

                foreach ($payload['skipped'] ?? [] as $row) {
                    $this->line(sprintf('skipped u_id=%d youtube_id=%s reason=%s', $row['u_id'], $row['youtube_id'], $row['reason']));
                }

                return (int) ($payload['exit_code'] ?? 0);
            }

            $payload = $ingestion->preview(uId: $uId, staleDays: $staleDays, limit: $limit, offset: $offset);

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'youtube:channels:retire mode=ingestion-preview stale_days=%d limit=%d selected_rows=%d would_call_api=%s blocked_reason=%s writes=0 secrets=not_printed',
                $payload['stale_days'],
                $payload['limit'],
                (int) ($payload['selected_rows'] ?? 0),
                ($payload['would_call_api'] ?? false) ? 'yes' : 'no',
                $payload['blocked_reason'] ?? 'none',
            ));

            foreach ($payload['rows'] ?? [] as $row) {
                $this->line(sprintf(
                    'candidate u_id=%d youtube_id=%s title=%s last_success=%s last_attempt=%s',
                    $row['u_id'],
                    $row['youtube_id'],
                    $row['title'],
                    $row['mtime'] ?? 'never',
                    $row['stime'] ?? 'never',
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        } catch (Throwable $exception) {
            if ((bool) $this->option('json')) {
                $this->line(json_encode([
                    'mode' => $execute ? 'local-execute' : 'ingestion-preview',
                    'blocked_reason' => 'command_failed',
                    'exception_class' => $exception::class,
                    'exit_code' => 1,
                    'secrets' => 'not_printed',
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            } else {
                $this->line('youtube:channels:retire unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');
            }

            return 1;
        }

    }
}
