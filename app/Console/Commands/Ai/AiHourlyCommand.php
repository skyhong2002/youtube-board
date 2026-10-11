<?php

namespace App\Console\Commands\Ai;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\AiCommandInputValidator;
use App\Services\Ingestion\AiHourlyIngestion;
use App\Services\Ingestion\AiHourlyPreview;
use App\Services\Ingestion\AiProviderUsageSummary;
use App\Support\SensitiveTextRedactor;
use Illuminate\Database\QueryException;
use Throwable;

class AiHourlyCommand extends GuardedIngestionCommand
{
    protected $signature = 'ai:hourly {--condition= : Optional legacy condition; omitted matches cron default} {--hour=1 : Legacy hours-back offset} {--period=1 : Legacy number of hourly buckets to include} {--limit=20 : Number of candidate videos to print} {--prompt-video-limit=5000 : Complete hourly source cap, hard max 5000; cap hit blocks AI} {--at= : Override evaluation timestamp in Y-m-d H:i:s} {--execute : Call the configured AI provider chain and upsert urt_ai_hour} {--dry-run : Force dry-run preview; this is the default} {--user-token=cli : user_token value for execute-mode upsert} {--json : Emit JSON instead of text}';

    protected $description = 'Dry-run preview of legacy hourly AI summary generation, with explicit --execute support through the configured AI provider chain';

    public function handle(AiHourlyPreview $preview, AiHourlyIngestion $ingestion): int
    {
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

    }
}
