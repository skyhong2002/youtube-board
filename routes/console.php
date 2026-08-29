<?php

use App\Console\GuardedClosureCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiDailyIngestion;
use App\Services\Ingestion\AiDailyPreview;
use App\Services\Ingestion\AiDaysRefreshIngestion;
use App\Services\Ingestion\AiEventIngestion;
use App\Services\Ingestion\AiHourlyIngestion;
use App\Services\Ingestion\AiHourlyPreview;
use App\Services\Ingestion\AiPeriodIngestion;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Services\Ingestion\AiScheduledPipelineIngestion;
use App\Services\Ingestion\AiTopicCacheBuilder;
use App\Services\Ingestion\ChannelAiIngestion;
use App\Services\Ingestion\ChannelCloudCacheBuilder;
use App\Services\Ingestion\ChannelCountsPreview;
use App\Services\Ingestion\ChannelPredictionIngestion;
use App\Services\Ingestion\ChannelRetirementIngestion;
use App\Services\Ingestion\ChannelStatisticsIngestion;
use App\Services\Ingestion\ChannelStatisticsPreview;
use App\Services\Ingestion\ChannelVideosDiscoveryIngestion;
use App\Services\Ingestion\ChannelVideosDiscoveryPreview;
use App\Services\Ingestion\CommentFetchIngestion;
use App\Services\Ingestion\CommentFetchPreview;
use App\Services\Ingestion\CommentQueueIngestion;
use App\Services\Ingestion\CommentQueuePreview;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\GroupReportsPreview;
use App\Services\Ingestion\GroupViewCacheBuilder;
use App\Services\Ingestion\IngestionCommandLock;
use App\Services\Ingestion\IngestionHealthCheck;
use App\Services\Ingestion\IngestionJobRegistry;
use App\Services\Ingestion\IngestionRunHistory;
use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\KeywordCloudCacheBuilder;
use App\Services\Ingestion\KeywordRelationCacheBuilder;
use App\Services\Ingestion\KeywordReportsPreview;
use App\Services\Ingestion\LiveCleanupPreview;
use App\Services\Ingestion\LiveDisplayCachePreview;
use App\Services\Ingestion\LivePollingIngestion;
use App\Services\Ingestion\LivePollingPreview;
use App\Services\Ingestion\LiveStaticHtmlPreview;
use App\Services\Ingestion\LiveTagDateCacheBuilder;
use App\Services\Ingestion\MayorPersonAiIngestion;
use App\Services\Ingestion\MayorStaticReportsPreview;
use App\Services\Ingestion\OpenCodeChatClient;
use App\Services\Ingestion\PeopleReportsPreview;
use App\Services\Ingestion\PhotoCacheBuilder;
use App\Services\Ingestion\ScheduleReportsPreview;
use App\Services\Ingestion\StaticHtmlReportsPreview;
use App\Services\Ingestion\TagCloudCacheBuilder;
use App\Services\Ingestion\TagDateCacheBuilder;
use App\Services\Ingestion\TagMonthCacheBuilder;
use App\Services\Ingestion\TagsAllCacheBuilder;
use App\Services\Ingestion\TagVideoBackfillIngestion;
use App\Services\Ingestion\TvbsChannelVideosDiscoveryIngestion;
use App\Services\Ingestion\TvbsChannelVideosDiscoveryPreview;
use App\Services\Ingestion\TvbsLivePollingIngestion;
use App\Services\Ingestion\TvbsLivePollingPreview;
use App\Services\Ingestion\VideoDurationsIngestion;
use App\Services\Ingestion\VideoDurationsPreview;
use App\Services\Ingestion\VideoStatisticsIngestion;
use App\Services\Ingestion\VideoStatisticsPreview;
use App\Services\Notifications\TelegramDigestBroadcaster;
use App\Services\Notifications\TelegramScheduleSlotGate;
use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Illuminate\Console\Application as ConsoleApplication;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;

$guardedIngestionCommand = static function (string $signature, Closure $callback): GuardedClosureCommand {
    $command = new GuardedClosureCommand($signature, $callback);

    ConsoleApplication::starting(function ($artisan) use ($command): void {
        $artisan->add($command);
    });

    return $command;
};

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('ingestion:list', function (IngestionJobRegistry $registry) {
    $summary = $registry->summary();

    $this->line(sprintf(
        'scheduler=%s total=%d planned=%d active=%d blocked=%d command_ready=%d command_missing=%d',
        $summary['scheduler_enabled'] ? 'enabled' : 'disabled',
        $summary['total'],
        $summary['planned'],
        $summary['active'],
        $summary['blocked'],
        $summary['command_ready'],
        $summary['command_missing'],
    ));

    foreach ($registry->jobs() as $job) {
        $this->line(sprintf(
            '[P%d] %s command:%s %s -> %s (%s)',
            $job['priority'],
            $job['status'],
            $job['command_exists'] ? 'ready' : 'missing',
            $job['legacy_command'],
            $job['modern_command'],
            $job['schedule'],
        ));
    }
})->purpose('List the planned legacy-to-Laravel ingestion command registry');

Artisan::command('ai:provider:probe {--provider=both : primary/openai, fallback, or both} {--json : Emit JSON instead of text}', function (OpenCodeChatClient $client) {
    $providerOption = strtolower(trim((string) $this->option('provider')));
    $providers = match ($providerOption) {
        'primary', 'openai' => ['primary'],
        'fallback' => ['fallback'],
        'both' => ['primary', 'fallback'],
        default => [],
    };

    if ($providers === []) {
        $this->error('ai:provider:probe unavailable: --provider must be primary, fallback, openai, or both');

        return 1;
    }

    $results = [];

    foreach ($providers as $provider) {
        try {
            $probe = $client->probe($provider);
            $results[] = [
                'provider' => $provider,
                'ok' => true,
                'model' => $probe['model'],
                'configured_model' => $probe['configured_model'],
                'usage' => $probe['usage'],
                'latency_ms' => $probe['latency_ms'],
                'content_chars' => mb_strlen($probe['content'], 'UTF-8'),
                'error' => null,
            ];
        } catch (Throwable $exception) {
            $results[] = [
                'provider' => $provider,
                'ok' => false,
                'model' => $provider === 'fallback'
                    ? (string) config('services.opencode_go.fallback_model', '')
                    : (string) config('services.opencode_go.model', ''),
                'configured_model' => $provider === 'fallback'
                    ? (string) config('services.opencode_go.fallback_model', '')
                    : (string) config('services.opencode_go.model', ''),
                'usage' => null,
                'latency_ms' => null,
                'content_chars' => 0,
                'error' => SensitiveTextRedactor::exception($exception, 240),
            ];
        }
    }

    $failed = collect($results)->where('ok', false)->count();
    $payload = [
        'mode' => 'probe',
        'source' => 'ai_provider_probe',
        'providers' => $results,
        'summary' => [
            'ok' => count($results) - $failed,
            'failed' => $failed,
        ],
        'secrets' => 'not_printed',
    ];

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $failed === 0 ? 0 : 1;
    }

    foreach ($results as $result) {
        $usage = is_array($result['usage']) ? json_encode($result['usage'], JSON_UNESCAPED_SLASHES) : 'null';
        $this->line(sprintf(
            'ai:provider:probe provider=%s status=%s model=%s latency_ms=%s content_chars=%d secrets=not_printed usage=%s error=%s',
            $result['provider'],
            $result['ok'] ? 'ok' : 'failed',
            $result['model'] !== '' ? $result['model'] : '-',
            $result['latency_ms'] === null ? '-' : (string) $result['latency_ms'],
            $result['content_chars'],
            $usage,
            $result['error'] ?? '-',
        ));
    }

    return $failed === 0 ? 0 : 1;
})->purpose('Probe configured primary or fallback AI provider with a minimal no-write completion request');

Artisan::command('ingestion:run {--execute : Execute active due jobs instead of dry-running} {--dry-run : Force dry-run even when --execute is also supplied} {--record : Store the run result in local ingestion run history} {--at= : Timestamp to evaluate, for deterministic checks} {--job= : Evaluate one registry job key} {--all : Include jobs that are not currently due}', function (IngestionSchedulerRunner $runner, IngestionRunHistory $history) {
    $timezone = config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $at = $this->option('at')
        ? CarbonImmutable::parse((string) $this->option('at'), $timezone)
        : CarbonImmutable::now($timezone);

    $result = $runner->run(
        at: $at,
        execute: $execute,
        jobKey: $this->option('job') ? (string) $this->option('job') : null,
        showAll: (bool) $this->option('all'),
    );

    $this->line(sprintf(
        'mode=%s scheduler=%s at=%s evaluated=%d due=%d executed=%d skipped=%d failed=%d yt_quota_estimate=%d runtime_ms=%d',
        $result['mode'],
        $result['scheduler_enabled'] ? 'enabled' : 'disabled',
        $result['at'],
        $result['summary']['evaluated'],
        $result['summary']['due'],
        $result['summary']['executed'],
        $result['summary']['skipped'],
        $result['summary']['failed'],
        (int) ($result['youtube_quota_estimate']['estimated_units'] ?? 0),
        (int) ($result['runtime_ms'] ?? 0),
    ));

    foreach ($result['jobs'] as $job) {
        $this->line(sprintf(
            '[%s] %s %s -> %s (%s) yt_quota=%d',
            $job['due'] ? 'due' : 'not-due',
            $job['key'],
            $job['action'],
            $job['effective_command'] ?? $job['command'],
            $job['schedule'],
            (int) ($job['estimated_youtube_quota_units'] ?? 0),
        ));
    }

    if ((bool) $this->option('record')) {
        $record = $history->record($result, [
            'mode' => $execute ? 'execute' : 'dry-run',
            'job' => $this->option('job') ? (string) $this->option('job') : null,
            'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
            'show_all' => (bool) $this->option('all'),
            'scheduler_enabled_temporarily' => false,
            'original_scheduler_enabled' => (bool) config('ingestion.scheduler_enabled', false),
            'source' => 'artisan',
        ]);

        $this->line(sprintf('recorded=%s path=%s', $record['id'], $record['path']));
    }

    return (int) ($result['summary']['failed'] ?? 0) > 0 ? 1 : 0;
})->purpose('Evaluate or execute due ingestion jobs from the legacy cron registry');

Artisan::command('ingestion:health {--date= : Daily report target date, defaults to yesterday in Asia/Taipei} {--json : Emit JSON instead of text}', function (IngestionHealthCheck $health) {
    $payload = $health->check($this->option('date') ? (string) $this->option('date') : null);

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $payload['status'] === 'fail' ? 1 : 0;
    }

    $this->line(sprintf(
        'ingestion:health status=%s target_date=%s scheduler=%s yt_requests=%d yt_failed=%d yt_max_ms=%d ai_requests=%d ai_failed=%d ai_max_ms=%d',
        $payload['status'],
        $payload['target_date'],
        ($payload['scheduler']['active'] ?? false) ? 'active' : 'not-observed',
        (int) ($payload['youtube']['requests'] ?? 0),
        (int) ($payload['youtube']['failed_requests'] ?? 0),
        (int) ($payload['youtube']['max_latency_ms'] ?? 0),
        (int) ($payload['ai']['requests'] ?? 0),
        (int) ($payload['ai']['failed_requests'] ?? 0),
        (int) ($payload['ai']['max_latency_ms'] ?? 0),
    ));

    $aiDaily = $payload['targets']['ai_daily'] ?? [];
    $this->line(sprintf(
        'target ai_daily status=%s conditions=%d/%d channel_rows=%s/%d missing="%s" latest_mtime=%s',
        (string) ($aiDaily['status'] ?? 'unknown'),
        count($aiDaily['completed_conditions'] ?? []),
        count($aiDaily['expected_conditions'] ?? []),
        ($aiDaily['channel_rows'] ?? null) === null ? '-' : (string) $aiDaily['channel_rows'],
        (int) ($aiDaily['expected_channel_rows'] ?? 0),
        implode(',', $aiDaily['missing_conditions'] ?? []),
        (string) ($aiDaily['latest_mtime'] ?? '-'),
    ));

    $mayor = $payload['targets']['mayor_person'] ?? [];
    $this->line(sprintf(
        'target mayor_person status=%s city=%s people=%d/%d missing="%s" latest_mtime=%s',
        (string) ($mayor['status'] ?? 'unknown'),
        (string) ($mayor['city'] ?? '-'),
        count($mayor['completed_people'] ?? []),
        count($mayor['expected_people'] ?? []),
        implode(',', $mayor['missing_people'] ?? []),
        (string) ($mayor['latest_mtime'] ?? '-'),
    ));

    foreach (array_slice($payload['processing']['jobs'] ?? [], 0, 12) as $job) {
        $this->line(sprintf(
            'job key=%s status=%s action=%s runtime_ms=%s record=%s',
            (string) ($job['key'] ?? '-'),
            (string) ($job['status'] ?? 'unknown'),
            (string) ($job['last_action'] ?? '-'),
            ($job['last_runtime_ms'] ?? null) === null ? '-' : (string) $job['last_runtime_ms'],
            (string) ($job['last_record_id'] ?? '-'),
        ));
    }

    foreach ($payload['recommendations'] ?? [] as $recommendation) {
        $this->line('recommendation='.$recommendation);
    }

    return $payload['status'] === 'fail' ? 1 : 0;
})->purpose('Health-check ingestion runtimes, YouTube API latency, AI latency, quota, and daily report completeness');

Artisan::command('youtube:channels:stats {--u_id= : Optional channel u_id to preview} {--channel= : Alias for --u_id when running a local execute smoke} {--hours=22 : Legacy stime expiration window} {--limit=20 : Number of channels to print, capped at the legacy loop count} {--execute : Call YouTube and write the selected rows to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (ChannelStatisticsPreview $preview, ChannelStatisticsIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Dry-run preview of channel statistics polling, with explicit local-only --execute support');

Artisan::command('youtube:channels:retire {--u_id= : Explicit channel u_id instead of the stale-statistics candidate scan} {--stale-days=14 : Days without a successful statistics publication before a channel is a candidate, min 7} {--limit=50 : Candidate cap per run, max 50 (one channels.list request)} {--offset=0 : Skip this many ordered candidates so still_on_youtube rows cannot clog the batch head} {--restore : With --u_id, clear flag_del after confirming the channel exists again} {--execute : Confirm absence with YouTube channels.list(part=id) and write urt_channel.flag_del} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (ChannelRetirementIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Retire urt_channel rows whose YouTube channels no longer exist; preview by default, execute confirms absence via channels.list before writing flag_del');

Artisan::command('youtube:tag-videos:backfill {--tagid=102 : Comma-separated required channel tag ids} {--or= : Comma-separated OR channel tag ids} {--not= : Comma-separated excluded channel tag ids} {--from= : Start date YYYY-MM-DD} {--to= : End date YYYY-MM-DD} {--days=2 : Relative day count when --from is omitted} {--limit=100 : Channel cap} {--max-pages=20 : Playlist pages per channel, max 200} {--max-results=50 : Playlist items per page, max 50} {--keyword-limit=100000 : Keywords scanned when rebuilding tag-date cache, max 100000} {--no-rebuild : Skip urt_show_tag_date rebuild after video crawl} {--execute : Call YouTube and write local video/cache rows} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (TagVideoBackfillIngestion $backfill, DirectYoutubeQuotaGuard $quotaGuard) {
    $ids = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
        ->map(fn (string $id): int => (int) trim($id))
        ->filter(fn (int $id): bool => $id > 0)
        ->values()
        ->all();
    $tagIds = $ids('tagid');

    if ($tagIds === []) {
        $this->error('youtube:tag-videos:backfill requires --tagid');

        return 1;
    }

    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $from = $this->option('from');
    $to = $this->option('to');
    $validDate = static function (mixed $date): bool {
        if (! is_string($date)) {
            return false;
        }

        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

        return $parsed instanceof DateTimeImmutable && $parsed->format('Y-m-d') === $date;
    };

    if (($from !== null && ! $validDate($from)) || ($to !== null && ! $validDate($to))) {
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'available' => false,
            'blocked_reason' => 'invalid_date',
            'error' => 'date_options_must_be_valid_calendar_dates',
            'writes' => 0,
            'secrets' => 'not_printed',
        ];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } else {
            $this->error('youtube:tag-videos:backfill date options must be valid calendar dates in YYYY-MM-DD');
        }

        return 1;
    }

    $limit = max(1, min(500, (int) $this->option('limit')));
    $maxPages = max(1, min(200, (int) $this->option('max-pages')));
    $maxResults = max(1, min(50, (int) $this->option('max-results')));
    $keywordLimit = max(1, min(TagVideoBackfillIngestion::TAG_DATE_KEYWORD_LIMIT, (int) $this->option('keyword-limit')));

    try {
        $backfillCall = fn (): array => $backfill->run(
            tagIds: $tagIds,
            orTagIds: $ids('or'),
            notTagIds: $ids('not'),
            from: is_string($from) ? $from : null,
            to: is_string($to) ? $to : null,
            days: (int) $this->option('days'),
            limit: $limit,
            maxPages: $maxPages,
            maxResults: $maxResults,
            keywordLimit: $keywordLimit,
            rebuildTagDate: ! (bool) $this->option('no-rebuild'),
            execute: $execute,
        );

        if ($execute) {
            $quotaRun = $quotaGuard->run(
                jobKey: 'youtube.tag_videos.backfill',
                effectiveCommand: sprintf(
                    'youtube:tag-videos:backfill --execute --limit=%d --max-pages=%d --max-results=%d --keyword-limit=%d',
                    $limit,
                    $maxPages,
                    $maxResults,
                    $keywordLimit,
                ),
                callback: $backfillCall,
            );

            if (! $quotaRun['allowed']) {
                $payload = $quotaGuard->blockedPayload($quotaRun['guard']);

                if ((bool) $this->option('json')) {
                    $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                } else {
                    $this->line(sprintf(
                        'youtube:tag-videos:backfill unavailable: %s quota_date=%s planned_units=%d remaining_units=%d secrets=not_printed',
                        $payload['blocked_reason'],
                        (string) data_get($payload, 'youtube_quota_budget.quota_date', '-'),
                        (int) data_get($payload, 'youtube_quota_budget.planned_units', 0),
                        (int) data_get($payload, 'youtube_quota_budget.remaining_units', 0),
                    ));
                }

                return 1;
            }

            $payload = $quotaRun['payload'];
        } else {
            $payload = $backfillCall();
        }
    } catch (Throwable $exception) {
        $payload = [
            'mode' => $execute ? 'execute' : 'dry-run',
            'available' => false,
            'blocked_reason' => 'command_failed',
            'error' => $quotaGuard->sanitizedMessage($exception),
            'writes' => 0,
            'secrets' => 'not_printed',
        ];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } else {
            $this->line('youtube:tag-videos:backfill unavailable: '.$payload['error'].' secrets=not_printed');
        }

        return 1;
    }

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return (int) ($payload['exit_code'] ?? ((int) ($payload['failed_channels'] ?? 0) > 0 ? 1 : 0));
    }

    $this->line(sprintf(
        'youtube:tag-videos:backfill mode=%s tagid=%s from=%s to=%s channels=%d failed_channels=%d crawl_complete=%s api_pages=%d videos=%d tag_date_writes=%d tag_date_skip=%s quota_planned=%d quota_actual=%d quota_remaining=%d quota_date=%s',
        $payload['mode'],
        $payload['tagid'],
        $payload['from'],
        $payload['to'],
        $payload['selected_channels'],
        (int) ($payload['failed_channels'] ?? 0),
        ($payload['crawl_complete'] ?? false) ? 'yes' : 'no',
        (int) ($payload['api_pages'] ?? 0),
        (int) ($payload['videos_in_range'] ?? 0),
        (int) ($payload['tag_date_writes'] ?? 0),
        $payload['tag_date_rebuild_skipped_reason'] ?? '-',
        (int) data_get($payload, 'youtube_quota_budget.planned_units', 0),
        (int) data_get($payload, 'youtube_quota_budget.actual_units', 0),
        (int) data_get($payload, 'youtube_quota_budget.remaining_units', 0),
        (string) data_get($payload, 'youtube_quota_budget.quota_date', '-'),
    ));

    return (int) ($payload['exit_code'] ?? ((int) ($payload['failed_channels'] ?? 0) > 0 ? 1 : 0));
})->purpose('Paginated uploads crawl for all channels in a tag, then rebuild local tag-date cache');

Artisan::command('youtube:channels:videos {--id= : Optional legacy channel u_id to preview} {--channel= : Alias for --id when running a local execute smoke} {--live= : Legacy live filter, 1 uses tag 52 and 2 uses tag 89} {--rescan : Preview legacy large-channel rescan branch} {--hours=700 : Legacy hours option, retained for compatibility} {--force=1 : Legacy duplicate-process threshold, shown only} {--limit=20 : Number of channels to print, capped at legacy loop count} {--max-results=5 : Execute-mode playlist item cap, max 50} {--execute : Call YouTube and write selected playlist items to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (ChannelVideosDiscoveryPreview $preview, ChannelVideosDiscoveryIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard, IngestionCommandLock $commandLock) {
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
})->purpose('Dry-run preview of legacy channel playlist discovery, with explicit local-only --execute support');

Artisan::command('youtube:tvbs:videos {--tag=29 : Legacy TVBS channel tag id in urt_count.tags} {--id= : Optional u_id to fetch} {--channel= : Optional YouTube channel id to fetch} {--hours=700 : Legacy hours option, retained for compatibility} {--force=1 : Legacy duplicate-process threshold, shown only} {--limit=20 : Number of channels to print, capped lower for --execute} {--max-results=5 : Maximum playlist items per channel in execute mode, capped at 50} {--offset=0 : Wrapped channel offset, or auto for five-minute scheduler rotation} {--execute : Call YouTube and write selected TVBS playlist items to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (TvbsChannelVideosDiscoveryPreview $preview, TvbsChannelVideosDiscoveryIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Dry-run preview of legacy TVBS channel playlist discovery, with explicit local-only --execute support');

Artisan::command('youtube:live:poll {--videoId= : Optional live video id to preview} {--interval=11 : Legacy freshness interval in minutes} {--limit=20 : Number of live rows to print, capped at the legacy loop count} {--execute : Call YouTube and write selected live details to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (LivePollingPreview $preview, LivePollingIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
    $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;
    $interval = max(1, min(240, (int) $this->option('interval')));
    $limit = max(1, min(50, (int) $this->option('limit')));
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

    try {
        if ($execute) {
            $quotaRun = $quotaGuard->run(
                jobKey: 'youtube.live.poll',
                effectiveCommand: sprintf('youtube:live:poll --execute --limit=%d', $limit),
                callback: fn (): array => $ingestion->execute(videoId: $videoId, intervalMinutes: $interval, limit: $limit),
            );

            if (! $quotaRun['allowed']) {
                $blocked = $quotaGuard->blockedPayload($quotaRun['guard']);
                $this->line((bool) $this->option('json')
                    ? json_encode($blocked, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : 'youtube:live:poll execute unavailable: '.$blocked['blocked_reason'].' secrets=not_printed');

                return 1;
            }

            $payload = $quotaRun['payload'];

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'youtube:live:poll mode=local-execute source=%s selected_rows=%d api_requested_videos=%d updated_videos=%d skipped_videos=%d write_targets="%s" external_calls="%s" secrets=%s',
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

        $payload = $preview->preview(videoId: $videoId, intervalMinutes: $interval, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:live:poll mode=ingestion-preview source=%s active_live_rows=%d eligible_rows=%d selected_rows=%d existing_today_log_rows=%d missing_today_log_rows=%d interval_minutes=%d too_soon=%s would_call_api=%s generated_at=%s writes=0 api_call=skipped live_update=skipped log_update=skipped',
            $payload['source'],
            $payload['active_live_rows'],
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['existing_today_log_rows'],
            $payload['missing_today_log_rows'],
            $payload['interval_minutes'],
            $payload['too_soon'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

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
        $this->error('youtube:live:poll unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    } catch (RuntimeException $exception) {
        $this->line('youtube:live:poll execute unavailable: failure=execution_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    } catch (Throwable $exception) {
        $this->line('youtube:live:poll execute unavailable: failure=unexpected_exception exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Dry-run preview of legacy live stream polling, with explicit local-only --execute support');

Artisan::command('youtube:tvbs:live:poll {--videoId= : Optional TVBS live video id to preview} {--interval=11 : Legacy interval option retained; get_live_tvbs.php uses a hard-coded 40 seconds} {--stale-seconds=40 : Actual TVBS freshness cutoff in seconds} {--limit=20 : Number of live rows to print, capped at the legacy batch count} {--execute : Call YouTube and write selected TVBS live rows to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (TvbsLivePollingPreview $preview, TvbsLivePollingIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Dry-run preview of legacy TVBS live stream polling, with explicit local-only --execute support');

Artisan::command('reports:live:show {--limit=10 : Number of top live rows to print} {--json : Emit JSON instead of text}', function () {
    $limit = max(1, min(50, (int) $this->option('limit')));
    $now = now(config('ingestion.timezone', 'Asia/Taipei'));
    $latestTime = $now->copy()->subHour()->format('Y-m-d H:i:s');
    $today = $now->toDateString();

    try {
        $activeLive = DB::table('urt_video_live')
            ->whereNull('actualEndTime')
            ->where('concurrentViewers', '>', 0)
            ->where('mtime', '>=', $latestTime)
            ->count();

        $topRows = DB::table('urt_video_live')
            ->select(['videoId', 'u_id', 'concurrentViewers', 'max_current', 'mtime'])
            ->whereNull('actualEndTime')
            ->where('concurrentViewers', '>', 0)
            ->where('mtime', '>=', $latestTime)
            ->orderByDesc('concurrentViewers')
            ->limit($limit)
            ->get();

        $videoIds = $topRows->pluck('videoId')->filter()->unique()->values()->all();
        $displayRows = $videoIds === []
            ? collect()
            : DB::table('urt_show_video_live')
                ->whereIn('videoId', $videoIds)
                ->get()
                ->keyBy('videoId');

        $logRowsToday = DB::table('urt_video_live_log')
            ->where('the_date', $today)
            ->count();

        $rows = $topRows
            ->map(function (object $row, int $index) use ($displayRows): array {
                $display = $displayRows->get($row->videoId);

                return [
                    'rank' => $index + 1,
                    'video_id' => (string) $row->videoId,
                    'u_id' => $row->u_id !== null ? (int) $row->u_id : null,
                    'title' => (string) ($display->title ?? $row->videoId),
                    'channel_title' => (string) ($display->channelTitle ?? 'Unknown channel'),
                    'current_viewers' => (int) $row->concurrentViewers,
                    'max_current' => $row->max_current !== null ? (int) $row->max_current : null,
                    'mtime' => (string) ($row->mtime ?? ''),
                ];
            })
            ->values()
            ->all();

        $payload = [
            'mode' => 'dashboard-snapshot',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'active_live' => $activeLive,
            'shown' => count($rows),
            'log_rows_today' => $logRowsToday,
            'rows' => $rows,
            'writes' => [],
        ];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:live:show mode=dashboard-snapshot active_live=%d shown=%d log_rows_today=%d generated_at=%s',
            $payload['active_live'],
            $payload['shown'],
            $payload['log_rows_today'],
            $payload['generated_at'],
        ));

        foreach ($rows as $row) {
            $this->line(sprintf(
                '#%d %s viewers=%d peak=%s channel="%s" title="%s"',
                $row['rank'],
                $row['video_id'],
                $row['current_viewers'],
                $row['max_current'] !== null ? number_format($row['max_current']) : 'n/a',
                $row['channel_title'],
                mb_strimwidth($row['title'], 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:show unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Live dashboard snapshot of the live display report from local live/cache rows');

$guardedIngestionCommand('reports:live:build {--hours=2 : Live rows newer than this many hours are considered} {--limit=20 : Number of preview rows to print} {--execute : Write missing urt_show_video_live display cache rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (LiveDisplayCachePreview $preview) {
    $hours = max(1, min(720, (int) $this->option('hours')));
    $limit = max(1, min(100, (int) $this->option('limit')));
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

    try {
        $payload = $preview->preview(hours: $hours, limit: $limit, execute: $execute);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:live:build mode=%s candidates=%d already_cached=%d would_insert=%d missing_video_metadata=%d hours=%d expire_time=%s generated_at=%s writes=%d',
            $payload['mode'],
            $payload['candidates'],
            $payload['already_cached'],
            $payload['would_insert'],
            $payload['missing_video_metadata'],
            $payload['hours'],
            $payload['expire_time'],
            $payload['generated_at'],
            $payload['cache_writes'] ?? (is_array($payload['writes']) ? count($payload['writes']) : (int) $payload['writes']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d pk_live=%d video=%s v_pk=%d channel="%s" title="%s"',
                $index + 1,
                $row['pk_live'],
                $row['video_id'],
                $row['v_pk'],
                $row['channel_title'],
                mb_strimwidth($row['title'], 0, 72, '...', 'UTF-8'),
            ));
        }

        return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Preview or execute legacy live display cache inserts from local live rows');

$guardedIngestionCommand('reports:live-tag-date:build {--from= : First cache date YYYY-MM-DD; preview defaults to yesterday} {--to= : Last cache date YYYY-MM-DD; preview defaults to --from} {--tagid= : Comma-separated channel tags that must all match} {--or= : Comma-separated channel tags where one must match} {--not= : Comma-separated channel tags to exclude} {--channel-limit=1000 : Matching channel source cap, max 5000} {--video-limit=1000 : Per-date live log cap, max 10000} {--keyword-limit=1000 : Keyword dictionary cap, max 5000} {--execute : Write urt_show_live_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (LiveTagDateCacheBuilder $builder) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $from = trim((string) $this->option('from'));
    $to = trim((string) $this->option('to'));

    if ($execute && ($from === '' || $to === '')) {
        $this->error('reports:live-tag-date:build unavailable: --execute requires explicit --from and --to dates');

        return 1;
    }

    $defaultDate = CarbonImmutable::now((string) config('ingestion.timezone', 'Asia/Taipei'))->subDay()->toDateString();
    $from = $from !== '' ? $from : $defaultDate;
    $to = $to !== '' ? $to : $from;
    $integerList = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
        ->map(fn (string $value): int => (int) trim($value))
        ->filter(fn (int $value): bool => $value > 0)
        ->unique()
        ->sort()
        ->values()
        ->all();

    try {
        $payload = $builder->build(
            from: $from,
            to: $to,
            tagIds: $integerList('tagid'),
            orTagIds: $integerList('or'),
            notTagIds: $integerList('not'),
            videoLimit: (int) $this->option('video-limit'),
            keywordLimit: (int) $this->option('keyword-limit'),
            channelLimit: (int) $this->option('channel-limit'),
            execute: $execute,
        );
    } catch (InvalidArgumentException $exception) {
        $validDate = static function (string $date): bool {
            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

            return $parsed !== false && $parsed->format('Y-m-d') === $date;
        };
        $payload = [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => false,
            'blocked_reason' => ! $validDate($from) || ! $validDate($to)
                ? 'invalid_date_range'
                : 'date_range_out_of_bounds',
            'failure' => 'validation_failed',
            'exception_class' => $exception::class,
            'from' => $from,
            'to' => $to,
            'writes' => 0,
            'failed_dates' => 0,
            'rows' => [],
        ];
    } catch (Throwable $exception) {
        $payload = [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => false,
            'blocked_reason' => 'cache_build_failed',
            'failure' => 'unexpected_exception',
            'exception_class' => $exception::class,
            'from' => $from,
            'to' => $to,
            'writes' => 0,
            'failed_dates' => 0,
            'rows' => [],
        ];
    }

    $failed = ! (bool) ($payload['available'] ?? false)
        || (int) ($payload['failed_dates'] ?? 0) > 0
        || ($payload['blocked_reason'] ?? null) !== null;

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $failed ? 1 : 0;
    }

    $this->line(sprintf(
        'reports:live-tag-date:build mode=%s available=%s from=%s to=%s filters=%s/%s/%s dates=%d channels=%d/%d keywords=%d videos=%d invalid_logs=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d failed=%d truncated=%s blocked_reason=%s generated_at=%s',
        $payload['mode'],
        ($payload['available'] ?? false) ? 'yes' : 'no',
        $payload['from'],
        $payload['to'],
        $payload['tagid'] ?? '',
        $payload['or'] ?? '',
        $payload['not'] ?? '',
        (int) ($payload['dates'] ?? 0),
        (int) ($payload['channels_matched'] ?? 0),
        (int) ($payload['channel_limit'] ?? 0),
        (int) ($payload['keywords_scanned'] ?? 0),
        (int) ($payload['videos_scanned'] ?? 0),
        (int) ($payload['invalid_log_rows'] ?? 0),
        (int) ($payload['would_insert'] ?? 0),
        (int) ($payload['would_update'] ?? 0),
        (int) ($payload['inserted'] ?? 0),
        (int) ($payload['updated'] ?? 0),
        (int) ($payload['unchanged'] ?? 0),
        (int) ($payload['failed_dates'] ?? 0),
        ($payload['source_truncated'] ?? false) ? 'yes' : 'no',
        $payload['blocked_reason'] ?? '-',
        $payload['generated_at'] ?? '-',
    ));

    foreach ($payload['rows'] as $index => $row) {
        $this->line(sprintf(
            '#%d date=%s status=%s reason=%s videos=%d invalid_logs=%d channels=%d tags=%d distinct_tags=%d total_views=%d',
            $index + 1,
            $row['date'],
            $row['status'],
            $row['reason'] ?? '-',
            $row['count_videos'],
            $row['invalid_log_rows'],
            $row['count_channels'],
            $row['count_tags'],
            $row['tags_count'],
            $row['total_views'],
        ));
    }

    return $failed ? 1 : 0;
})->purpose('Preview or explicitly rebuild live tag/date cache rows from local polling logs and video titles');

$guardedIngestionCommand('youtube:live:cleanup {--limit=20 : Number of stale live rows to print} {--execute : Mark selected stale urt_video_live rows deleted} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (LiveCleanupPreview $preview) {
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
})->purpose('Ingestion preview of legacy stale live cleanup; execute mode updates urt_video_live');

$guardedIngestionCommand('reports:live:clean {--limit=20 : Number of invalid live tag-date cache rows to print} {--execute : Delete selected invalid urt_show_live_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (LiveCleanupPreview $preview) {
    try {
        $payload = $preview->tagDateCachePreview(
            limit: (int) $this->option('limit'),
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:live:clean mode=%s total_rows=%d would_delete=%d deleted=%d retained_rows=%d generated_at=%s writes=%d',
            $payload['mode'],
            $payload['total_rows'],
            $payload['would_delete'],
            $payload['deleted'],
            $payload['retained_rows'],
            $payload['generated_at'],
            count($payload['writes']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d pk=%d ctime=%s the_date=%s tagid=%s count_videos=%s',
                $index + 1,
                $row['pk'],
                $row['ctime'],
                $row['the_date'],
                $row['tagid'] ?? '-',
                $row['count_videos'] ?? '-',
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('reports:live:clean unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Ingestion preview of legacy live tag-date cache cleanup; execute mode deletes selected cache rows');

Artisan::command('reports:live:static {--limit=20 : Number of static live targets to print} {--json : Emit JSON instead of text}', function (LiveStaticHtmlPreview $preview) {
    try {
        $payload = $preview->preview(limit: (int) $this->option('limit'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:live:static mode=ingestion-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
            $payload['targets'],
            $payload['would_generate'],
            $payload['source_status'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s -> %s output=%s dynamic_rows=%d available=%s',
                $index + 1,
                $row['legacy_url'],
                $row['modern_url'],
                $row['output_path'],
                $row['dynamic_rows'],
                $row['dynamic_report_available'] ? 'yes' : 'no',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:static unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Ingestion preview of legacy static live HTML generation mapped to dynamic Laravel routes');

Artisan::command('reports:static:build {--limit=20 : Number of static group targets to print} {--json : Emit JSON instead of text}', function (StaticHtmlReportsPreview $preview) {
    try {
        $payload = $preview->preview(limit: (int) $this->option('limit'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:static:build mode=ingestion-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
            $payload['targets'],
            $payload['would_generate'],
            $payload['source_status'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s -> %s output=%s type=%s dynamic_rows=%d cache_rows=%s available=%s',
                $index + 1,
                $row['legacy_url'],
                $row['modern_url'],
                $row['output_path'],
                $row['report_type'],
                $row['dynamic_rows'],
                $row['cache_rows'] !== null ? (string) $row['cache_rows'] : 'n/a',
                $row['dynamic_report_available'] ? 'yes' : 'no',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:static:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Ingestion preview of legacy group static HTML generation mapped to dynamic Laravel routes');

$guardedIngestionCommand('reports:mayor:static {--city= : Optional mayor city key to preview} {--limit=20 : Number of mayor static targets to print} {--offset=0 : Target offset, or auto for scheduler rotation} {--keyword-limit=5000 : Number of local keywords to scan when --execute builds tag-date cache} {--execute : Build missing local tag-date cache for mayor targets} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (MayorStaticReportsPreview $preview) {
    try {
        $city = $this->option('city') ? (string) $this->option('city') : null;
        $limit = (int) $this->option('limit');
        $payload = (bool) $this->option('execute') && ! (bool) $this->option('dry-run')
            ? $preview->execute(city: $city, limit: $limit, keywordLimit: (int) $this->option('keyword-limit'), offset: (string) $this->option('offset'))
            : $preview->preview(city: $city, limit: $limit, offset: (string) $this->option('offset'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:mayor:static mode=%s targets=%d would_generate=%d source_status="%s" generated_at=%s cache_jobs=%d cache_writes=%d failed=%d static_write=skipped',
            $payload['mode'],
            $payload['targets'],
            $payload['would_generate'],
            $payload['source_status'],
            $payload['generated_at'],
            $payload['cache_jobs'] ?? 0,
            $payload['cache_writes'] ?? 0,
            $payload['failed_rows'] ?? 0,
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s / %s -> %s output=%s type=%s dynamic_rows=%d cache_rows=%d available=%s has_data=%s',
                $index + 1,
                $row['legacy_static_url'],
                $row['legacy_url'],
                $row['modern_url'],
                $row['output_path'],
                $row['report_type'],
                $row['dynamic_rows'],
                $row['cache_rows'],
                $row['dynamic_report_available'] ? 'yes' : 'no',
                $row['dynamic_report_has_data'] ? 'yes' : 'no',
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('reports:mayor:static unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Preview legacy mayor static HTML generation; --execute rebuilds required local tag-date cache for dynamic Laravel routes');

$guardedIngestionCommand('reports:tag-date:build {--tagid= : Comma-separated required channel tag ids, max 50} {--or= : Comma-separated OR channel tag ids, max 50} {--not= : Comma-separated excluded channel tag ids, max 50} {--date= : Single cache date} {--from= : Start date for cache range} {--to= : End date for cache range} {--days=30 : Relative day count when --from is omitted} {--today=0 : Days before today for relative end date} {--date-limit=400 : Date target cap, max 400; larger ranges are blocked} {--channel-limit=1000 : Matched source channel scan cap, max 5000} {--video-limit=10000 : Raw video scan cap per date, max 100000} {--keyword-limit=5000 : Local keyword source scan cap, max 20000} {--keywords= : Optional comma-separated keyword subset, max 500} {--execute : Write urt_show_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (TagDateCacheBuilder $builder) {
    $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    $now = CarbonImmutable::now($timezone);
    $tagIds = collect(explode(',', (string) $this->option('tagid')))
        ->map(fn (string $id): int => (int) trim($id))
        ->filter(fn (int $id): bool => $id > 0)
        ->values()
        ->all();

    if ($tagIds === []) {
        $this->error('reports:tag-date:build requires --tagid');

        return 1;
    }

    $validDate = static function (string $date): bool {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

        return $parsed instanceof DateTimeImmutable && $parsed->format('Y-m-d') === $date;
    };
    $to = $this->option('date')
        ? (string) $this->option('date')
        : ($this->option('to') ? (string) $this->option('to') : $now->subDays(max(0, (int) $this->option('today')))->toDateString());

    if (! $validDate($to)) {
        $this->error('reports:tag-date:build date options must be valid calendar dates in YYYY-MM-DD');

        return 1;
    }

    $from = $this->option('date')
        ? $to
        : ($this->option('from') ? (string) $this->option('from') : CarbonImmutable::parse($to, $timezone)->subDays(max(1, (int) $this->option('days')) - 1)->toDateString());

    if (! $validDate($from)) {
        $this->error('reports:tag-date:build date options must be valid calendar dates in YYYY-MM-DD');

        return 1;
    }

    if ($from > $to) {
        [$from, $to] = [$to, $from];
    }

    $ids = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
        ->map(fn (string $id): int => (int) trim($id))
        ->filter(fn (int $id): bool => $id > 0)
        ->values()
        ->all();
    $keywords = collect(explode(',', (string) $this->option('keywords')))
        ->map(fn (string $keyword): string => trim($keyword))
        ->filter(fn (string $keyword): bool => $keyword !== '')
        ->values()
        ->all();

    $payload = $builder->buildRange(
        tagIds: $tagIds,
        from: $from,
        to: $to,
        orTagIds: $ids('or'),
        notTagIds: $ids('not'),
        keywordLimit: (int) $this->option('keyword-limit'),
        onlyKeywords: $keywords,
        channelLimit: (int) $this->option('channel-limit'),
        videoLimit: (int) $this->option('video-limit'),
        execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
        now: $now,
        maxDates: (int) $this->option('date-limit'),
    );

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return (int) ($payload['exit_code'] ?? 0);
    }

    $this->line(sprintf(
        'reports:tag-date:build mode=%s status=%s tagid=%s from=%s to=%s rows=%d writes=%d failed_rows=%d source_complete=%s truncated=%s caps=date:%d,channels:%d,videos:%d,keywords:%d blocked_reason=%s',
        $payload['mode'],
        $payload['status'],
        implode(',', $tagIds),
        $from,
        $to,
        $payload['dates_selected'],
        $payload['writes'],
        $payload['failed_rows'],
        $payload['source_complete'] ? 'yes' : 'no',
        $payload['source_truncated'] ? 'yes' : 'no',
        $payload['caps']['date_range'],
        $payload['caps']['channel_scan'],
        $payload['caps']['video_scan_per_date'],
        $payload['caps']['keyword_scan'],
        $payload['blocked_reason'] ?? 'none',
    ));

    foreach (array_slice($payload['rows'], 0, 20) as $row) {
        $this->line(sprintf(
            '%s status=%s channels=%d videos=%d tags=%d views=%d writes=%d truncated=%s blocked_reason=%s',
            $row['date'],
            $row['status'],
            $row['channels_matched'],
            $row['videos_scanned'],
            $row['tags_count'],
            $row['total_views'],
            $row['writes'],
            $row['source_truncated'] ? 'yes' : 'no',
            $row['blocked_reason'] ?? 'none',
        ));
    }

    return (int) ($payload['exit_code'] ?? 0);
})->purpose('Build legacy urt_show_tag_date rows from local videos and tags; dry-run by default');

$guardedIngestionCommand('reports:tag-month:build {--months= : Required comma-separated months in YYYY-MM or YYYY-MM-01 format} {--subjects= : Required comma-separated keyword subjects} {--tagid= : Comma-separated required channel tag ids} {--or= : Comma-separated OR channel tag ids} {--not= : Comma-separated excluded channel tag ids} {--month-limit=12 : Month cap, max 24} {--subject-limit=20 : Subject cap, max 100} {--source-row-limit=31 : Latest daily source row cap per month, max 31} {--execute : Write urt_show_tag_month rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (TagMonthCacheBuilder $builder) {
    $csv = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
        ->map(fn (string $value): string => trim($value))
        ->filter(fn (string $value): bool => $value !== '')
        ->values()
        ->all();
    $ids = fn (string $option): array => collect($csv($option))
        ->map(fn (string $value): int => (int) $value)
        ->filter(fn (int $value): bool => $value > 0)
        ->values()
        ->all();
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $result = $builder->build(
        months: $csv('months'),
        subjects: $csv('subjects'),
        tagIds: $ids('tagid'),
        orTagIds: $ids('or'),
        notTagIds: $ids('not'),
        monthLimit: (int) $this->option('month-limit'),
        subjectLimit: (int) $this->option('subject-limit'),
        sourceRowLimit: (int) $this->option('source-row-limit'),
        execute: $execute,
    );
    $exitCode = $result['blocked_reason'] !== null || (int) $result['failed_subjects'] > 0 ? 1 : 0;

    if ((bool) $this->option('json')) {
        $this->line(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $exitCode;
    }

    $this->line(sprintf(
        'reports:tag-month:build mode=%s available=%s months=%d/%d ignored=%d subjects=%d/%d ignored=%d source_rows=%d/%d truncated=%s would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d skipped=%d failed=%d writes=%d blocked_reason=%s',
        $result['mode'],
        $result['available'] ? 'true' : 'false',
        count($result['months']),
        $result['months_requested'],
        $result['months_ignored'],
        count($result['subjects']),
        $result['subjects_requested'],
        $result['subjects_ignored'],
        $result['source_rows'],
        $result['source_row_limit'],
        ($result['source_truncated'] ?? false) ? 'yes' : 'no',
        $result['would_insert'],
        $result['would_update'],
        $result['inserted'],
        $result['updated'],
        $result['unchanged'],
        $result['skipped'],
        $result['failed_subjects'],
        $result['writes'],
        $result['blocked_reason'] ?? 'none',
    ));

    foreach (array_slice($result['rows'], 0, 30) as $row) {
        $this->line(sprintf(
            '%s subject=%s status=%s source_dates=%d videos=%d views=%d reason=%s',
            $row['month'],
            $row['subject'],
            $row['status'],
            $row['source_dates'],
            $row['count_videos'],
            $row['total_views'],
            $row['reason'] ?? 'none',
        ));
    }

    return $exitCode;
})->purpose('Build capped keyword month caches from local urt_show_tag_date rows; preview by default and manual only');

$guardedIngestionCommand('reports:ai-topic:build {--from= : Start date in YYYY-MM-DD; defaults to yesterday in the ingestion timezone} {--to= : End date in YYYY-MM-DD; defaults to --from} {--condition=all : Daily condition, one of all/green/blue/neutral/finance/world} {--type=oneday : Legacy urt_ai_date data_type} {--pk= : Optional explicit urt_ai_date pk instead of a date range} {--row-limit=31 : Daily source row cap per run, max 62} {--topic-limit=100 : Topic cap per daily row, max 200} {--channel-limit=100 : Channel-map cap per daily row, max 200} {--video-limit=5000 : Distinct referenced video cap per daily row, max 10000} {--missing-only : Skip rows whose data_json/video_json cache already exists} {--execute : Write urt_ai_date.data_json and urt_ai_date.video_json} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (AiTopicCacheBuilder $builder) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

    try {
        $pkOption = $this->option('pk');
        $result = $builder->build(
            from: is_string($this->option('from')) ? (string) $this->option('from') : null,
            to: is_string($this->option('to')) ? (string) $this->option('to') : null,
            condition: (string) $this->option('condition'),
            dataType: (string) $this->option('type'),
            pk: is_string($pkOption) && trim($pkOption) !== ''
                ? AiCommandInputValidator::integer($pkOption, '--pk', 1)
                : null,
            rowLimit: AiCommandInputValidator::integer($this->option('row-limit'), '--row-limit', 1),
            topicLimit: AiCommandInputValidator::integer($this->option('topic-limit'), '--topic-limit', 1),
            channelLimit: AiCommandInputValidator::integer($this->option('channel-limit'), '--channel-limit', 1),
            videoLimit: AiCommandInputValidator::integer($this->option('video-limit'), '--video-limit', 1),
            missingOnly: (bool) $this->option('missing-only'),
            execute: $execute,
        );
    } catch (InvalidArgumentException $exception) {
        $failure = [
            'mode' => $execute ? 'execute' : 'preview',
            'status' => 'blocked',
            'exit_code' => 1,
            'blocked_reason' => 'validation_failed',
            'failure_reason' => $exception->getMessage(),
            'writes' => [],
        ];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($failure, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } else {
            $this->error('reports:ai-topic:build blocked: '.$exception->getMessage());
        }

        return 1;
    }

    $exitCode = (int) $result['exit_code'];

    if ((bool) $this->option('json')) {
        $this->line(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $exitCode;
    }

    $this->line(sprintf(
        'reports:ai-topic:build mode=%s status=%s from=%s to=%s condition=%s type=%s pk=%s rows=%d updated=%d would_update=%d unchanged=%d skipped=%d failed=%d truncated=%s blocked_reason=%s',
        $result['mode'],
        $result['status'],
        $result['from'],
        $result['to'],
        $result['condition'],
        $result['data_type'],
        $result['pk'] === null ? 'none' : (string) $result['pk'],
        $result['selected_rows'],
        $result['updated'],
        $result['would_update'],
        $result['unchanged'],
        $result['skipped'],
        $result['failed_rows'],
        ($result['source_truncated'] ?? false) ? 'yes' : 'no',
        $result['blocked_reason'] ?? 'none',
    ));

    foreach (array_slice($result['rows'], 0, 40) as $row) {
        $this->line(sprintf(
            '%s pk=%d condition=%s type=%s status=%s topics=%d channels=%d videos=%d reason=%s',
            $row['date'],
            $row['pk'],
            $row['condition'],
            $row['data_type'],
            $row['status'],
            $row['topic_count'],
            $row['channel_count'],
            $row['video_count'],
            $row['blocked_reason'] ?? 'none',
        ));
    }

    return $exitCode;
})->purpose('Project legacy api_topic.php topic/video statistics from urt_ai_date.result_json into the data_json/video_json cache; preview by default and manual only');

$guardedIngestionCommand('reports:group-view:build {--group=六都市長候選人 : Legacy group name, a tag_group group_name or a tags_* configured set} {--view=politician : Legacy comparison view name} {--days=30 : Aggregation day count, max 90} {--tags= : Optional explicit comma-separated keyword override, max 600} {--tag-limit=600 : Keyword cap, max 600} {--execute : Write the urt_show_group.the_result cache row} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (GroupViewCacheBuilder $builder) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $tags = collect(explode(',', (string) $this->option('tags')))
        ->map(fn (string $tag): string => trim($tag))
        ->filter()
        ->values()
        ->all();
    $result = $builder->build(
        group: (string) $this->option('group'),
        view: (string) $this->option('view'),
        days: (int) $this->option('days'),
        explicitTags: $tags,
        tagLimit: (int) $this->option('tag-limit'),
        execute: $execute,
    );
    $exitCode = (int) $result['exit_code'];

    if ((bool) $this->option('json')) {
        $this->line(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $exitCode;
    }

    $this->line(sprintf(
        'reports:group-view:build mode=%s status=%s group=%s view=%s days=%d tags=%d groups=%d source_rows=%d action=%s blocked_reason=%s',
        $result['mode'],
        $result['status'],
        $result['group'],
        $result['view'],
        $result['days'],
        $result['tag_count'] ?? 0,
        $result['group_count'] ?? 0,
        $result['source_rows'] ?? 0,
        $result['action'] ?? 'none',
        $result['blocked_reason'] ?? 'none',
    ));

    return $exitCode;
})->purpose('Project the legacy api/group_view.php comparison payload from local urt_show_tag_date rows into urt_show_group; preview by default and manual only');

$guardedIngestionCommand('reports:tag-cloud:build {--tagid= : Comma-separated required channel tag ids, max 50} {--or= : Comma-separated OR channel tag ids, max 50} {--not= : Comma-separated excluded channel tag ids, max 50} {--days=1,3,7,30,90 : Comma-separated period list, max 10} {--channel-limit=1000 : Matched source channel scan cap, max 5000} {--video-limit=50000 : Raw video scan cap per period, max 100000} {--keyword-limit=5000 : Local keyword source scan cap, max 20000} {--keywords= : Optional comma-separated keyword subset, max 500} {--execute : Write urt_show_tag_cloud rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (TagCloudCacheBuilder $builder) {
    $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    $now = CarbonImmutable::now($timezone);
    $tagIds = collect(explode(',', (string) $this->option('tagid')))
        ->map(fn (string $id): int => (int) trim($id))
        ->filter(fn (int $id): bool => $id > 0)
        ->values()
        ->all();

    if ($tagIds === []) {
        $this->error('reports:tag-cloud:build requires --tagid');

        return 1;
    }

    $ids = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
        ->map(fn (string $id): int => (int) trim($id))
        ->filter(fn (int $id): bool => $id > 0)
        ->values()
        ->all();
    $keywords = collect(explode(',', (string) $this->option('keywords')))
        ->map(fn (string $keyword): string => trim($keyword))
        ->filter(fn (string $keyword): bool => $keyword !== '')
        ->values()
        ->all();
    $daysList = collect(explode(',', (string) $this->option('days')))
        ->map(fn (string $d): int => max(1, min(365, (int) trim($d))))
        ->unique()
        ->values()
        ->all();

    $payload = $builder->buildMany(
        tagIds: $tagIds,
        daysList: $daysList,
        orTagIds: $ids('or'),
        notTagIds: $ids('not'),
        keywordLimit: (int) $this->option('keyword-limit'),
        onlyKeywords: $keywords,
        channelLimit: (int) $this->option('channel-limit'),
        videoLimit: (int) $this->option('video-limit'),
        execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
        now: $now,
    );

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return (int) $payload['exit_code'];
    }

    $this->line(sprintf(
        'reports:tag-cloud:build mode=%s status=%s tagid=%s days=%s rows=%d writes=%d source_complete=%s truncated=%s caps=periods:%d,channels:%d,videos:%d,keywords:%d blocked_reason=%s',
        $payload['mode'],
        $payload['status'],
        implode(',', $tagIds),
        implode(',', $daysList),
        count($payload['rows']),
        $payload['writes'],
        $payload['source_complete'] ? 'yes' : 'no',
        $payload['source_truncated'] ? 'yes' : 'no',
        $payload['caps']['periods'],
        $payload['caps']['channel_scan'],
        $payload['caps']['video_scan_per_period'],
        $payload['caps']['keyword_scan'],
        $payload['blocked_reason'] ?? 'none',
    ));

    foreach ($payload['rows'] as $row) {
        $this->line(sprintf(
            'days=%d status=%s channels=%d videos=%d tags=%d views=%d writes=%d truncated=%s blocked_reason=%s',
            $row['days'],
            $row['status'],
            $row['channels_matched'],
            $row['videos_scanned'],
            $row['tags_count'],
            $row['total_views'],
            $row['writes'],
            $row['source_truncated'] ? 'yes' : 'no',
            $row['blocked_reason'] ?? 'none',
        ));
    }

    return (int) $payload['exit_code'];
})->purpose('Build urt_show_tag_cloud rows from local videos and tags; dry-run by default');

$guardedIngestionCommand('reports:channel-cloud:build {--u_id= : Comma-separated channel u_id values, max 500} {--channel= : Alias for --u_id} {--days=1,3,7,30,90 : Comma-separated period list, max 10} {--limit=50 : Channel target cap when --u_id is omitted, max 500} {--offset=0 : Recent-channel target cursor, or auto for time-rotated scheduled batches} {--recent-days=14 : Recent video window when --u_id is omitted} {--video-limit=10000 : Raw video scan cap per channel/period, max 100000} {--keyword-limit=5000 : Local keyword source scan cap, max 20000} {--keywords= : Optional comma-separated keyword subset, max 500} {--execute : Write urt_show_cloud rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (ChannelCloudCacheBuilder $builder) {
    $idsOption = collect([$this->option('u_id'), $this->option('channel')])
        ->map(fn (mixed $value): string => trim((string) $value))
        ->first(fn (string $value): bool => $value !== '', '');
    $uIds = collect(explode(',', $idsOption))
        ->map(fn (string $id): int => (int) trim($id))
        ->filter(fn (int $id): bool => $id > 0)
        ->values()
        ->all();
    $daysList = collect(explode(',', (string) $this->option('days')))
        ->map(fn (string $days): int => max(1, min(365, (int) trim($days))))
        ->filter(fn (int $days): bool => $days > 0)
        ->unique()
        ->values()
        ->all();
    $keywords = collect(explode(',', (string) $this->option('keywords')))
        ->map(fn (string $keyword): string => trim($keyword))
        ->filter(fn (string $keyword): bool => $keyword !== '')
        ->values()
        ->all();

    $payload = $builder->buildMany(
        uIds: $uIds,
        daysList: $daysList,
        limit: (int) $this->option('limit'),
        recentDays: (int) $this->option('recent-days'),
        keywordLimit: (int) $this->option('keyword-limit'),
        onlyKeywords: $keywords,
        videoLimit: (int) $this->option('video-limit'),
        offset: (string) $this->option('offset'),
        execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
        now: CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'))),
    );

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return (int) ($payload['exit_code'] ?? 0);
    }

    $this->line(sprintf(
        'reports:channel-cloud:build mode=%s status=%s channels=%d/%d offset=%d(%s) next_offset=%d wrapped=%s days=%s rows=%d writes=%d source_complete=%s source_truncated=%s selection_truncated=%s caps=channels:%d,periods:%d,videos:%d,keywords:%d blocked_reason=%s',
        $payload['mode'],
        $payload['status'],
        $payload['channels_selected'],
        $payload['channel_selection_candidates'],
        $payload['channel_selection_offset'],
        $payload['channel_selection_offset_mode'],
        $payload['channel_selection_next_offset'],
        $payload['channel_selection_wrapped'] ? 'yes' : 'no',
        implode(',', $payload['days_list']),
        count($payload['rows']),
        $payload['writes'],
        $payload['source_complete'] ? 'yes' : 'no',
        $payload['source_truncated'] ? 'yes' : 'no',
        $payload['channel_selection_truncated'] ? 'yes' : 'no',
        $payload['caps']['explicit_channels'],
        $payload['caps']['periods'],
        $payload['caps']['video_scan_per_channel_period'],
        $payload['caps']['keyword_scan'],
        $payload['blocked_reason'] ?? 'none',
    ));

    foreach ($payload['rows'] as $row) {
        $this->line(sprintf(
            'u_id=%d days=%d status=%s videos=%d keywords=%d tags=%d views=%d writes=%d truncated=%s blocked_reason=%s',
            $row['u_id'],
            $row['days'],
            $row['status'],
            $row['count_videos'],
            $row['keywords_count'],
            $row['count_tags'],
            $row['total_views'],
            $row['writes'],
            $row['source_truncated'] ? 'yes' : 'no',
            $row['blocked_reason'] ?? 'none',
        ));
    }

    return (int) ($payload['exit_code'] ?? 0);
})->purpose('Build urt_show_cloud channel word-cloud rows from local videos and tags; dry-run by default');

Artisan::command('youtube:videos:duration {--videoId= : Optional queued video id to preview} {--batch-size=50 : Legacy batch size, capped at 50} {--limit= : Alias for --batch-size when running limited smoke checks} {--loops=1 : Number of batches to preview} {--enqueue-missing : With --execute, create duration queue rows from existing urt_video when missing} {--execute : Call YouTube and write selected video durations to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (VideoDurationsPreview $preview, VideoDurationsIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Dry-run preview of legacy video duration refresh queue, with explicit local-only --execute support');

Artisan::command('youtube:videos:stats {--videoId= : Optional video id to preview through the legacy single-video branch} {--today : Preview the legacy today/missing-viewCount branch from urt_video} {--batch-size=50 : Legacy batch size, capped at 50} {--limit= : Alias for --batch-size when running limited smoke checks} {--loops=1 : Number of batches to preview, capped at the legacy loop count} {--execute : Call YouTube and write selected video statistics to local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (VideoStatisticsPreview $preview, VideoStatisticsIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Dry-run preview of legacy video statistics refresh queue, with explicit local-only --execute support');

$guardedIngestionCommand('reports:counts:build {--id= : Optional u_id to preview, matching legacy id=... behavior} {--limit=20 : Number of changed preview rows to print/update} {--execute : Update selected urt_count delta columns} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (ChannelCountsPreview $preview) {
    $uId = $this->option('id') !== null ? max(1, (int) $this->option('id')) : null;
    $limit = max(1, min(100, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(
            uId: $uId,
            limit: $limit,
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:counts:build mode=%s candidates=%d with_logs=%d missing_logs=%d would_update=%d updated=%d unchanged=%d date=%s generated_at=%s writes=%d',
            $payload['mode'],
            $payload['candidates'],
            $payload['with_logs'],
            $payload['missing_logs'],
            $payload['would_update'],
            $payload['updated'],
            $payload['unchanged'],
            $payload['date'],
            $payload['generated_at'],
            count($payload['writes']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $computed = $row['computed'];
            $this->line(sprintf(
                '#%d u_id=%d view_week=%d sub_week=%d video_week=%d view_month=%d sub_month=%d video_month=%d',
                $index + 1,
                $row['u_id'],
                $computed['view_week'],
                $computed['sub_week'] ?? 0,
                $computed['video_week'],
                $computed['view_month'],
                $computed['sub_month'] ?? 0,
                $computed['video_month'],
            ));
        }

        return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
    } catch (QueryException $exception) {
        $this->error('reports:counts:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Preview or execute legacy channel weekly/monthly count delta updates');

$guardedIngestionCommand('reports:channel-predictions:build {--u_id= : Optional channel u_id} {--limit=20 : Number of channels to process, capped at 100} {--offset=0 : Channel offset for bounded manual pagination} {--execute : Update selected urt_count prediction columns} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (ChannelPredictionIngestion $ingestion) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $uId = $this->option('u_id');
    $payload = $ingestion->run(
        uId: $uId !== null ? (int) $uId : null,
        limit: (int) $this->option('limit'),
        execute: $execute,
        offset: (int) $this->option('offset'),
    );
    $failed = (int) $payload['failed'] > 0
        || ($execute && (! (bool) $payload['available'] || ($payload['blocked_reason'] ?? null) !== null));

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $failed ? 1 : 0;
    }

    $this->line(sprintf(
        'reports:channel-predictions:build mode=%s available=%s candidates=%d/%d would_update=%d updated=%d unchanged=%d skipped=%d failed=%d blocked_reason=%s generated_at=%s',
        $payload['mode'],
        $payload['available'] ? 'yes' : 'no',
        $payload['candidates'],
        $payload['candidate_total'],
        $payload['would_update'],
        $payload['updated'],
        $payload['unchanged'],
        $payload['skipped'],
        $payload['failed'],
        $payload['blocked_reason'] ?? '-',
        $payload['generated_at'],
    ));

    foreach ($payload['rows'] as $index => $row) {
        $this->line(sprintf(
            '#%d u_id=%d status=%s reason=%s logs=%d invalid_logs=%d valid_points=%d week=%s month=%s',
            $index + 1,
            $row['u_id'],
            $row['status'],
            $row['reason'] ?? '-',
            $row['log_rows'],
            $row['invalid_log_rows'],
            $row['valid_points'],
            is_array($row['computed']) ? (string) $row['computed']['views_pred_week'] : '-',
            is_array($row['computed']) ? (string) $row['computed']['views_pred_month'] : '-',
        ));
    }

    return $failed ? 1 : 0;
})->purpose('Preview legacy channel prediction writeback; --execute idempotently updates capped local urt_count rows');

$guardedIngestionCommand('reports:keyword-relations:build {--from= : First cache date YYYY-MM-DD; preview defaults to yesterday} {--to= : Last cache date YYYY-MM-DD; preview defaults to --from} {--keywords= : Optional comma-separated cache subjects} {--keyword-limit=100 : Keyword dictionary and subject cap, max 5000} {--video-limit=1000 : Raw video scan cap, max 10000} {--execute : Write urt_show_video_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (KeywordRelationCacheBuilder $builder) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $from = trim((string) $this->option('from'));
    $to = trim((string) $this->option('to'));

    if ($execute && ($from === '' || $to === '')) {
        $this->error('reports:keyword-relations:build unavailable: --execute requires explicit --from and --to dates');

        return 1;
    }

    $payload = $builder->build(
        from: $from !== '' ? $from : null,
        to: $to !== '' ? $to : null,
        onlyKeywords: collect(explode(',', (string) $this->option('keywords')))
            ->map(fn (string $keyword): string => trim($keyword))
            ->filter()
            ->values()
            ->all(),
        keywordLimit: (int) $this->option('keyword-limit'),
        videoLimit: (int) $this->option('video-limit'),
        execute: $execute,
    );
    $failed = (int) $payload['failed_cache_rows'] > 0
        || $payload['blocked_reason'] !== null;

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $failed ? 1 : 0;
    }

    $this->line(sprintf(
        'reports:keyword-relations:build mode=%s available=%s from=%s to=%s keywords=%d/%d videos=%d/%d truncated=%s rows=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d failed=%d blocked_reason=%s generated_at=%s',
        $payload['mode'],
        $payload['available'] ? 'yes' : 'no',
        $payload['from'],
        $payload['to'],
        $payload['keywords_selected'],
        $payload['keyword_limit'],
        $payload['videos_scanned'],
        $payload['video_limit'],
        ($payload['source_truncated'] ?? false) ? 'yes' : 'no',
        $payload['rows_planned'],
        $payload['would_insert'],
        $payload['would_update'],
        $payload['inserted'],
        $payload['updated'],
        $payload['unchanged'],
        $payload['failed_cache_rows'],
        $payload['blocked_reason'] ?? '-',
        $payload['generated_at'],
    ));

    foreach ($payload['rows'] as $index => $row) {
        $this->line(sprintf(
            '#%d tag="%s" date=%s status=%s reason=%s channels=%d videos=%d tags=%d',
            $index + 1,
            $row['tag'],
            $row['date'],
            $row['status'],
            $row['reason'] ?? '-',
            $row['count_channels'],
            $row['count_videos'],
            $row['count_tags'],
        ));
    }

    return $failed ? 1 : 0;
})->purpose('Preview or explicitly rebuild capped keyword/date relation cache rows from local videos and tags');

$guardedIngestionCommand('reports:photos:build {--tags= : Optional comma-separated subjects; defaults to capped local tags rows} {--limit=20 : Tag cap, max 100} {--refresh : Re-query subjects that already have a usable cached URL} {--execute : Fetch Wikipedia thumbnails and write urt_show_photo rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (PhotoCacheBuilder $builder) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $payload = $builder->build(
        onlyTags: collect(explode(',', (string) $this->option('tags')))
            ->map(fn (string $tag): string => trim($tag))
            ->filter()
            ->values()
            ->all(),
        limit: (int) $this->option('limit'),
        refresh: (bool) $this->option('refresh'),
        execute: $execute,
    );
    $failed = $payload['blocked_reason'] !== null || (int) $payload['failed_tags'] > 0;

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $failed ? 1 : 0;
    }

    $this->line(sprintf(
        'reports:photos:build mode=%s available=%s source=%s tags=%d/%d ignored=%d cached=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d no_image=%d failed=%d requests=%d writes=%d blocked_reason=%s generated_at=%s',
        $payload['mode'],
        $payload['available'] ? 'yes' : 'no',
        $payload['source'],
        $payload['tags_selected'],
        $payload['tag_limit'],
        $payload['tags_ignored'],
        $payload['cached'],
        $payload['would_insert'],
        $payload['would_update'],
        $payload['inserted'],
        $payload['updated'],
        $payload['unchanged'],
        $payload['skipped_no_image'],
        $payload['failed_tags'],
        $payload['external_requests'],
        $payload['writes'],
        $payload['blocked_reason'] ?? '-',
        $payload['generated_at'],
    ));

    foreach ($payload['rows'] as $index => $row) {
        $this->line(sprintf(
            '#%d tag="%s" status=%s reason=%s image_url=%s',
            $index + 1,
            $row['tag'],
            $row['status'],
            $row['reason'] ?? '-',
            $row['image_url'] ?? '-',
        ));
    }

    return $failed ? 1 : 0;
})->purpose('Preview or explicitly build capped Wikipedia thumbnail cache rows from local tags; manual only');

$guardedIngestionCommand('reports:keyword-cloud:build {--keywords= : Required comma-separated keyword cloud subjects} {--tagid= : Comma-separated required channel tag ids} {--or= : Comma-separated OR channel tag ids} {--not= : Comma-separated excluded channel tag ids} {--days=3,7,30 : Comma-separated periods, max 10 values from 1 to 365} {--subject-limit=20 : Subject cap, max 100} {--keyword-limit=5000 : Local keyword dictionary cap, max 5000} {--channel-limit=1000 : Matching channel source cap, max 5000} {--video-limit=10000 : Raw video cap per subject, max 10000} {--execute : Write urt_show_tag_cloud_tag rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (KeywordCloudCacheBuilder $builder) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $list = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
        ->map(fn (string $value): string => trim($value))
        ->filter(fn (string $value): bool => $value !== '')
        ->values()
        ->all();
    $ids = fn (string $option): array => collect($list($option))
        ->map(fn (string $value): int => (int) $value)
        ->filter(fn (int $value): bool => $value > 0)
        ->values()
        ->all();
    $payload = $builder->build(
        subjects: $list('keywords'),
        daysList: collect($list('days'))->map(fn (string $days): int => (int) $days)->all(),
        tagIds: $ids('tagid'),
        orTagIds: $ids('or'),
        notTagIds: $ids('not'),
        subjectLimit: (int) $this->option('subject-limit'),
        keywordLimit: (int) $this->option('keyword-limit'),
        channelLimit: (int) $this->option('channel-limit'),
        videoLimit: (int) $this->option('video-limit'),
        execute: $execute,
    );
    $failed = $payload['blocked_reason'] !== null || (int) $payload['failed_cache_rows'] > 0;

    if ((bool) $this->option('json')) {
        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return $failed ? 1 : 0;
    }

    $this->line(sprintf(
        'reports:keyword-cloud:build mode=%s available=%s subjects=%d/%d days=%s channels=%d/%d keywords=%d/%d videos=%d/%d-per-subject truncated=%s rows=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d failed=%d blocked_reason=%s generated_at=%s',
        $payload['mode'],
        $payload['available'] ? 'yes' : 'no',
        $payload['subjects_selected'],
        $payload['subject_limit'],
        implode(',', $payload['days_list']),
        $payload['channels_matched'],
        $payload['channel_limit'],
        $payload['keywords_selected'],
        $payload['keyword_limit'],
        $payload['videos_scanned'],
        $payload['video_limit_per_subject'],
        ($payload['source_truncated'] ?? false) ? 'yes' : 'no',
        $payload['rows_planned'],
        $payload['would_insert'],
        $payload['would_update'],
        $payload['inserted'],
        $payload['updated'],
        $payload['unchanged'],
        $payload['failed_cache_rows'],
        $payload['blocked_reason'] ?? '-',
        $payload['generated_at'],
    ));

    foreach ($payload['rows'] as $index => $row) {
        $this->line(sprintf(
            '#%d tag="%s" days=%d status=%s reason=%s channels=%d videos=%d tags=%d/%d',
            $index + 1,
            $row['tag'],
            $row['days'],
            $row['status'],
            $row['reason'] ?? '-',
            $row['count_channels'],
            $row['count_videos'],
            $row['count_tags'],
            $row['tags_count'],
        ));
    }

    return $failed ? 1 : 0;
})->purpose('Preview or explicitly rebuild capped keyword cloud cache rows from local videos and tags');

$guardedIngestionCommand('reports:keywords:build {--limit=20 : Maximum keyword rows to preview or write per source batch} {--offset=0 : Remote source cursor offset, or auto for time-rotated scheduled batches} {--recent-days=7 : Window for keyword_all preview, matching legacy weekly freshness} {--hours=2 : 新文易數 tag.analysis.tw lookback hours for execute sync} {--execute : Fetch tag.analysis.tw keyword JSON and upsert local tags} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (KeywordReportsPreview $preview) {
    $limit = max(1, min(100, (int) $this->option('limit')));
    $recentDays = max(1, min(30, (int) $this->option('recent-days')));

    try {
        $payload = $preview->preview(
            limit: $limit,
            recentDays: $recentDays,
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            hours: (int) $this->option('hours'),
            offset: (string) $this->option('offset'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:keywords:build mode=%s source_tags=%d source_complete=%s source_truncated=%s synced=%d failed=%d eligible_keywords=%d recent_keywords=%d recent_since=%s generated_at=%s writes=%d',
            $payload['mode'],
            $payload['source_tags'],
            $payload['source_complete'] ? 'yes' : 'no',
            $payload['source_truncated'] ? 'yes' : 'no',
            $payload['synced_rows'],
            $payload['failed_rows'],
            $payload['eligible_keywords'],
            $payload['recent_keywords'],
            $payload['recent_since'],
            $payload['generated_at'],
            count($payload['writes']),
        ));
        $this->line(sprintf(
            'sync candidates=%d attempted=%d offset=%d offset_mode=%s next_offset=%d wrapped=%s source_truncated=%s blocked_reason=%s',
            $payload['sync_candidates'],
            $payload['sync_attempted'],
            $payload['sync_offset'],
            $payload['sync_offset_mode'],
            $payload['sync_next_offset'],
            $payload['sync_batch_wrapped'] ? 'yes' : 'no',
            $payload['sync_source_truncated'] ? 'yes' : 'no',
            $payload['blocked_reason'] ?? '-',
        ));
        $this->line(sprintf(
            'excluded no_tag=%d single_char=%d numeric=%d short_ascii=%d targets=%s',
            $payload['excluded']['no_tag'],
            $payload['excluded']['single_char'],
            $payload['excluded']['numeric'],
            $payload['excluded']['short_ascii'],
            implode(',', $payload['filesystem_targets']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s weight=%s max_count=%d hours_count=%d recent=%s mtime=%s',
                $index + 1,
                $row['tag'],
                $row['legacy_weight'],
                $row['max_count'],
                $row['hours_count'],
                $row['included_in_keyword_all'] ? 'yes' : 'no',
                $row['mtime'],
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('reports:keywords:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    } catch (RuntimeException $exception) {
        $this->line('reports:keywords:build execute unavailable: failure=external_sync_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Build bounded keyword rankings from Laravel local data; optional legacy external sync requires an explicit environment gate');

$guardedIngestionCommand('reports:keywords:cache {--execute : Write the rebuilt tags_all cache to local DB} {--dry-run : Force preview mode; this is the default} {--days=31 : Calendar-day window to aggregate, matching legacy tags_all.php} {--recent-days=7 : Recent window used for video/views metrics; legacy includes today plus this many previous days} {--keyword-limit=1000 : Ranked keyword source scan cap, max 10000} {--video-limit=50000 : Raw video source scan cap, max 200000} {--json : Emit JSON instead of text}', function (TagsAllCacheBuilder $builder) {
    $days = max(1, min(90, (int) $this->option('days')));
    $recentDays = max(1, min($days, (int) $this->option('recent-days')));
    $keywordLimit = max(1, min(10000, (int) $this->option('keyword-limit')));
    $videoLimit = max(1, min(200000, (int) $this->option('video-limit')));
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');

    try {
        $payload = $builder->build(
            days: $days,
            recentDays: $recentDays,
            keywordLimit: $keywordLimit,
            videoLimit: $videoLimit,
            execute: $execute,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:keywords:cache mode=%s status=%s days=%d recent_days=%d keyword_limit=%d video_limit=%d videos_scanned=%d tags_with_metrics=%d writes=%d source_complete=%s truncated=%s blocked_reason=%s',
            $payload['mode'],
            $payload['status'],
            $days,
            $recentDays,
            $keywordLimit,
            $videoLimit,
            $payload['videos_scanned'],
            $payload['tags_with_metrics'],
            $payload['writes'],
            $payload['source_complete'] ? 'yes' : 'no',
            $payload['source_truncated'] ? 'yes' : 'no',
            $payload['blocked_reason'] ?? 'none',
        ));
        $this->line('write_targets='.implode('; ', $payload['write_targets']));
        $this->line(sprintf(
            'source=local_db legacy=api/tags_all.php force=1 external_api=none categories=%s generated_at=%s',
            implode(',', $payload['category_tags']),
            $payload['generated_at'],
        ));

        foreach ($payload['sample'] as $tag => $metrics) {
            $this->line(sprintf(
                '%s video=%d views=%d video_all=%d views_all=%d',
                $tag,
                $metrics['video'],
                $metrics['views'],
                $metrics['video_all'],
                $metrics['views_all'],
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('reports:keywords:cache unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Rebuild legacy urt_show_data.tags_all keyword metric cache from local videos; dry-run by default');

$guardedIngestionCommand('reports:people:build {--group=政治人物 : tag_group group_name to preview} {--tagid=13 : Legacy tagid filter passed to tag_period.php} {--days=37 : Legacy period length passed to tag_period.php} {--limit=20 : Number of people tags to print/build} {--offset=0 : People tag offset, or auto for scheduler rotation} {--keyword-limit=5000 : Number of local keywords to scan when building tag-date cache} {--execute : Build selected local people tag-date cache rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (PeopleReportsPreview $preview) {
    $groupName = trim((string) $this->option('group')) ?: '政治人物';
    $tagId = max(1, (int) $this->option('tagid'));
    $days = max(1, min(365, (int) $this->option('days')));
    $limit = max(1, min(200, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(
            groupName: $groupName,
            tagId: $tagId,
            days: $days,
            limit: $limit,
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            keywordLimit: (int) $this->option('keyword-limit'),
            offset: (string) $this->option('offset'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:people:build mode=%s group="%s" candidates=%d latest_time=%s tagid=%d days=%d cache_writes=%d failed=%d generated_at=%s writes=%d',
            $payload['mode'],
            $payload['group_name'],
            $payload['candidates'],
            $payload['latest_time'] ?? 'n/a',
            $payload['tagid'],
            $payload['days'],
            $payload['cache_writes'],
            $payload['failed_rows'],
            $payload['generated_at'],
            count($payload['writes']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s latest_time=%s preview="%s"',
                $index + 1,
                $row['tag'],
                $row['latest_time'],
                $row['modern_api_preview'],
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('reports:people:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Preview or execute legacy political-people tag-date cache generation from local DB');

$guardedIngestionCommand('reports:groups:build {--group= : Preview one tag_group group_name} {--hours=22 : 新文易數 tag.analysis.tw lookback parameter} {--limit=20 : Maximum group rows to preview or write per source batch} {--offset=0 : Remote source cursor offset, or auto for time-rotated scheduled batches} {--execute : Fetch tag.analysis.tw group JSON and upsert local tag_group} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (GroupReportsPreview $preview) {
    try {
        $payload = $preview->preview(
            groupName: $this->option('group') ? (string) $this->option('group') : null,
            hours: (int) $this->option('hours'),
            limit: (int) $this->option('limit'),
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            offset: (string) $this->option('offset'),
        );

        if ($this->option('json')) {
            $this->line(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:groups:build mode=%s groups=%d tag_rows=%d synced=%d failed=%d active_rows=%d deleted_rows=%d latest_time=%s hours=%d generated_at=%s writes=%d',
            $payload['mode'],
            $payload['group_count'],
            $payload['tag_rows'],
            $payload['synced_rows'],
            $payload['failed_rows'],
            $payload['active_rows'],
            $payload['deleted_rows'],
            $payload['latest_time'] ?? '-',
            $payload['hours'],
            $payload['generated_at'],
            count($payload['writes']),
        ));
        $this->line(sprintf(
            'sync candidates=%d attempted=%d offset=%d offset_mode=%s next_offset=%d wrapped=%s source_truncated=%s',
            $payload['sync_candidates'],
            $payload['sync_attempted'],
            $payload['sync_offset'],
            $payload['sync_offset_mode'],
            $payload['sync_next_offset'],
            $payload['sync_batch_wrapped'] ? 'yes' : 'no',
            $payload['sync_source_truncated'] ? 'yes' : 'no',
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s active=%d deleted=%d total=%d latest_time=%s',
                $index + 1,
                $row['group_name'],
                $row['active_rows'],
                $row['deleted_rows'],
                $row['tag_rows'],
                $row['latest_time'] ?? '-',
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('reports:groups:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    } catch (RuntimeException $exception) {
        $this->line('reports:groups:build execute unavailable: failure=external_sync_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Report Laravel local tag_group state; optional legacy external sync requires an explicit environment gate');

$guardedIngestionCommand('reports:schedule:build {--videoId= : Preview one scheduled video} {--hours=1 : Lookback window for recently refreshed schedule rows} {--limit=20 : Number of schedule rows to print/update} {--execute : Update selected urt_video_schedule stime rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}', function (ScheduleReportsPreview $preview) {
    try {
        $payload = $preview->preview(
            videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
            hours: (int) $this->option('hours'),
            limit: (int) $this->option('limit'),
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
        );

        if ($this->option('json')) {
            $this->line(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:schedule:build mode=%s candidates=%d with_history=%d missing_history=%d would_update=%d updated=%d window_start=%s generated_at=%s writes=%d',
            $payload['mode'],
            $payload['candidates'],
            $payload['with_history'],
            $payload['missing_history'],
            $payload['would_update'],
            $payload['updated'],
            $payload['window_start'],
            $payload['generated_at'],
            count($payload['writes']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s views_delta=%d views_per_hour=%.3f current_stime=%s estimated_stime=%s cap=%s',
                $index + 1,
                $row['video_id'],
                $row['view_delta'],
                $row['views_per_hour'],
                $row['current_stime'] ?? '-',
                $row['estimated_stime'],
                $row['cap'],
            ));
        }

        return ($payload['failed_rows'] ?? 0) > 0 ? 1 : 0;
    } catch (QueryException $exception) {
        $this->error('reports:schedule:build unavailable: failure=query_failed exception_class='.$exception::class.' secrets=not_printed');

        return 1;
    }
})->purpose('Preview or execute legacy schedule stime recalculation updates');

$guardedIngestionCommand('ai:channel {u_id : Channel u_id} {--from= : Required start date in YYYY-MM-DD} {--to= : Optional end date; defaults to --from} {--type=auto : auto, oneday, or todate} {--limit=120 : Max videos included in the prompt, capped at 500} {--execute : Call the configured AI provider and upsert urt_channel_ai} {--dry-run : Force preview mode} {--user-token=CLI : user_token value for execute-mode upsert} {--json : Emit JSON instead of text}', function (ChannelAiIngestion $ingestion) {
    $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
    $from = trim((string) $this->option('from'));

    if ($from === '') {
        $this->error('ai:channel unavailable: --from=YYYY-MM-DD is required for explicit operator intent');

        return 1;
    }

    try {
        $arguments = [
            'uId' => AiCommandInputValidator::integer($this->argument('u_id'), 'u_id', 1),
            'from' => AiCommandInputValidator::date($from, '--from'),
            'to' => is_string($this->option('to'))
                ? AiCommandInputValidator::date((string) $this->option('to'), '--to')
                : null,
            'dataType' => (string) $this->option('type'),
            'limit' => AiCommandInputValidator::integer($this->option('limit'), '--limit', 1),
        ];
        $payload = $execute
            ? $ingestion->execute(...$arguments, userToken: (string) $this->option('user-token'))
            : $ingestion->preview(...$arguments);
        $failed = $execute && (
            (bool) ($payload['failed'] ?? false)
            || (int) ($payload['exit_code'] ?? 0) !== 0
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed ? 1 : 0;
        }

        $this->line(sprintf(
            'ai:channel mode=%s u_id=%d from=%s to=%s type=%s source_videos=%d prompt_videos=%d video_limit=%d prompt_chars=%d would_call_ai=%s inserted=%s updated=%s skipped=%s reason=%s secrets=not_printed',
            $payload['mode'],
            $payload['u_id'],
            $payload['date_from'],
            $payload['date_to'],
            $payload['data_type'],
            $payload['source_video_rows'],
            $payload['prompt_video_rows'],
            $payload['video_limit'],
            $payload['prompt_chars'],
            ($payload['would_call_ai'] ?? false) ? 'yes' : 'no',
            ($payload['inserted'] ?? false) ? 'yes' : 'no',
            ($payload['updated'] ?? false) ? 'yes' : 'no',
            ($payload['skipped'] ?? false) ? 'yes' : 'no',
            $payload['skip_reason'] ?? '-',
        ));

        if ($execute && ! ($payload['skipped'] ?? false)) {
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');
            $this->line('write_targets='.implode(',', $payload['write_targets']));
        }

        return $failed ? 1 : 0;
    } catch (Throwable $exception) {
        $this->error('ai:channel unavailable: '.SensitiveTextRedactor::exception($exception, 240).' secrets=not_printed');

        return 1;
    }
})->purpose('Preview or explicitly generate one channel AI cache row for a reviewed date range');

$guardedIngestionCommand('ai:daily {--date= : Legacy date, today, or yesterday; defaults to yesterday in Asia/Taipei} {--condition= : Optional single legacy condition; default previews make_ai_day.sh conditions} {--type=oneday : Legacy urt_channel_ai data_type} {--limit=1000 : Max channel AI rows per condition} {--channel-limit=39 : Max configured channels to refresh in execute mode} {--channel-offset=0 : Eligible configured channels to skip before refresh} {--channel-batch-size=0 : Refresh selected channels in chunks; 0 uses one batch} {--ai-call-limit=45 : Max logical AI completion chains; provider attempts within each chain are separately bounded} {--channel-video-limit=120 : Max videos in each channel prompt, hard max 500; 0 also uses 500} {--execute : Call the configured AI provider chain and upsert urt_channel_ai/urt_ai_date} {--dry-run : Force dry-run preview} {--user-token=CLI : user_token value for execute-mode upserts} {--json : Emit JSON instead of text}', function (AiDailyPreview $preview, AiDailyIngestion $ingestion) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $limit = AiCommandInputValidator::integer($this->option('limit'), '--limit', 1);
        $channelLimit = AiCommandInputValidator::integer($this->option('channel-limit'), '--channel-limit');
        $channelOffset = AiCommandInputValidator::integer($this->option('channel-offset'), '--channel-offset');
        $channelBatchSize = AiCommandInputValidator::integer($this->option('channel-batch-size'), '--channel-batch-size');
        $aiCallLimit = AiCommandInputValidator::integer($this->option('ai-call-limit'), '--ai-call-limit');
        $channelVideoLimit = AiCommandInputValidator::integer($this->option('channel-video-limit'), '--channel-video-limit');

        if ($execute) {
            $payload = $ingestion->execute(
                date: is_string($this->option('date')) ? (string) $this->option('date') : null,
                condition: is_string($this->option('condition')) ? (string) $this->option('condition') : null,
                dataType: (string) $this->option('type'),
                limit: $limit,
                channelLimit: $channelLimit,
                channelOffset: $channelOffset,
                channelBatchSize: $channelBatchSize,
                aiCallLimit: $aiCallLimit,
                channelVideoLimit: $channelVideoLimit,
                userToken: (string) $this->option('user-token'),
            );
            $failed = (int) $payload['channel_ai']['failed'] + (int) $payload['daily_ai']['failed'];

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return $failed > 0 ? 1 : 0;
            }

            $this->line(sprintf(
                'ai:daily mode=execute source=%s date=%s type=%s conditions=%d channel_limit=%d channel_offset=%d channel_batch_size=%d channel_batches=%d channel_video_limit=%d requested_video_limit=%d video_limit_clamped=%s prompt_truncated_channels=%d omitted_video_rows=%d ai_chain_limit=%d ai_chains_used=%d provider_attempts_per_chain_limit=%d provider_request_limit=%d provider_requests_used=%d channel_attempted=%d channel_inserted=%d channel_updated=%d channel_skipped=%d channel_failed=%d daily_attempted=%d daily_inserted=%d daily_updated=%d daily_skipped=%d daily_failed=%d secrets=not_printed generated_at=%s',
                $payload['source'],
                $payload['date'],
                $payload['data_type'],
                count($payload['conditions']),
                $payload['channel_ai']['limit'],
                $payload['channel_ai']['offset'],
                $payload['channel_ai']['batch_size'],
                $payload['channel_ai']['batches'],
                $payload['channel_ai']['video_limit'],
                $payload['channel_ai']['video_limit_requested'],
                $payload['channel_ai']['video_limit_clamped'] ? 'yes' : 'no',
                $payload['channel_ai']['prompt_truncated_channels'],
                $payload['channel_ai']['prompt_omitted_video_rows'],
                $payload['ai_call_guard']['limit'],
                $payload['ai_call_guard']['used'],
                $payload['ai_call_guard']['provider_attempts_per_chain_limit'],
                $payload['ai_call_guard']['provider_request_limit'],
                $payload['ai_call_guard']['provider_requests_used'],
                $payload['channel_ai']['attempted'],
                $payload['channel_ai']['inserted'],
                $payload['channel_ai']['updated'],
                $payload['channel_ai']['skipped'],
                $payload['channel_ai']['failed'],
                $payload['daily_ai']['attempted'],
                $payload['daily_ai']['inserted'],
                $payload['daily_ai']['updated'],
                $payload['daily_ai']['skipped'],
                $payload['daily_ai']['failed'],
                $payload['generated_at'],
            ));
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');
            $this->line('write_targets='.implode(',', $payload['write_targets']));

            return $failed > 0 ? 1 : 0;
        }

        $payload = $preview->preview(
            date: is_string($this->option('date')) ? (string) $this->option('date') : null,
            condition: is_string($this->option('condition')) ? (string) $this->option('condition') : null,
            dataType: (string) $this->option('type'),
            limit: $limit,
            channelLimit: $channelLimit,
            channelOffset: $channelOffset,
            channelBatchSize: $channelBatchSize,
            aiCallLimit: $aiCallLimit,
            channelVideoLimit: $channelVideoLimit,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $existingAiDateRows = collect($payload['condition_rows'])->sum('existing_ai_date_rows');

        $this->line(sprintf(
            'ai:daily mode=ingestion-preview source=%s date=%s type=%s conditions=%d channel_refresh_attempts=%d channel_refresh_candidates=%d prompt_source_rows=%d prompt_media_rows=%d prompt_event_rows=%d prompt_video_refs=%d existing_ai_date_rows=%d would_call_ai_requests=%d would_insert_ai_date_rows=%d generated_at=%s writes=0 api_call=skipped ai_date_insert=skipped channel_ai_insert=skipped',
            $payload['source'],
            $payload['date'],
            $payload['data_type'],
            count($payload['conditions']),
            $payload['channel_ai_refresh']['would_attempt_channel_ai_refresh'],
            $payload['channel_ai_refresh']['would_insert_channel_ai_candidates'],
            $payload['total_prompt_source_rows'],
            $payload['total_prompt_media_rows'],
            $payload['total_prompt_event_rows'],
            $payload['total_prompt_video_refs'],
            $existingAiDateRows,
            $payload['would_call_ai_requests'],
            $payload['would_insert_ai_date_rows'],
            $payload['generated_at'],
        ));

        $this->line(sprintf(
            'channel_ai_refresh configured=%d existing_channels=%d existing_channel_ai_rows=%d min_videos=%d data_type=%s',
            $payload['channel_ai_refresh']['configured_channels'],
            $payload['channel_ai_refresh']['existing_channels'],
            $payload['channel_ai_refresh']['existing_channel_ai_rows'],
            $payload['channel_ai_refresh']['minimum_video_rows_per_channel'],
            $payload['channel_ai_refresh']['data_type'],
        ));

        foreach ($payload['condition_rows'] as $row) {
            $matchingChannels = $row['matching_channels'] === null ? 'all' : (string) $row['matching_channels'];
            $this->line(sprintf(
                '# condition=%s matching_channels=%s source_rows=%d media_rows=%d events=%d video_refs=%d existing_ai_date=%d bounds=%d-%d prompt_chars=%d',
                $row['condition'],
                $matchingChannels,
                $row['source_rows'],
                $row['media_rows'],
                $row['prompt_event_rows'],
                $row['prompt_video_refs'],
                $row['existing_ai_date_rows'],
                $row['prompt_bounds']['min'],
                $row['prompt_bounds']['max'],
                $row['prompt_chars'],
            ));
        }

        return 0;
    } catch (Throwable $exception) {
        $this->error('ai:daily unavailable: '.SensitiveTextRedactor::exception($exception, 240));

        return 1;
    }
})->purpose('Ingestion preview of legacy daily AI summary generation; execute mode calls AI and upserts urt_channel_ai/urt_ai_date rows');

$guardedIngestionCommand('ai:daily:pipeline {--date=yesterday : Date, today, or yesterday} {--limit=1000 : Max channel AI rows per condition} {--channel-limit=39 : Max configured channels to refresh} {--channel-batch-size=12 : Channel AI batch size} {--ai-call-limit=45 : Max logical AI completion chains; provider attempts within each chain are separately bounded} {--channel-video-limit=120 : Max videos in each channel prompt, hard max 500; 0 also uses 500} {--execute : Refresh complete YouTube sources before daily AI} {--dry-run : Preview both stages without writes} {--user-token=CLI : user_token for AI rows} {--json : Emit JSON}', function (AiScheduledPipelineIngestion $pipeline) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $limit = AiCommandInputValidator::integer($this->option('limit'), '--limit', 1);
        $channelLimit = AiCommandInputValidator::integer($this->option('channel-limit'), '--channel-limit');
        $channelBatchSize = AiCommandInputValidator::integer($this->option('channel-batch-size'), '--channel-batch-size');
        $aiCallLimit = AiCommandInputValidator::integer($this->option('ai-call-limit'), '--ai-call-limit');
        $channelVideoLimit = AiCommandInputValidator::integer($this->option('channel-video-limit'), '--channel-video-limit');
        $payload = $execute
            ? $pipeline->executeDaily(
                date: (string) $this->option('date'),
                channelLimit: $channelLimit,
                channelBatchSize: $channelBatchSize,
                aiCallLimit: $aiCallLimit,
                channelVideoLimit: $channelVideoLimit,
                limit: $limit,
                userToken: (string) $this->option('user-token'),
            )
            : $pipeline->previewDaily(
                date: (string) $this->option('date'),
                channelLimit: (int) $this->option('channel-limit'),
                channelBatchSize: (int) $this->option('channel-batch-size'),
                aiCallLimit: (int) $this->option('ai-call-limit'),
                channelVideoLimit: (int) $this->option('channel-video-limit'),
                limit: (int) $this->option('limit'),
            );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'ai:daily:pipeline mode=%s date=%s source_succeeded=%s source_channels=%d source_failed=%d ai_status=%s limit=%d channel_limit=%d channel_batch_size=%d ai_call_limit=%d ai_calls=%d channel_video_limit=%d prompt_truncated_channels=%d omitted_video_rows=%d reason=%s secrets=not_printed',
            $payload['mode'],
            $payload['date'],
            data_get($payload, 'source_refresh.succeeded', false) ? 'yes' : 'no',
            (int) data_get($payload, 'source_refresh.completed_channels', 0),
            (int) data_get($payload, 'source_refresh.failed_channels', 0),
            (string) data_get($payload, 'ai.status', data_get($payload, 'ai.skip_reason', 'preview')),
            (int) data_get($payload, 'execution_caps.limit', $this->option('limit')),
            (int) data_get($payload, 'execution_caps.channel_limit', data_get($payload, 'ai.channel_ai.limit', $this->option('channel-limit'))),
            (int) data_get($payload, 'execution_caps.channel_batch_size', data_get($payload, 'ai.channel_ai.batch_size', $this->option('channel-batch-size'))),
            (int) data_get($payload, 'execution_caps.ai_call_limit', data_get($payload, 'ai.ai_call_guard.limit', $this->option('ai-call-limit'))),
            (int) data_get($payload, 'ai.ai_call_guard.used', 0),
            (int) data_get($payload, 'execution_caps.channel_video_limit', data_get($payload, 'ai.channel_ai.video_limit', $this->option('channel-video-limit'))),
            (int) data_get($payload, 'ai.channel_ai.prompt_truncated_channels', 0),
            (int) data_get($payload, 'ai.channel_ai.prompt_omitted_video_rows', 0),
            (string) data_get($payload, 'source_refresh.failure_reason', '-'),
        ));

        return (int) ($payload['exit_code'] ?? 0);
    } catch (Throwable $exception) {
        $this->error('ai:daily:pipeline unavailable: '.SensitiveTextRedactor::exception($exception, 240).' secrets=not_printed');

        return 1;
    }
})->purpose('Refresh complete previous-day YouTube sources, then generate channel and daily AI only after source success');

$guardedIngestionCommand('ai:mayor-person {--city=taipei : Mayor city key} {--person= : Comma-separated candidate names; omitted uses city candidates} {--date= : Date YYYY-MM-DD, defaults to yesterday in Asia/Taipei} {--limit=10 : Max candidates to generate} {--ai-call-limit=10 : Max AI completion calls in execute mode} {--execute : Call the configured AI provider chain and upsert urt_mayor_person_ai} {--dry-run : Force dry-run preview} {--user-token=CLI : user_token value for execute-mode upserts} {--show-prompt : Include prompt/source in JSON preview output} {--json : Emit JSON instead of text}', function (MayorPersonAiIngestion $ingestion) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $personOption = $this->option('person');
        $person = $personOption === null
            ? null
            : AiCommandInputValidator::commaSeparated($personOption, '--person');
        $limit = AiCommandInputValidator::integer($this->option('limit'), '--limit', 1);
        $aiCallLimit = AiCommandInputValidator::integer($this->option('ai-call-limit'), '--ai-call-limit');

        if ($execute) {
            $payload = $ingestion->execute(
                cityKey: (string) $this->option('city'),
                person: $person,
                date: is_string($this->option('date')) ? (string) $this->option('date') : null,
                limit: $limit,
                aiCallLimit: $aiCallLimit,
                userToken: (string) $this->option('user-token'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'ai:mayor-person mode=execute source=%s city=%s date=%s targets=%d attempted=%d inserted=%d updated=%d skipped=%d failed_rows=%d ai_call_limit=%d ai_calls_used=%d secrets=not_printed generated_at=%s',
                $payload['source'],
                $payload['city'],
                $payload['date'],
                $payload['targets'],
                $payload['attempted'],
                $payload['inserted'],
                $payload['updated'],
                $payload['skipped'],
                $payload['failed_rows'],
                $payload['ai_call_guard']['limit'],
                $payload['ai_call_guard']['used'],
                $payload['generated_at'],
            ));
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');
            $this->line('write_targets='.implode(',', $payload['write_targets']));

            foreach ($payload['rows'] as $row) {
                $this->line(sprintf(
                    '# person="%s" source_videos=%d prompt_chars=%d inserted=%s updated=%s skipped=%s reason=%s',
                    $row['person'],
                    $row['source_videos'],
                    $row['prompt_chars'],
                    $row['inserted'] ? 'yes' : 'no',
                    $row['updated'] ? 'yes' : 'no',
                    $row['skipped'] ? 'yes' : 'no',
                    $row['skip_reason'] ?? '-',
                ));
            }

            return (int) ($payload['exit_code'] ?? 0);
        }

        $payload = $ingestion->preview(
            cityKey: (string) $this->option('city'),
            person: $person,
            date: is_string($this->option('date')) ? (string) $this->option('date') : null,
            limit: $limit,
            includePrompt: (bool) $this->option('show-prompt'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'ai:mayor-person mode=ingestion-preview source=%s city=%s date=%s targets=%d would_call_ai_requests=%d would_upsert_rows=%d generated_at=%s writes=0 api_call=skipped mayor_person_ai_upsert=skipped',
            $payload['source'],
            $payload['city'],
            $payload['date'],
            $payload['targets'],
            $payload['would_call_ai_requests'],
            $payload['would_upsert_rows'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $row) {
            $this->line(sprintf(
                '# person="%s" eligible=%s source_videos=%d selected_total=%s existing_ai_rows=%d prompt_chars=%d would_call_ai=%s skip_reason=%s',
                $row['person'],
                $row['eligible'] ? 'yes' : 'no',
                $row['source_videos'],
                number_format((float) $row['selected_total'], 2),
                $row['existing_ai_rows'],
                $row['prompt_chars'],
                $row['would_call_ai'] ? 'yes' : 'no',
                $row['skip_reason'] ?? '-',
            ));
        }

        return 0;
    } catch (Throwable $exception) {
        $this->line('ai:mayor-person unavailable: '.SensitiveTextRedactor::exception($exception, 240).' secrets=not_printed');

        return 1;
    }
})->purpose('Preview or execute mayor candidate daily AI dashboard generation; execute mode upserts urt_mayor_person_ai rows');

$guardedIngestionCommand('ai:period {--from= : Previous daily date, defaults to the day before --to} {--to= : Current daily date, defaults to yesterday in Asia/Taipei} {--condition=all : Legacy condition_type to match} {--limit=20 : Max topics per day included in the matching prompt} {--ai-call-limit=1 : Max AI completion calls in execute mode} {--execute : Call the configured AI provider chain and upsert urt_ai_period} {--dry-run : Force dry-run preview; this is the default} {--user-token=CLI : user_token value for execute-mode upserts when the table supports it} {--show-prompt : Include prompt text in JSON/dry-run output} {--json : Emit JSON instead of text}', function (AiPeriodIngestion $ingestion) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $limit = AiCommandInputValidator::integer($this->option('limit'), '--limit', 1);
        $aiCallLimit = AiCommandInputValidator::integer($this->option('ai-call-limit'), '--ai-call-limit');

        if ($execute) {
            $payload = $ingestion->execute(
                from: is_string($this->option('from')) ? (string) $this->option('from') : null,
                to: is_string($this->option('to')) ? (string) $this->option('to') : null,
                condition: (string) $this->option('condition'),
                limit: $limit,
                aiCallLimit: $aiCallLimit,
                userToken: (string) $this->option('user-token'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $row = $payload['period_ai']['rows'][0];
            $this->line(sprintf(
                'ai:period mode=execute source=%s condition=%s from=%s pk=%s topics=%d to=%s pk=%s topics=%d matches=%d ai_calls_used=%d inserted=%d updated=%d skipped=%d skip_reason=%s secrets=not_printed generated_at=%s',
                $payload['source'],
                $payload['condition'],
                $payload['from_date'],
                $payload['from_pk'] ?? '-',
                $payload['from_topics'],
                $payload['to_date'],
                $payload['to_pk'] ?? '-',
                $payload['to_topics'],
                count($row['matches']),
                $payload['ai_call_guard']['used'],
                $row['inserted'] ? 1 : 0,
                $row['updated'] ? 1 : 0,
                $row['skipped'] ? 1 : 0,
                $row['skip_reason'] ?? '-',
                $payload['generated_at'],
            ));
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');
            $this->line('write_targets='.implode(',', $payload['write_targets']));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $payload = $ingestion->preview(
            from: is_string($this->option('from')) ? (string) $this->option('from') : null,
            to: is_string($this->option('to')) ? (string) $this->option('to') : null,
            condition: (string) $this->option('condition'),
            limit: $limit,
            includePrompt: (bool) $this->option('show-prompt'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'ai:period mode=ingestion-preview source=%s condition=%s from=%s pk=%s topics=%d to=%s pk=%s topics=%d existing_period_rows=%d prompt_chars=%d would_call_ai_requests=%d would_insert_ai_period_rows=%d blocked_reason=%s generated_at=%s writes=0 api_call=skipped ai_period_upsert=skipped',
            $payload['source'],
            $payload['condition'],
            $payload['from_date'],
            $payload['from_pk'] ?? '-',
            $payload['from_topics'],
            $payload['to_date'],
            $payload['to_pk'] ?? '-',
            $payload['to_topics'],
            $payload['existing_period_rows'],
            $payload['prompt_chars'],
            $payload['would_call_ai_requests'],
            $payload['would_insert_ai_period_rows'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['sample_to_topics'] as $index => $topic) {
            $this->line(sprintf('# to_topic_%d=%s', $index + 1, $topic));
        }

        return 0;
    } catch (Throwable $exception) {
        $this->error('ai:period unavailable: '.SensitiveTextRedactor::exception($exception, 240));

        return 1;
    }
})->purpose('Preview or execute legacy AI period event matching; execute mode calls AI and upserts urt_ai_period rows');

$guardedIngestionCommand('ai:event {--date= : Legacy daily date; generates visible topics for the date} {--condition=all : Legacy condition_type to match} {--aipk= : Specific urt_ai_date pk for old event links} {--event= : Specific event title to generate} {--prompt-types=summary,people,media : Comma-separated prompt rows to generate} {--limit=20 : Max daily topics to include} {--ai-call-limit=60 : Max AI completion calls in execute mode} {--execute : Call the configured AI provider chain and upsert urt_ai_event} {--dry-run : Force dry-run preview; this is the default} {--missing-only : Skip prompt rows that already exist} {--user-token=CLI : user_token value for execute-mode upserts when the table supports it} {--show-prompt : Include prompt text in JSON/dry-run output} {--json : Emit JSON instead of text}', function (AiEventIngestion $ingestion) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $aipkOption = $this->option('aipk');
        $aipk = $aipkOption === null
            ? null
            : AiCommandInputValidator::integer($aipkOption, '--aipk', 1);
        $eventOption = $this->option('event');
        $event = $eventOption === null
            ? null
            : AiCommandInputValidator::nonEmptyString($eventOption, '--event');
        $limit = AiCommandInputValidator::integer($this->option('limit'), '--limit', 1);
        $aiCallLimit = AiCommandInputValidator::integer($this->option('ai-call-limit'), '--ai-call-limit');

        if ($execute) {
            $payload = $ingestion->execute(
                date: is_string($this->option('date')) ? (string) $this->option('date') : null,
                condition: (string) $this->option('condition'),
                aipk: $aipk,
                event: $event,
                promptTypes: (string) $this->option('prompt-types'),
                limit: $limit,
                aiCallLimit: $aiCallLimit,
                missingOnly: (bool) $this->option('missing-only'),
                userToken: (string) $this->option('user-token'),
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'ai:event mode=execute source=%s date=%s pk=%s condition=%s topics=%d prompt_types=%s ai_call_limit=%d ai_calls_used=%d attempted=%d inserted=%d updated=%d skipped=%d failed_rows=%d secrets=not_printed generated_at=%s',
                $payload['source'],
                $payload['date'] ?? '-',
                $payload['aipk'] ?? '-',
                $payload['condition'],
                $payload['topics'],
                implode(',', $payload['prompt_types']),
                $payload['ai_call_guard']['limit'],
                $payload['ai_call_guard']['used'],
                $payload['event_ai']['attempted'],
                $payload['event_ai']['inserted'],
                $payload['event_ai']['updated'],
                $payload['event_ai']['skipped'],
                $payload['failed_rows'],
                $payload['generated_at'],
            ));
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');

            foreach ($payload['event_ai']['rows'] as $index => $row) {
                $this->line(sprintf(
                    '#%d event=%s prompt_type=%s prompt_chars=%d inserted=%d updated=%d skipped=%d skip_reason=%s',
                    $index + 1,
                    $row['event'] ?? '-',
                    $row['prompt_type'] ?? '-',
                    $row['prompt_chars'] ?? 0,
                    ($row['inserted'] ?? false) ? 1 : 0,
                    ($row['updated'] ?? false) ? 1 : 0,
                    ($row['skipped'] ?? false) ? 1 : 0,
                    $row['skip_reason'] ?? '-',
                ));
            }

            $this->line('write_targets='.implode(',', $payload['write_targets']));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $payload = $ingestion->preview(
            date: is_string($this->option('date')) ? (string) $this->option('date') : null,
            condition: (string) $this->option('condition'),
            aipk: $aipk,
            event: $event,
            promptTypes: (string) $this->option('prompt-types'),
            limit: $limit,
            missingOnly: (bool) $this->option('missing-only'),
            includePrompt: (bool) $this->option('show-prompt'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'ai:event mode=ingestion-preview source=%s date=%s pk=%s condition=%s topics=%d prompt_types=%s existing_event_rows=%d prompt_rows=%d would_call_ai_requests=%d would_upsert_ai_event_rows=%d blocked_reason=%s generated_at=%s writes=0 api_call=skipped ai_event_upsert=skipped',
            $payload['source'],
            $payload['date'] ?? '-',
            $payload['aipk'] ?? '-',
            $payload['condition'],
            $payload['topics'],
            implode(',', $payload['prompt_types']),
            $payload['existing_event_rows'],
            count($payload['rows']),
            $payload['would_call_ai_requests'],
            $payload['would_upsert_ai_event_rows'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d event=%s prompt_type=%s existing_rows=%d prompt_chars=%d skipped=%d skip_reason=%s',
                $index + 1,
                $row['event'],
                $row['prompt_type'],
                $row['existing_rows'],
                $row['prompt_chars'],
                $row['skipped'] ? 1 : 0,
                $row['skip_reason'] ?? '-',
            ));
        }

        return 0;
    } catch (Throwable $exception) {
        $this->error('ai:event unavailable: '.SensitiveTextRedactor::exception($exception, 240));

        return 1;
    }
})->purpose('Preview or execute legacy AI event summary/people/media generation; execute mode calls AI and upserts urt_ai_event rows');

$guardedIngestionCommand('ai:days:refresh {--from= : First AI daily date to refresh; defaults to yesterday; max inclusive range 31 days} {--to= : Last AI daily date to refresh; defaults to --from} {--condition=all : Legacy condition_type to refresh} {--daily-limit=1000 : Max source rows for each ai:daily aggregate prompt} {--daily-channel-limit=0 : Max configured channels to refresh before each daily aggregate; 0 skips channel refresh} {--daily-channel-offset=0 : Eligible configured channels to skip before refresh} {--daily-channel-batch-size=0 : Refresh selected channels in chunks; 0 uses one batch} {--daily-ai-call-limit=2 : Max AI completion calls per day for daily aggregate/channel refresh} {--daily-channel-video-limit=120 : Max videos in each channel prompt, hard max 500; 0 also uses 500} {--event-limit=100 : Max daily topics to include in event generation} {--event-ai-call-limit=60 : Total event summary/people/media AI completion calls across the refresh} {--event-passes=2 : Re-preview and retry missing event rows up to this many passes} {--period-limit=20 : Max topics per day included in period matching} {--period-ai-call-limit=1 : Max period matching AI calls per adjacent date pair} {--prompt-types=summary,people,media : Event prompt rows to generate} {--skip-daily : Do not run ai:daily; use existing daily rows} {--skip-events : Do not run ai:event; only daily/period work} {--skip-period : Do not run ai:period; only daily/event work} {--execute : Call AI completions and upsert daily/event/period rows} {--dry-run : Force dry-run preview; this is the default} {--user-token=CLI : user_token value for execute-mode upserts} {--json : Emit JSON instead of text}', function (AiDaysRefreshIngestion $ingestion) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $dailyChannelLimit = AiCommandInputValidator::integer($this->option('daily-channel-limit'), '--daily-channel-limit');
        $dailyChannelOffset = AiCommandInputValidator::integer($this->option('daily-channel-offset'), '--daily-channel-offset');
        $dailyChannelBatchSize = AiCommandInputValidator::integer($this->option('daily-channel-batch-size'), '--daily-channel-batch-size');
        $dailyAiCallLimit = AiCommandInputValidator::integer($this->option('daily-ai-call-limit'), '--daily-ai-call-limit');
        $dailyChannelVideoLimit = AiCommandInputValidator::integer($this->option('daily-channel-video-limit'), '--daily-channel-video-limit');
        $eventAiCallLimit = AiCommandInputValidator::integer($this->option('event-ai-call-limit'), '--event-ai-call-limit');
        $periodAiCallLimit = AiCommandInputValidator::integer($this->option('period-ai-call-limit'), '--period-ai-call-limit');
        $eventPasses = AiCommandInputValidator::integer($this->option('event-passes'), '--event-passes', 1);
        $arguments = [
            'from' => is_string($this->option('from')) ? (string) $this->option('from') : null,
            'to' => is_string($this->option('to')) ? (string) $this->option('to') : null,
            'condition' => (string) $this->option('condition'),
            'dailyLimit' => AiCommandInputValidator::integer($this->option('daily-limit'), '--daily-limit', 1),
            'dailyChannelLimit' => $dailyChannelLimit,
            'dailyChannelOffset' => $dailyChannelOffset,
            'dailyChannelBatchSize' => $dailyChannelBatchSize,
            'dailyAiCallLimit' => $dailyAiCallLimit,
            'dailyChannelVideoLimit' => $dailyChannelVideoLimit,
            'eventLimit' => AiCommandInputValidator::integer($this->option('event-limit'), '--event-limit', 1),
            'eventAiCallLimit' => $eventAiCallLimit,
            'periodLimit' => AiCommandInputValidator::integer($this->option('period-limit'), '--period-limit', 1),
            'periodAiCallLimit' => $periodAiCallLimit,
            'promptTypes' => (string) $this->option('prompt-types'),
            'skipDaily' => (bool) $this->option('skip-daily'),
            'skipEvents' => (bool) $this->option('skip-events'),
            'skipPeriod' => (bool) $this->option('skip-period'),
        ];

        if ($execute) {
            $payload = $ingestion->execute(
                from: $arguments['from'],
                to: $arguments['to'],
                condition: $arguments['condition'],
                dailyLimit: $arguments['dailyLimit'],
                dailyChannelLimit: $arguments['dailyChannelLimit'],
                dailyChannelOffset: $arguments['dailyChannelOffset'],
                dailyChannelBatchSize: $arguments['dailyChannelBatchSize'],
                dailyAiCallLimit: $arguments['dailyAiCallLimit'],
                dailyChannelVideoLimit: $arguments['dailyChannelVideoLimit'],
                eventLimit: $arguments['eventLimit'],
                eventAiCallLimit: $arguments['eventAiCallLimit'],
                periodLimit: $arguments['periodLimit'],
                periodAiCallLimit: $arguments['periodAiCallLimit'],
                promptTypes: $arguments['promptTypes'],
                userToken: (string) $this->option('user-token'),
                maxEventPasses: $eventPasses,
                skipDaily: $arguments['skipDaily'],
                skipEvents: $arguments['skipEvents'],
                skipPeriod: $arguments['skipPeriod'],
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $this->line(sprintf(
                'ai:days:refresh mode=execute status=%s source=%s from=%s to=%s dates=%d date_limit=%d condition=%s daily_jobs=%d event_rows_inserted=%d event_rows_updated=%d event_missing_after=%d period_inserted=%d period_updated=%d period_skipped=%d failed_rows=%d event_ai_calls_used=%d blocked_reason=%s generated_at=%s',
                $payload['status'],
                $payload['source'],
                $payload['from_date'] ?? '-',
                $payload['to_date'] ?? '-',
                $payload['date_count'],
                $payload['date_range_limit'] ?? AiDaysRefreshIngestion::MAX_DATE_RANGE_DAYS,
                $payload['condition'],
                $payload['summary']['daily_jobs'],
                $payload['summary']['event_rows_inserted'],
                $payload['summary']['event_rows_updated'],
                $payload['summary']['event_missing_after'],
                $payload['summary']['period_rows_inserted'],
                $payload['summary']['period_rows_updated'],
                $payload['summary']['period_rows_skipped'],
                $payload['failed_rows'],
                $payload['ai_call_guard']['event_used'],
                $payload['blocked_reason'] ?? '-',
                $payload['generated_at'],
            ));
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');

            foreach ($payload['jobs'] as $index => $job) {
                if (($job['type'] ?? null) === 'event-verify') {
                    $this->line(sprintf(
                        '#%d verify date=%s topics=%d prompt_rows=%d existing_event_rows=%d missing=%d blocked_reason=%s',
                        $index + 1,
                        $job['date'],
                        $job['result']['topics'] ?? 0,
                        count($job['result']['rows'] ?? []),
                        $job['result']['existing_event_rows'] ?? 0,
                        $job['result']['would_call_ai_requests'] ?? 0,
                        $job['result']['blocked_reason'] ?? '-',
                    ));
                }

                if (($job['type'] ?? null) === 'period' && is_array(data_get($job, 'result.period_ai.rows.0.matches'))) {
                    $this->line(sprintf(
                        '#%d period from=%s to=%s matches=%d inserted=%d updated=%d skipped=%d',
                        $index + 1,
                        $job['meta']['from'] ?? '-',
                        $job['meta']['to'] ?? $job['date'],
                        count(data_get($job, 'result.period_ai.rows.0.matches', [])),
                        data_get($job, 'result.period_ai.inserted') === true ? 1 : 0,
                        data_get($job, 'result.period_ai.updated') === true ? 1 : 0,
                        data_get($job, 'result.period_ai.skipped') === true ? 1 : 0,
                    ));
                }
            }

            $this->line('write_targets='.implode(',', $payload['write_targets']));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $payload = $ingestion->preview(...$arguments);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'ai:days:refresh mode=ingestion-preview status=%s source=%s from=%s to=%s dates=%d date_limit=%d condition=%s jobs=%d event_missing=%d period_jobs=%d blocked_reason=%s generated_at=%s writes=0 api_call=skipped daily_event_period_upsert=skipped',
            $payload['status'],
            $payload['source'],
            $payload['from_date'] ?? '-',
            $payload['to_date'] ?? '-',
            $payload['date_count'],
            $payload['date_range_limit'] ?? AiDaysRefreshIngestion::MAX_DATE_RANGE_DAYS,
            $payload['condition'],
            $payload['summary']['jobs'],
            collect($payload['jobs'])->where('type', 'event-preview')->sum(fn (array $job): int => (int) data_get($job, 'result.would_call_ai_requests', 0)),
            $payload['summary']['period_jobs'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['jobs'] as $index => $job) {
            if (($job['type'] ?? null) === 'event-preview') {
                $this->line(sprintf(
                    '#%d event-preview date=%s topics=%d prompt_rows=%d existing_event_rows=%d missing=%d blocked_reason=%s',
                    $index + 1,
                    $job['date'],
                    $job['result']['topics'] ?? 0,
                    count($job['result']['rows'] ?? []),
                    $job['result']['existing_event_rows'] ?? 0,
                    $job['result']['would_call_ai_requests'] ?? 0,
                    $job['result']['blocked_reason'] ?? '-',
                ));
            }
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (Throwable $exception) {
        $this->error('ai:days:refresh unavailable: '.SensitiveTextRedactor::exception($exception, 240));

        return 1;
    }
})->purpose('Orchestrate daily AI, event AI, adjacent period matching, and missing-row verification for one or more dates');

$guardedIngestionCommand('ai:hourly {--condition= : Optional legacy condition; omitted matches cron default} {--hour=1 : Legacy hours-back offset} {--period=1 : Legacy number of hourly buckets to include} {--limit=20 : Number of candidate videos to print} {--prompt-video-limit=5000 : Complete hourly source cap, hard max 5000; cap hit blocks AI} {--at= : Override evaluation timestamp in Y-m-d H:i:s} {--execute : Call the configured AI provider chain and upsert urt_ai_hour} {--dry-run : Force dry-run preview; this is the default} {--user-token=cli : user_token value for execute-mode upsert} {--json : Emit JSON instead of text}', function (AiHourlyPreview $preview, AiHourlyIngestion $ingestion) {
    try {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $at = AiCommandInputValidator::timestamp($this->option('at'), '--at', $timezone);
        $hour = AiCommandInputValidator::integer($this->option('hour'), '--hour');
        $period = AiCommandInputValidator::integer($this->option('period'), '--period', 1);
        $limit = AiCommandInputValidator::integer($this->option('limit'), '--limit', 1);
        $promptVideoLimit = AiCommandInputValidator::integer($this->option('prompt-video-limit'), '--prompt-video-limit');

        if ($execute) {
            $payload = $ingestion->execute(
                condition: is_string($this->option('condition')) ? (string) $this->option('condition') : null,
                hour: $hour,
                period: $period,
                limit: $limit,
                promptVideoLimit: $promptVideoLimit,
                userToken: (string) $this->option('user-token'),
                now: $at,
            );

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

                return (int) ($payload['exit_code'] ?? 0);
            }

            $usage = is_array($payload['usage']) ? json_encode($payload['usage'], JSON_UNESCAPED_SLASHES) : 'null';
            $providerFailures = $payload['provider_failures'] === []
                ? 'none'
                : implode(' | ', $payload['provider_failures']);
            $this->line(sprintf(
                'ai:hourly mode=execute status=%s source=%s condition=%s date_from=%s date_to=%s source_videos=%d prompt_videos=%d prompt_video_limit=%d omitted_videos=%d source_complete=%s source_truncated=%s prompt_chars=%d provider=%s model=%s inserted=%s updated=%s skipped=%s skip_reason=%s provider_failures="%s" secrets=not_printed usage=%s',
                $payload['status'],
                $payload['source'],
                $payload['condition_type'],
                $payload['date_from'],
                $payload['date_to'],
                $payload['video_rows'],
                $payload['prompt_video_rows'],
                $payload['prompt_video_limit'],
                $payload['prompt_omitted_video_rows'],
                $payload['source_complete'] ? 'yes' : 'no',
                $payload['source_truncated'] ? 'yes' : 'no',
                $payload['prompt_chars'],
                $payload['provider'] ?? '-',
                $payload['model'],
                $payload['inserted'] ? 'yes' : 'no',
                $payload['updated'] ? 'yes' : 'no',
                $payload['skipped'] ? 'yes' : 'no',
                $payload['skip_reason'] ?? '-',
                $providerFailures,
                $usage,
            ));
            $providerUsage = app(AiProviderUsageSummary::class)->compactLine(
                app(AiProviderUsageSummary::class)->summarizePayload($payload),
            );
            $this->line('provider_usage="'.$providerUsage.'"');
            $this->line('write_targets='.($payload['write_targets'] === [] ? 'none' : implode(',', $payload['write_targets'])));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $payload = $preview->preview(
            condition: is_string($this->option('condition')) ? (string) $this->option('condition') : null,
            hour: $hour,
            period: $period,
            limit: $limit,
            promptVideoLimit: $promptVideoLimit,
            now: $at,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $matchingChannels = $payload['matching_channels'] === null ? 'all' : (string) $payload['matching_channels'];

        $this->line(sprintf(
            'ai:hourly mode=ingestion-preview status=%s source=%s condition=%s explicit_condition=%s matching_channels=%s video_rows=%d prompt_video_rows=%d prompt_video_limit=%d omitted_videos=%d source_complete=%s source_truncated=%s displayed_rows=%d hour=%d period=%d date_from=%s date_to=%s existing_ai_hour_rows=%d prompt_bounds=%d-%d prompt_chars=%d would_call_ai_requests=%d would_insert_ai_hour_rows=%d blocked_reason=%s generated_at=%s writes=0 api_call=skipped ai_hour_insert=skipped',
            $payload['status'],
            $payload['source'],
            $payload['condition_type'],
            $payload['explicit_condition'] ? 'yes' : 'no',
            $matchingChannels,
            $payload['video_rows'],
            $payload['prompt_video_rows'],
            $payload['prompt_video_limit'],
            $payload['prompt_omitted_video_rows'],
            $payload['source_complete'] ? 'yes' : 'no',
            $payload['source_truncated'] ? 'yes' : 'no',
            $payload['displayed_rows'],
            $payload['hour'],
            $payload['period'],
            $payload['date_from'],
            $payload['date_to'],
            $payload['existing_ai_hour_rows'],
            $payload['prompt_bounds']['min'],
            $payload['prompt_bounds']['max'],
            $payload['prompt_chars'],
            $payload['would_call_ai_requests'],
            $payload['would_insert_ai_hour_rows'],
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d videoId=%s u_id=%s publishedAt=%s views=%s comments=%s title="%s"',
                $index + 1,
                $row['video_id'],
                $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                $row['published_at'] ?? '-',
                $row['view_count'] !== null ? number_format($row['view_count']) : 'n/a',
                $row['comment_count'] !== null ? number_format($row['comment_count']) : 'n/a',
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);
    } catch (QueryException $exception) {
        $this->error('ai:hourly unavailable: '.SensitiveTextRedactor::exception($exception, 240));

        return 1;
    } catch (Throwable $exception) {
        $this->line('ai:hourly execute unavailable: '.SensitiveTextRedactor::exception($exception, 240).' secrets=not_printed');

        return 1;
    }
})->purpose('Dry-run preview of legacy hourly AI summary generation, with explicit --execute support through the configured AI provider chain');

$guardedIngestionCommand('ai:hourly:pipeline {--condition= : Optional legacy condition} {--hour=1 : Hours-back offset} {--period=1 : Hourly buckets} {--limit=20 : Candidate videos to print} {--source-max-results=50 : Latest uploads fetched per configured channel} {--prompt-video-limit=5000 : Complete hourly source cap, hard max 5000; cap hit blocks AI} {--at= : Override evaluation timestamp in Y-m-d H:i:s} {--execute : Refresh source uploads before hourly AI} {--dry-run : Preview both stages without writes} {--user-token=cli : user_token for AI row} {--json : Emit JSON}', function (AiScheduledPipelineIngestion $pipeline) {
    try {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $at = AiCommandInputValidator::timestamp($this->option('at'), '--at', $timezone);
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $sourceMaxResults = AiCommandInputValidator::integer($this->option('source-max-results'), '--source-max-results', 1);
        $arguments = [
            'condition' => is_string($this->option('condition')) ? (string) $this->option('condition') : null,
            'hour' => AiCommandInputValidator::integer($this->option('hour'), '--hour'),
            'period' => AiCommandInputValidator::integer($this->option('period'), '--period', 1),
            'limit' => AiCommandInputValidator::integer($this->option('limit'), '--limit', 1),
            'promptVideoLimit' => AiCommandInputValidator::integer($this->option('prompt-video-limit'), '--prompt-video-limit'),
            'now' => $at,
        ];
        $payload = $execute
            ? $pipeline->executeHourly(
                ...$arguments,
                sourceMaxResults: $sourceMaxResults,
                userToken: (string) $this->option('user-token'),
            )
            : $pipeline->previewHourly(...$arguments);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'ai:hourly:pipeline mode=%s status=%s from=%s to=%s source_succeeded=%s source_channels=%d source_failed=%d ai_status=%s prompt_video_limit=%d source_truncated=%s reason=%s secrets=not_printed',
            $payload['mode'],
            $payload['status'] ?? data_get($payload, 'ai.status', 'preview'),
            $payload['date_from'],
            $payload['date_to'],
            data_get($payload, 'source_refresh.succeeded', false) ? 'yes' : 'no',
            (int) data_get($payload, 'source_refresh.completed_channels', 0),
            (int) data_get($payload, 'source_refresh.failed_channels', 0),
            (string) data_get($payload, 'ai.status', data_get($payload, 'ai.skip_reason', 'preview')),
            (int) data_get($payload, 'ai.prompt_video_limit', AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT),
            data_get($payload, 'ai.source_truncated', false) ? 'yes' : 'no',
            (string) data_get($payload, 'source_refresh.failure_reason', data_get($payload, 'ai.blocked_reason', '-')),
        ));

        return (int) ($payload['exit_code'] ?? 0);
    } catch (Throwable $exception) {
        $this->error('ai:hourly:pipeline unavailable: '.SensitiveTextRedactor::exception($exception, 240).' secrets=not_printed');

        return 1;
    }
})->purpose('Refresh all configured AI channel uploads, then generate the previous complete hourly AI summary');

$guardedIngestionCommand('youtube:comments:queue {--tagid= : Legacy AND tag filter} {--or= : Legacy OR tag filter} {--not= : Legacy NOT tag filter} {--hours=24 : Recent publishedAt window} {--min=500 : Minimum viewCount and commentCount threshold} {--limit=20 : Number of candidate rows to print, capped lower for --execute} {--execute : Insert selected queue rows into local DB} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (CommentQueuePreview $preview, CommentQueueIngestion $ingestion) {
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
})->purpose('Dry-run preview of legacy comment queue generation, with explicit local-only --execute support');

Artisan::command('youtube:comments:fetch {--videoId= : Optional queued video id to preview} {--limit=20 : Number of queued rows to print, capped lower for --execute} {--max-pages=1 : Maximum commentThreads pages per video in execute mode, capped at 3} {--max-reply-pages=20 : Shared comments.list reply page cap per video, max 100} {--execute : Call YouTube and drain selected local queue rows} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}', function (CommentFetchPreview $preview, CommentFetchIngestion $ingestion, DirectYoutubeQuotaGuard $quotaGuard) {
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
})->purpose('Dry-run preview of legacy comment queue drain, with explicit local-only --execute support');

if (config('ingestion.scheduler_enabled', false)) {
    Schedule::command('ingestion:run --execute --record')
        ->everyMinute()
        ->withoutOverlapping(10);
}

Artisan::command('notify:telegram:digest {--period=daily : daily or hourly} {--force : Ignore the already-posted dedup guard} {--dry-run : Render and print the posts without sending}', function (TelegramDigestBroadcaster $broadcaster) {
    $period = strtolower(trim((string) $this->option('period')));

    if (! in_array($period, ['daily', 'hourly'], true)) {
        $this->error('notify:telegram:digest unavailable: --period must be daily or hourly');

        return 1;
    }

    if ($this->option('dry-run')) {
        $messages = $broadcaster->preview($period);

        foreach ($messages as $index => $html) {
            $this->line('----- post '.($index + 1).' -----');
            $this->line($html);
        }

        $this->info('notify:telegram:digest period='.$period.' preview='.count($messages).' sent=0 (dry-run)');

        return 0;
    }

    $result = $broadcaster->run($period, (bool) $this->option('force'));

    $this->info(sprintf(
        'notify:telegram:digest period=%s considered=%d eligible=%d posted=%d skipped_seen=%d skipped_incomplete=%d dry_run=%s',
        $result['period'],
        $result['considered'],
        $result['eligible'],
        $result['posted'],
        $result['skipped_seen'],
        $result['skipped_incomplete'],
        $result['dry_run'] ? 'yes' : 'no',
    ));

    return 0;
})->purpose('Post the latest daily/hourly AI event digest to the Telegram channel');

// Scheduled only when the channel push is explicitly enabled, so the digest
// never spends AI quota while disabled. Manual runs remain available anytime.
if (config('services.telegram.enabled', false)) {
    // The production scheduler is a `while true; schedule:run; sleep 60` loop,
    // so each cycle can skip an exact cron minute. Evaluate every minute and
    // claim a durable time slot before starting each digest command.
    Schedule::command('notify:telegram:digest --period=hourly')
        ->everyMinute()
        ->when(fn (): bool => app(TelegramScheduleSlotGate::class)->claim(
            'hourly',
            10,
            (string) config('app.timezone', 'UTC'),
        ))
        ->withoutOverlapping(15)
        ->runInBackground()
        ->appendOutputTo(storage_path('logs/telegram-digest.log'));

    Schedule::command('notify:telegram:digest --period=daily')
        ->everyMinute()
        ->timezone('Asia/Taipei')
        ->between('9:00', '21:00')
        ->when(fn (): bool => app(TelegramScheduleSlotGate::class)->claim('daily', 30, 'Asia/Taipei'))
        ->withoutOverlapping(15)
        ->runInBackground()
        ->appendOutputTo(storage_path('logs/telegram-digest.log'));
}
