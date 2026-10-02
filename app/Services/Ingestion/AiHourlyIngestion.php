<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class AiHourlyIngestion
{
    public function __construct(
        private readonly AiHourlyPreview $preview,
        private readonly OpenCodeChatClient $client,
        private readonly AiJsonPayloadValidator $jsonValidator,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $condition = null,
        int $hour = 1,
        int $period = 1,
        int $limit = 20,
        int $promptVideoLimit = AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT,
        string $userToken = 'cli',
        ?CarbonInterface $now = null,
    ): array {
        $payload = $this->preview->preview(
            condition: $condition,
            hour: $hour,
            period: $period,
            limit: $limit,
            promptVideoLimit: $promptVideoLimit,
            now: $now,
        );

        if (! (bool) ($payload['source_complete'] ?? true)) {
            return [
                'mode' => 'execute',
                'status' => 'blocked',
                'exit_code' => 1,
                'failed_rows' => 1,
                'source' => $payload['source'],
                'date_from' => $payload['date_from'],
                'date_to' => $payload['date_to'],
                'condition_type' => $payload['condition_type'],
                'prompt_video_rows' => $payload['prompt_video_rows'],
                'prompt_chars' => $payload['prompt_chars'],
                ...$this->sourceMeta($payload),
                'model' => (string) config('services.opencode_go.model', 'sky-quality'),
                'provider' => null,
                'provider_failures' => [],
                'usage' => null,
                'write_targets' => [],
                'upserted' => false,
                'inserted' => false,
                'updated' => false,
                'ai_call_attempted' => false,
                'skipped' => true,
                'failed' => true,
                'skip_reason' => $payload['blocked_reason'] ?? 'hourly_source_incomplete',
                'secrets' => 'not_printed',
            ];
        }

        if ((int) $payload['prompt_video_rows'] <= 0) {
            return [
                'mode' => 'execute',
                'status' => 'skipped',
                'exit_code' => 0,
                'failed_rows' => 0,
                'source' => $payload['source'],
                'date_from' => $payload['date_from'],
                'date_to' => $payload['date_to'],
                'condition_type' => $payload['condition_type'],
                'prompt_video_rows' => $payload['prompt_video_rows'],
                'prompt_chars' => $payload['prompt_chars'],
                ...$this->sourceMeta($payload),
                'model' => (string) config('services.opencode_go.model', 'sky-quality'),
                'provider' => null,
                'provider_failures' => [],
                'usage' => null,
                'write_targets' => [],
                'upserted' => false,
                'inserted' => false,
                'updated' => false,
                'ai_call_attempted' => false,
                'skipped' => true,
                'failed' => false,
                'skip_reason' => 'no_source_videos',
                'secrets' => 'not_printed',
            ];
        }

        $attributes = [
            'date_from' => $payload['date_from'],
            'date_to' => $payload['date_to'],
            'condition_type' => $payload['condition_type'],
            'data_type' => $payload['data_type'],
            'user_token' => $userToken,
        ];
        $lock = $this->businessKeyLock->acquire('urt_ai_hour', $attributes);

        if ($lock === null) {
            return $this->failedPayload(
                payload: $payload,
                reason: 'business_key_locked',
                aiCallAttempted: false,
            );
        }

        $bounds = is_array($payload['prompt_bounds'] ?? null)
            ? $payload['prompt_bounds']
            : ['min' => 1, 'max' => 100];
        $minimum = max(1, (int) ($bounds['min'] ?? 1));
        $maximum = max($minimum, (int) ($bounds['max'] ?? 100));

        try {
            try {
                $completion = $this->client->completeValidated(
                    (string) $payload['prompt'],
                    fn (string $content): array => $this->jsonValidator->validateEventList(
                        $content,
                        'hourly',
                        expectedMinItems: $minimum,
                        expectedMaxItems: $maximum,
                    ),
                    jsonSchema: $this->jsonValidator->eventListJsonSchema(
                        'hourly',
                        expectedMinItems: $minimum,
                        expectedMaxItems: $maximum,
                    ),
                );
            } catch (Throwable $exception) {
                $validationReason = $this->validationFailureReason($exception);
                $reason = $validationReason ?? SensitiveTextRedactor::exception($exception, 240);
                $this->logFailure($payload, $validationReason === null ? 'completion' : 'validation', [
                    'failure_reason' => $reason,
                    'expected_min_items' => $minimum,
                    'expected_max_items' => $maximum,
                ], $exception);

                return $this->failedPayload(
                    payload: $payload,
                    reason: $reason,
                );
            }

            $validated = is_array($completion['validation'] ?? null)
                ? $completion['validation']
                : $this->jsonValidator->validateEventList(
                    (string) $completion['content'],
                    'hourly',
                    expectedMinItems: $minimum,
                    expectedMaxItems: $maximum,
                );

            if (! $validated['valid']) {
                $this->logFailure($payload, 'validation', [
                    'model' => $completion['model'],
                    'provider' => $completion['provider'],
                    'failure_reason' => $validated['failure_reason'],
                    'content_chars' => mb_strlen((string) $completion['content'], 'UTF-8'),
                ]);

                return $this->failedPayload(
                    payload: $payload,
                    reason: (string) $validated['failure_reason'],
                    completion: $completion,
                );
            }

            $now = CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei')))
                ->format('Y-m-d H:i:s');
            $values = [
                'mtime' => $now,
                'ai_type' => $completion['provenance_model'],
                'del_flag' => null,
                'result_json' => $validated['json'],
            ];

            try {
                $existingPk = DB::table('urt_ai_hour')
                    ->where($attributes)
                    ->whereNull('del_flag')
                    ->orderByDesc('pk')
                    ->value('pk');

                if ($existingPk === null) {
                    DB::table('urt_ai_hour')->insert($attributes + $values + [
                        'ctime' => $now,
                    ]);
                } else {
                    DB::table('urt_ai_hour')
                        ->where('pk', $existingPk)
                        ->update($values);
                }
            } catch (Throwable $exception) {
                $this->logFailure($payload, 'write', [
                    'model' => $completion['model'],
                    'provider' => $completion['provider'],
                ], $exception);

                return $this->failedPayload(
                    payload: $payload,
                    reason: SensitiveTextRedactor::exception($exception, 240),
                    completion: $completion,
                );
            }

            return [
                'mode' => 'execute',
                'status' => 'success',
                'exit_code' => 0,
                'failed_rows' => 0,
                'source' => $payload['source'],
                'date_from' => $payload['date_from'],
                'date_to' => $payload['date_to'],
                'condition_type' => $payload['condition_type'],
                'prompt_video_rows' => $payload['prompt_video_rows'],
                'prompt_chars' => $payload['prompt_chars'],
                ...$this->sourceMeta($payload),
                'model' => $completion['model'],
                'provider' => $completion['provider'],
                'provider_failures' => $completion['provider_failures'],
                'usage' => $completion['usage'],
                'write_targets' => [
                    'urt_ai_hour.ctime',
                    'urt_ai_hour.mtime',
                    'urt_ai_hour.date_from',
                    'urt_ai_hour.date_to',
                    'urt_ai_hour.condition_type',
                    'urt_ai_hour.ai_type',
                    'urt_ai_hour.data_type',
                    'urt_ai_hour.user_token',
                    'urt_ai_hour.del_flag',
                    'urt_ai_hour.result_json',
                ],
                'upserted' => true,
                'inserted' => $existingPk === null,
                'updated' => $existingPk !== null,
                'ai_call_attempted' => true,
                'skipped' => false,
                'failed' => false,
                'skip_reason' => null,
                'secrets' => 'not_printed',
            ];
        } finally {
            $lock->release();
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>|null  $completion
     * @return array<string, mixed>
     */
    private function failedPayload(array $payload, string $reason, ?array $completion = null, bool $aiCallAttempted = true): array
    {
        return [
            'mode' => 'execute',
            'status' => 'failed',
            'exit_code' => 1,
            'failed_rows' => 1,
            'source' => $payload['source'],
            'date_from' => $payload['date_from'],
            'date_to' => $payload['date_to'],
            'condition_type' => $payload['condition_type'],
            'prompt_video_rows' => $payload['prompt_video_rows'],
            'prompt_chars' => $payload['prompt_chars'],
            ...$this->sourceMeta($payload),
            'model' => $completion['model'] ?? (string) config('services.opencode_go.model', 'sky-quality'),
            'provider' => $completion['provider'] ?? null,
            'provider_failures' => $completion['provider_failures'] ?? [],
            'usage' => $completion['usage'] ?? null,
            'write_targets' => [],
            'upserted' => false,
            'inserted' => false,
            'updated' => false,
            'ai_call_attempted' => $aiCallAttempted,
            'skipped' => true,
            'failed' => true,
            'skip_reason' => $reason,
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function sourceMeta(array $payload): array
    {
        return [
            'video_rows' => (int) ($payload['video_rows'] ?? 0),
            'prompt_video_limit' => (int) ($payload['prompt_video_limit'] ?? AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT),
            'prompt_video_limit_requested' => (int) ($payload['prompt_video_limit_requested'] ?? AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT),
            'prompt_video_limit_clamped' => (bool) ($payload['prompt_video_limit_clamped'] ?? false),
            'prompt_video_limit_max' => (int) ($payload['prompt_video_limit_max'] ?? AiHourlyPreview::MAX_PROMPT_VIDEO_LIMIT),
            'prompt_omitted_video_rows' => (int) ($payload['prompt_omitted_video_rows'] ?? 0),
            'source_complete' => (bool) ($payload['source_complete'] ?? true),
            'source_truncated' => (bool) ($payload['source_truncated'] ?? false),
            'blocked_reason' => $payload['blocked_reason'] ?? null,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $context
     */
    private function logFailure(array $payload, string $stage, array $context = [], ?Throwable $exception = null): void
    {
        if ($exception !== null) {
            $context['exception_class'] = $exception::class;
        }

        Log::warning('AI hourly ingestion failed.', [
            'stage' => $stage,
            'condition_type' => $payload['condition_type'],
            'date_from' => $payload['date_from'],
            'date_to' => $payload['date_to'],
        ] + $context);
    }

    private function validationFailureReason(Throwable $exception): ?string
    {
        return preg_match('/validation_failure_reason=([a-z0-9_]+)/', $exception->getMessage(), $matches) === 1
            ? $matches[1]
            : null;
    }
}
