<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiEventIngestion;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiEventCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:event {--date= : Legacy daily date; generates visible topics for the date} {--condition=all : Legacy condition_type to match} {--aipk= : Specific urt_ai_date pk for old event links} {--event= : Specific event title to generate} {--prompt-types=summary,people,media : Comma-separated prompt rows to generate} {--limit=20 : Max daily topics to include} {--ai-call-limit=60 : Max AI completion calls in execute mode} {--execute : Call the configured AI provider chain and upsert urt_ai_event} {--dry-run : Force dry-run preview; this is the default} {--missing-only : Skip prompt rows that already exist} {--user-token=CLI : user_token value for execute-mode upserts when the table supports it} {--show-prompt : Include prompt text in JSON/dry-run output} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute legacy AI event summary/people/media generation; execute mode calls AI and upserts urt_ai_event rows';

    public function handle(AiEventIngestion $ingestion): int
    {
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

    }
}
