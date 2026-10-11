<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiPeriodIngestion;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiPeriodCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:period {--from= : Previous daily date, defaults to the day before --to} {--to= : Current daily date, defaults to yesterday in Asia/Taipei} {--condition=all : Legacy condition_type to match} {--limit=20 : Max topics per day included in the matching prompt} {--ai-call-limit=1 : Max AI completion calls in execute mode} {--execute : Call the configured AI provider chain and upsert urt_ai_period} {--dry-run : Force dry-run preview; this is the default} {--user-token=CLI : user_token value for execute-mode upserts when the table supports it} {--show-prompt : Include prompt text in JSON/dry-run output} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute legacy AI period event matching; execute mode calls AI and upserts urt_ai_period rows';

    public function handle(AiPeriodIngestion $ingestion): int
    {
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

    }
}
