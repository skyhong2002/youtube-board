<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Services\Ingestion\ChannelAiIngestion;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiChannelCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:channel {u_id : Channel u_id} {--from= : Required start date in YYYY-MM-DD} {--to= : Optional end date; defaults to --from} {--type=auto : auto, oneday, or todate} {--limit=120 : Max videos included in the prompt, capped at 500} {--execute : Call the configured AI provider and upsert urt_channel_ai} {--dry-run : Force preview mode} {--user-token=CLI : user_token value for execute-mode upsert} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or explicitly generate one channel AI cache row for a reviewed date range';

    public function handle(ChannelAiIngestion $ingestion): int
    {
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

    }
}
