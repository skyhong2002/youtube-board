<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Services\Ingestion\MayorPersonAiIngestion;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiMayorPersonCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:mayor-person {--city=taipei : Mayor city key} {--person= : Comma-separated candidate names; omitted uses city candidates} {--date= : Date YYYY-MM-DD, defaults to yesterday in Asia/Taipei} {--limit=10 : Max candidates to generate} {--ai-call-limit=10 : Max AI completion calls in execute mode} {--execute : Call the configured AI provider chain and upsert urt_mayor_person_ai} {--dry-run : Force dry-run preview} {--user-token=CLI : user_token value for execute-mode upserts} {--show-prompt : Include prompt/source in JSON preview output} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or execute mayor candidate daily AI dashboard generation; execute mode upserts urt_mayor_person_ai rows';

    public function handle(MayorPersonAiIngestion $ingestion): int
    {
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

    }
}
