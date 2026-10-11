<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiScheduledPipelineIngestion;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiDailyPipelineCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:daily:pipeline {--date=yesterday : Date, today, or yesterday} {--limit=1000 : Max channel AI rows per condition} {--channel-limit=39 : Max configured channels to refresh} {--channel-batch-size=12 : Channel AI batch size} {--ai-call-limit=45 : Max logical AI completion chains; provider attempts within each chain are separately bounded} {--channel-video-limit=120 : Max videos in each channel prompt, hard max 500; 0 also uses 500} {--missing-only : Skip entirely when all daily rows are valid; otherwise generate only missing or invalid AI rows} {--execute : Refresh complete YouTube sources before daily AI} {--dry-run : Preview both stages without writes} {--user-token=CLI : user_token for AI rows} {--json : Emit JSON}';

    protected $description = 'Refresh complete previous-day YouTube sources, then generate channel and daily AI only after source success';

    public function handle(AiScheduledPipelineIngestion $pipeline): int
    {
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
                    missingOnly: (bool) $this->option('missing-only'),
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

    }
}
