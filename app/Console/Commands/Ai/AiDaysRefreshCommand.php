<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiDaysRefreshIngestion;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiDaysRefreshCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:days:refresh {--from= : First AI daily date to refresh; defaults to yesterday; max inclusive range 31 days} {--to= : Last AI daily date to refresh; defaults to --from} {--condition=all : Legacy condition_type to refresh} {--daily-limit=1000 : Max source rows for each ai:daily aggregate prompt} {--daily-channel-limit=0 : Max configured channels to refresh before each daily aggregate; 0 skips channel refresh} {--daily-channel-offset=0 : Eligible configured channels to skip before refresh} {--daily-channel-batch-size=0 : Refresh selected channels in chunks; 0 uses one batch} {--daily-ai-call-limit=2 : Max AI completion calls per day for daily aggregate/channel refresh} {--daily-channel-video-limit=120 : Max videos in each channel prompt, hard max 500; 0 also uses 500} {--event-limit=100 : Max daily topics to include in event generation} {--event-ai-call-limit=60 : Total event summary/people/media AI completion calls across the refresh} {--event-passes=2 : Re-preview and retry missing event rows up to this many passes} {--period-limit=20 : Max topics per day included in period matching} {--period-ai-call-limit=1 : Max period matching AI calls per adjacent date pair} {--prompt-types=summary,people,media : Event prompt rows to generate} {--skip-daily : Do not run ai:daily; use existing daily rows} {--skip-events : Do not run ai:event; only daily/period work} {--skip-period : Do not run ai:period; only daily/event work} {--execute : Call AI completions and upsert daily/event/period rows} {--dry-run : Force dry-run preview; this is the default} {--user-token=CLI : user_token value for execute-mode upserts} {--json : Emit JSON instead of text}';

    protected $description = 'Orchestrate daily AI, event AI, adjacent period matching, and missing-row verification for one or more dates';

    public function handle(AiDaysRefreshIngestion $ingestion): int
    {
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

    }
}
