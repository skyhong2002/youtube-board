<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiHourlyPreview;
use App\Services\Ingestion\AiScheduledPipelineIngestion;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiHourlyPipelineCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:hourly:pipeline {--condition= : Optional legacy condition} {--hour=1 : Hours-back offset} {--period=1 : Hourly buckets} {--limit=20 : Candidate videos to print} {--source-max-results=50 : Latest uploads fetched per configured channel} {--prompt-video-limit=5000 : Complete hourly source cap, hard max 5000; cap hit blocks AI} {--at= : Override evaluation timestamp in Y-m-d H:i:s} {--execute : Refresh source uploads before hourly AI} {--dry-run : Preview both stages without writes} {--user-token=cli : user_token for AI row} {--json : Emit JSON}';

    protected $description = 'Refresh all configured AI channel uploads, then generate the previous complete hourly AI summary';

    public function handle(AiScheduledPipelineIngestion $pipeline): int
    {
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

    }
}
