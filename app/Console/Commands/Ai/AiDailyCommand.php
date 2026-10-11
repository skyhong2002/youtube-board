<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiDailyIngestion;
use App\Services\Ingestion\AiDailyPreview;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Support\SensitiveTextRedactor;
use Throwable;

class AiDailyCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:daily {--date= : Legacy date, today, or yesterday; defaults to yesterday in Asia/Taipei} {--condition= : Optional single legacy condition; default previews make_ai_day.sh conditions} {--type=oneday : Legacy urt_channel_ai data_type} {--limit=1000 : Max channel AI rows per condition} {--channel-limit=39 : Max configured channels to refresh in execute mode} {--channel-offset=0 : Eligible configured channels to skip before refresh} {--channel-batch-size=0 : Refresh selected channels in chunks; 0 uses one batch} {--ai-call-limit=45 : Max logical AI completion chains; provider attempts within each chain are separately bounded} {--channel-video-limit=120 : Max videos in each channel prompt, hard max 500; 0 also uses 500} {--missing-only : Reuse valid existing channel/daily AI rows and generate only missing or invalid ones} {--execute : Call the configured AI provider chain and upsert urt_channel_ai/urt_ai_date} {--dry-run : Force dry-run preview} {--user-token=CLI : user_token value for execute-mode upserts} {--json : Emit JSON instead of text}';

    protected $description = 'Ingestion preview of legacy daily AI summary generation; execute mode calls AI and upserts urt_channel_ai/urt_ai_date rows';

    public function handle(AiDailyPreview $preview, AiDailyIngestion $ingestion): int
    {
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
                    missingOnly: (bool) $this->option('missing-only'),
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

    }
}
