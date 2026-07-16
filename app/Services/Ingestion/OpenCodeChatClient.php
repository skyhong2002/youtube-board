<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Response;
use RuntimeException;
use Throwable;

class OpenCodeChatClient
{
    public function __construct(
        private readonly HttpFactory $http,
        private readonly IngestionTelemetry $telemetry,
    ) {}

    /**
     * @return array{content: string, model: string, configured_model: string, provider: string, provider_failures: list<string>, usage: array<string, mixed>|null, latency_ms: int}
     */
    public function complete(string $prompt): array
    {
        return $this->completeInternal($prompt);
    }

    /**
     * @param  callable(string): array{valid: bool}  $validator
     * @param  array<string, mixed>|null  $jsonSchema
     * @return array{content: string, model: string, configured_model: string, provider: string, provider_failures: list<string>, usage: array<string, mixed>|null, latency_ms: int, validation: array<string, mixed>}
     */
    public function completeValidated(
        string $prompt,
        callable $validator,
        ?array $jsonSchema = null,
    ): array {
        return $this->completeInternal($prompt, $validator, $jsonSchema);
    }

    public function providerAttemptCapPerCompletion(): int
    {
        return count($this->providers()) * $this->attemptsPerProvider();
    }

    /**
     * @param  (callable(string): array{valid: bool})|null  $validator
     * @param  array<string, mixed>|null  $jsonSchema
     * @return array<string, mixed>
     */
    private function completeInternal(
        string $prompt,
        ?callable $validator = null,
        ?array $jsonSchema = null,
    ): array {
        $providers = $this->providers();
        $failures = [];
        $validationFailureReasons = [];

        if ($providers === []) {
            throw new RuntimeException('OPENAI_API_KEY is missing; secrets=not_printed');
        }

        foreach ($providers as $provider) {
            try {
                return $this->completeWithProvider(
                    $prompt,
                    $provider,
                    validator: $validator,
                    jsonSchema: $jsonSchema,
                ) + [
                    'provider' => $provider['name'],
                    'provider_failures' => $failures,
                ];
            } catch (Throwable $exception) {
                $failures[] = $provider['name'].': '.$this->sanitizedError($exception->getMessage(), $prompt);
                $validationFailureReasons[] = $exception instanceof AiPayloadValidationException
                    ? $exception->failureReason
                    : null;
            }
        }

        $validationFailurePrefix = '';
        $reasons = array_values(array_unique(array_filter(
            $validationFailureReasons,
            fn (mixed $reason): bool => is_string($reason) && $reason !== '',
        )));

        if ($reasons !== []) {
            $validationFailurePrefix = 'validation_failure_reason='.
                (count($reasons) === 1 ? $reasons[0] : 'invalid_ai_payload').' | ';
        }

        throw new RuntimeException(mb_strimwidth(
            'AI completion failed after '.count($failures).' provider(s): '.$validationFailurePrefix.
                implode(' | ', $failures).' secrets=not_printed',
            0,
            240,
            '...',
            'UTF-8',
        ));
    }

    /**
     * @return array{content: string, model: string, configured_model: string, provider: string, provider_failures: list<string>, usage: array<string, mixed>|null, latency_ms: int}
     */
    public function probe(string $providerName, string $prompt = 'Reply with OK.', int $maxTokens = 16): array
    {
        $providerName = strtolower(trim($providerName));
        $provider = collect($this->providers())
            ->first(fn (array $provider): bool => $provider['name'] === $providerName);

        if (! is_array($provider)) {
            throw new RuntimeException('AI provider '.$providerName.' is not configured; secrets=not_printed');
        }

        $started = hrtime(true);
        $completion = $this->completeWithProvider($prompt, $provider, max(1, min(128, $maxTokens)));

        return $completion + [
            'provider' => $provider['name'],
            'provider_failures' => [],
            'latency_ms' => (int) round((hrtime(true) - $started) / 1_000_000),
        ];
    }

    /**
     * @param  array{name: string, api_key: string, base_url: string, model: string, endpoint_style: string, timeout: int, max_tokens: int}  $provider
     * @param  (callable(string): array{valid: bool})|null  $validator
     * @return array<string, mixed>
     */
    private function completeWithProvider(
        string $prompt,
        array $provider,
        ?int $maxTokensOverride = null,
        ?callable $validator = null,
        ?array $jsonSchema = null,
    ): array {
        $apiKey = $provider['api_key'];
        $baseUrl = $provider['base_url'];
        $model = $provider['model'];
        $endpointStyle = $provider['endpoint_style'];
        $timeout = $provider['timeout'];
        $maxTokens = $maxTokensOverride === null
            ? $provider['max_tokens']
            : max(1, min($provider['max_tokens'], $maxTokensOverride));
        $messagesStyle = $this->usesMessagesEndpoint($model, $endpointStyle);
        $path = $messagesStyle ? '/messages' : '/chat/completions';
        $body = [
            'model' => $model,
            'messages' => [
                [
                    'role' => 'user',
                    'content' => $prompt,
                ],
            ],
            'temperature' => 0.2,
        ];
        $body[$messagesStyle || ! $this->usesCompletionTokenLimit($model)
            ? 'max_tokens'
            : 'max_completion_tokens'] = $maxTokens;
        $structuredOutput = $this->usesOfficialOpenAiStructuredOutput(
            $provider,
            $messagesStyle,
            $jsonSchema,
        );

        if ($structuredOutput) {
            $body['response_format'] = [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'validated_event_list',
                    'strict' => true,
                    'schema' => $jsonSchema,
                ],
            ];
        }
        $providerStarted = hrtime(true);
        $maxAttempts = $this->attemptsPerProvider();

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            $attemptStarted = hrtime(true);

            try {
                $response = $this->http
                    ->withToken($apiKey)
                    ->acceptJson()
                    ->asJson()
                    ->timeout($timeout)
                    ->post($baseUrl.$path, $body);
            } catch (Throwable $exception) {
                $error = $this->sanitizedError($exception->getMessage(), $prompt);
                $this->telemetry->recordAiRequest($this->requestTelemetry(
                    provider: $provider,
                    endpointStyle: $messagesStyle ? 'messages' : 'chat',
                    prompt: $prompt,
                    latencyMs: $this->elapsedMs($attemptStarted),
                    ok: false,
                    status: null,
                    usage: null,
                    content: null,
                    error: $error,
                    attempt: $attempt,
                    structuredOutput: $structuredOutput,
                ));

                throw new RuntimeException('AI provider connection failed: '.$error);
            }

            $latencyMs = $this->elapsedMs($attemptStarted);
            $decoded = $response->json();
            $payload = is_array($decoded) ? $decoded : [];
            $usage = $this->sanitizedUsage(data_get($payload, 'usage'));
            $responseModelSnapshot = $this->sanitizedResponseModel($payload['model'] ?? null);

            if (! $response->successful()) {
                $message = 'status='.$response->status().' endpoint_style='.($messagesStyle ? 'messages' : 'chat');
                $transientRetry = $this->isTransientFailure($response) && $attempt < $maxAttempts;
                $retryDelayMs = $transientRetry ? $this->retryDelayMs($response) : null;
                $this->telemetry->recordAiRequest($this->requestTelemetry(
                    provider: $provider,
                    endpointStyle: $messagesStyle ? 'messages' : 'chat',
                    prompt: $prompt,
                    latencyMs: $latencyMs,
                    ok: false,
                    status: $response->status(),
                    usage: $usage,
                    content: null,
                    error: $message,
                    attempt: $attempt,
                    transientRetry: $transientRetry,
                    retryDelayMs: $retryDelayMs,
                    structuredOutput: $structuredOutput,
                    responseModel: $responseModelSnapshot,
                ));

                if ($transientRetry) {
                    $this->retryDelay($retryDelayMs ?? 0);

                    continue;
                }

                throw new RuntimeException($message);
            }

            $terminationReason = $this->terminationReason($payload, $messagesStyle);

            if ($this->isTruncationReason($terminationReason)) {
                $reasonField = $messagesStyle ? 'stop_reason' : 'finish_reason';
                $message = 'truncated_response endpoint_style='.
                    ($messagesStyle ? 'messages' : 'chat').' '.$reasonField.'='.$terminationReason;
                $this->telemetry->recordAiRequest($this->requestTelemetry(
                    provider: $provider,
                    endpointStyle: $messagesStyle ? 'messages' : 'chat',
                    prompt: $prompt,
                    latencyMs: $latencyMs,
                    ok: false,
                    status: $response->status(),
                    usage: $usage,
                    content: null,
                    error: $message,
                    attempt: $attempt,
                    terminationReason: $terminationReason,
                    structuredOutput: $structuredOutput,
                    responseModel: $responseModelSnapshot,
                ));

                throw new RuntimeException($message);
            }

            $content = $messagesStyle
                ? $this->extractMessagesContent($payload)
                : $this->extractChatContent($payload);

            if (! is_string($content) || trim($content) === '') {
                $this->telemetry->recordAiRequest($this->requestTelemetry(
                    provider: $provider,
                    endpointStyle: $messagesStyle ? 'messages' : 'chat',
                    prompt: $prompt,
                    latencyMs: $latencyMs,
                    ok: false,
                    status: $response->status(),
                    usage: $usage,
                    content: null,
                    error: 'empty_message endpoint_style='.($messagesStyle ? 'messages' : 'chat'),
                    attempt: $attempt,
                    terminationReason: $terminationReason,
                    structuredOutput: $structuredOutput,
                    responseModel: $responseModelSnapshot,
                ));

                throw new RuntimeException('empty_message endpoint_style='.($messagesStyle ? 'messages' : 'chat'));
            }

            $validation = null;

            if ($validator !== null) {
                try {
                    $candidateValidation = $validator($content);
                } catch (Throwable) {
                    $candidateValidation = null;
                }

                if (! is_array($candidateValidation) || ($candidateValidation['valid'] ?? false) !== true) {
                    $validationFailureReason = $this->safeValidationFailureReason($candidateValidation);
                    $this->telemetry->recordAiRequest($this->requestTelemetry(
                        provider: $provider,
                        endpointStyle: $messagesStyle ? 'messages' : 'chat',
                        prompt: $prompt,
                        latencyMs: $latencyMs,
                        ok: false,
                        status: $response->status(),
                        usage: $usage,
                        content: null,
                        error: 'validation_rejected',
                        attempt: $attempt,
                        terminationReason: $terminationReason,
                        completionChars: mb_strlen($content, 'UTF-8'),
                        structuredOutput: $structuredOutput,
                        validationFailureReason: $validationFailureReason,
                        responseModel: $responseModelSnapshot,
                    ));

                    throw new AiPayloadValidationException($validationFailureReason);
                }

                $validation = $candidateValidation;
            }

            $responseModel = is_string($payload['model'] ?? null) && trim((string) $payload['model']) !== ''
                ? trim((string) $payload['model'])
                : $model;
            $this->telemetry->recordAiRequest($this->requestTelemetry(
                provider: $provider,
                endpointStyle: $messagesStyle ? 'messages' : 'chat',
                prompt: $prompt,
                latencyMs: $latencyMs,
                ok: true,
                status: $response->status(),
                usage: $usage,
                content: $content,
                error: null,
                attempt: $attempt,
                terminationReason: $terminationReason,
                structuredOutput: $structuredOutput,
                responseModel: $responseModelSnapshot,
            ));

            $completion = [
                'content' => $content,
                'model' => $responseModel,
                'configured_model' => $model,
                'usage' => $usage,
                'latency_ms' => $this->elapsedMs($providerStarted),
            ];

            if ($validation !== null) {
                $completion['validation'] = $validation;
            }

            return $completion;
        }

        throw new RuntimeException('AI provider failed without a response.');
    }

    /**
     * @return list<array{name: string, api_key: string, base_url: string, model: string, endpoint_style: string, timeout: int, max_tokens: int}>
     */
    private function providers(): array
    {
        $providers = [];
        $primary = $this->provider(
            name: 'primary',
            apiKey: config('services.opencode_go.api_key'),
            baseUrl: config('services.opencode_go.base_url'),
            model: config('services.opencode_go.model', 'qwen3.6-plus'),
            endpointStyle: config('services.opencode_go.endpoint_style', 'auto'),
            timeout: config('services.opencode_go.timeout', 180),
            maxTokens: config('services.opencode_go.max_tokens', 4096),
        );

        if ($primary !== null) {
            $providers[] = $primary;
        }

        $fallback = $this->provider(
            name: 'fallback',
            apiKey: config('services.opencode_go.fallback_api_key'),
            baseUrl: config('services.opencode_go.fallback_base_url'),
            model: config('services.opencode_go.fallback_model'),
            endpointStyle: config('services.opencode_go.fallback_endpoint_style', 'auto'),
            timeout: config('services.opencode_go.fallback_timeout', config('services.opencode_go.timeout', 180)),
            maxTokens: config('services.opencode_go.fallback_max_tokens', config('services.opencode_go.max_tokens', 4096)),
        );

        if ($fallback !== null) {
            $providers[] = $fallback;
        }

        return $providers;
    }

    /**
     * @return array{name: string, api_key: string, base_url: string, model: string, endpoint_style: string, timeout: int, max_tokens: int}|null
     */
    private function provider(
        string $name,
        mixed $apiKey,
        mixed $baseUrl,
        mixed $model,
        mixed $endpointStyle,
        mixed $timeout,
        mixed $maxTokens,
    ): ?array {
        $apiKey = is_string($apiKey) ? trim($apiKey) : '';
        $baseUrl = is_string($baseUrl) ? rtrim(trim($baseUrl), '/') : '';
        $model = is_string($model) ? trim($model) : '';
        $endpointStyle = is_string($endpointStyle) ? trim($endpointStyle) : 'auto';

        if ($apiKey === '' || $baseUrl === '' || $model === '') {
            return null;
        }

        return [
            'name' => $name,
            'api_key' => $apiKey,
            'base_url' => $baseUrl,
            'model' => $model,
            'endpoint_style' => $endpointStyle,
            'timeout' => max(5, (int) $timeout),
            'max_tokens' => max(128, (int) $maxTokens),
        ];
    }

    private function usesMessagesEndpoint(string $model, string $endpointStyle): bool
    {
        $style = strtolower($endpointStyle);

        if ($style === 'messages') {
            return true;
        }

        if ($style === 'chat') {
            return false;
        }

        return in_array($model, [
            'minimax-m2.5',
            'minimax-m2.7',
        ], true);
    }

    private function usesCompletionTokenLimit(string $model): bool
    {
        return str_starts_with(strtolower($model), 'gpt-5');
    }

    /**
     * @param  array{name: string, api_key: string, base_url: string, model: string, endpoint_style: string, timeout: int, max_tokens: int}  $provider
     * @param  array<string, mixed>|null  $jsonSchema
     */
    private function usesOfficialOpenAiStructuredOutput(
        array $provider,
        bool $messagesStyle,
        ?array $jsonSchema,
    ): bool {
        if ($jsonSchema === null || $messagesStyle || $provider['name'] !== 'primary') {
            return false;
        }

        $scheme = parse_url($provider['base_url'], PHP_URL_SCHEME);
        $host = parse_url($provider['base_url'], PHP_URL_HOST);
        $port = parse_url($provider['base_url'], PHP_URL_PORT);

        return is_string($scheme)
            && strtolower($scheme) === 'https'
            && is_string($host)
            && strtolower($host) === 'api.openai.com'
            && ($port === null || $port === 443);
    }

    /**
     * @param  array<string, mixed>|null  $validation
     */
    private function safeValidationFailureReason(?array $validation): string
    {
        $reason = is_string($validation['failure_reason'] ?? null)
            ? $validation['failure_reason']
            : '';

        return in_array($reason, [
            'invalid_ai_json',
            'invalid_ai_payload',
            'invalid_ai_payload_shape',
            'ai_payload_item_count_below_minimum',
            'ai_payload_item_count_above_maximum',
        ], true) ? $reason : 'invalid_ai_payload';
    }

    private function sanitizedResponseModel(mixed $model): ?string
    {
        if (! is_string($model) || trim($model) === '') {
            return null;
        }

        $model = trim($model);

        return preg_match('/^[a-zA-Z0-9][a-zA-Z0-9._:\/-]{0,127}$/', $model) === 1
            ? $model
            : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function terminationReason(array $payload, bool $messagesStyle): ?string
    {
        $candidates = $messagesStyle
            ? [
                data_get($payload, 'stop_reason'),
                data_get($payload, 'choices.0.stop_reason'),
                data_get($payload, 'choices.0.finish_reason'),
            ]
            : [
                data_get($payload, 'choices.0.finish_reason'),
                data_get($payload, 'choices.0.stop_reason'),
                data_get($payload, 'choices.0.finish_details.type'),
                data_get($payload, 'choices.0.finish_details.reason'),
                data_get($payload, 'incomplete_details.reason'),
                data_get($payload, 'stop_reason'),
            ];

        foreach ($candidates as $candidate) {
            if (! is_string($candidate) || trim($candidate) === '') {
                continue;
            }

            $reason = preg_replace('/[^a-z0-9._-]+/', '_', strtolower(trim($candidate))) ?? '';

            return in_array($reason, [
                'stop',
                'length',
                'content_filter',
                'tool_calls',
                'function_call',
                'end_turn',
                'stop_sequence',
                'tool_use',
                'pause_turn',
                'refusal',
                'max_tokens',
                'max_output_tokens',
                'max_completion_tokens',
                'token_limit',
                'token_limit_reached',
                'max_token_limit',
                'max_length',
                'limit',
            ], true) ? $reason : 'other';
        }

        return null;
    }

    private function isTruncationReason(?string $reason): bool
    {
        return in_array($reason, [
            'length',
            'max_tokens',
            'max_output_tokens',
            'max_completion_tokens',
            'token_limit',
            'token_limit_reached',
            'max_token_limit',
            'max_length',
            'limit',
        ], true);
    }

    private function isTransientFailure(Response $response): bool
    {
        return $response->status() === 429 || $response->serverError();
    }

    private function attemptsPerProvider(): int
    {
        return 1 + max(0, min(3, (int) config('services.opencode_go.transient_retries', 1)));
    }

    private function retryDelayMs(Response $response): int
    {
        $maximum = max(0, min(10_000, (int) config('services.opencode_go.retry_after_max_ms', 2000)));
        $fallback = max(0, min($maximum, (int) config('services.opencode_go.retry_delay_ms', 250)));
        $retryAfter = $response->header('Retry-After');

        if (is_string($retryAfter) && trim($retryAfter) !== '') {
            $milliseconds = $this->retryAfterMilliseconds(trim($retryAfter));

            if ($milliseconds !== null) {
                return min($maximum, $milliseconds);
            }
        }

        $retryAfterMilliseconds = $response->header('Retry-After-Ms');

        if (is_string($retryAfterMilliseconds) && is_numeric(trim($retryAfterMilliseconds))) {
            return min($maximum, max(0, (int) ceil((float) trim($retryAfterMilliseconds))));
        }

        return $fallback;
    }

    private function retryAfterMilliseconds(string $value): ?int
    {
        if (is_numeric($value)) {
            return max(0, (int) ceil((float) $value * 1000));
        }

        $timestamp = strtotime($value);

        return $timestamp === false ? null : max(0, ($timestamp - time()) * 1000);
    }

    private function retryDelay(int $milliseconds): void
    {
        if ($milliseconds > 0) {
            usleep($milliseconds * 1000);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function extractChatContent(array $payload): ?string
    {
        $content = data_get($payload, 'choices.0.message.content');
        $text = $this->stringifyContent($content);

        if ($text !== null && trim($text) !== '') {
            return $text;
        }

        return $this->stringifyContent(data_get($payload, 'choices.0.message.reasoning_content'));
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function extractMessagesContent(array $payload): ?string
    {
        return $this->stringifyContent(data_get($payload, 'content'));
    }

    /**
     * @return array<string|int, mixed>|null
     */
    private function sanitizedUsage(mixed $usage): ?array
    {
        if (! is_array($usage)) {
            return null;
        }

        $sanitized = [];

        foreach ($usage as $key => $value) {
            $safeKey = is_int($key)
                ? $key
                : mb_strimwidth(
                    preg_replace('/[^a-z0-9._-]+/', '_', strtolower((string) $key)) ?? '',
                    0,
                    64,
                    '',
                    'UTF-8',
                );

            if ($safeKey === '') {
                continue;
            }

            if (is_int($value) || is_float($value)) {
                $sanitized[$safeKey] = $value;

                continue;
            }

            $nested = $this->sanitizedUsage($value);

            if ($nested !== null) {
                $sanitized[$safeKey] = $nested;
            }
        }

        return $sanitized === [] ? null : $sanitized;
    }

    private function stringifyContent(mixed $content): ?string
    {
        if (is_string($content)) {
            return $content;
        }

        if (! is_array($content)) {
            return null;
        }

        $parts = [];

        foreach ($content as $part) {
            if (is_string($part)) {
                $parts[] = $part;

                continue;
            }

            if (is_array($part) && is_string($part['text'] ?? null)) {
                $parts[] = $part['text'];
            }
        }

        return $parts === [] ? null : implode("\n", $parts);
    }

    /**
     * @param  array{name: string, api_key: string, base_url: string, model: string, endpoint_style: string, timeout: int, max_tokens: int}  $provider
     * @param  array<string, mixed>|null  $usage
     * @return array<string, mixed>
     */
    private function requestTelemetry(
        array $provider,
        string $endpointStyle,
        string $prompt,
        int $latencyMs,
        bool $ok,
        ?int $status,
        ?array $usage,
        ?string $content,
        ?string $error,
        int $attempt = 1,
        bool $transientRetry = false,
        ?int $retryDelayMs = null,
        ?string $terminationReason = null,
        ?int $completionChars = null,
        bool $structuredOutput = false,
        ?string $validationFailureReason = null,
        ?string $responseModel = null,
    ): array {
        return [
            'api' => 'openai_compatible_chat',
            'provider' => $provider['name'],
            'model' => $provider['model'],
            'response_model' => $responseModel,
            'endpoint_style' => $endpointStyle,
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'completion_chars' => $completionChars ?? (is_string($content) ? mb_strlen($content, 'UTF-8') : 0),
            'usage' => $usage,
            'latency_ms' => $latencyMs,
            'status' => $status,
            'ok' => $ok,
            'error' => $error,
            'attempt' => $attempt,
            'transient_retry' => $transientRetry,
            'retry_delay_ms' => $retryDelayMs,
            'termination_reason' => $terminationReason,
            'structured_output' => $structuredOutput,
            'validation_failure_reason' => $validationFailureReason,
            'finish_reason' => $endpointStyle === 'chat' ? $terminationReason : null,
            'stop_reason' => $endpointStyle === 'messages' ? $terminationReason : null,
            'secrets' => 'not_printed',
        ];
    }

    private function elapsedMs(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }

    private function sanitizedError(string $message, ?string $prompt = null): string
    {
        return SensitiveTextRedactor::redact($message, 240, [$prompt]);
    }
}

final class AiPayloadValidationException extends RuntimeException
{
    public function __construct(public readonly string $failureReason)
    {
        parent::__construct('validation_rejected');
    }
}
