<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;
use Throwable;

class OpenCodeChatClient
{
    public function __construct(
        private readonly HttpFactory $http,
        private readonly IngestionTelemetry $telemetry,
    ) {}

    /**
     * @return array{content: string, model: string, provider: string, provider_failures: list<string>, usage: array<string, mixed>|null, latency_ms: int}
     */
    public function complete(string $prompt): array
    {
        $providers = $this->providers();
        $failures = [];

        if ($providers === []) {
            throw new RuntimeException('OPENAI_API_KEY is missing; secrets=not_printed');
        }

        foreach ($providers as $provider) {
            try {
                return $this->completeWithProvider($prompt, $provider) + [
                    'provider' => $provider['name'],
                    'provider_failures' => $failures,
                ];
            } catch (Throwable $exception) {
                $failures[] = $provider['name'].': '.$this->sanitizedError($exception->getMessage());
            }
        }

        throw new RuntimeException(mb_strimwidth(
            'OpenCode completion failed after '.count($failures).' provider(s): '.implode(' | ', $failures).' secrets=not_printed',
            0,
            240,
            '...',
            'UTF-8',
        ));
    }

    /**
     * @return array{content: string, model: string, provider: string, provider_failures: list<string>, usage: array<string, mixed>|null, latency_ms: int}
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
     * @return array{content: string, model: string, usage: array<string, mixed>|null, latency_ms: int}
     */
    private function completeWithProvider(string $prompt, array $provider, ?int $maxTokensOverride = null): array
    {
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
        $body = $messagesStyle
            ? [
                'model' => $model,
                'messages' => [
                    [
                        'role' => 'user',
                        'content' => $prompt,
                    ],
                ],
                'temperature' => 0.2,
                'max_tokens' => $maxTokens,
            ]
            : [
                'model' => $model,
                'messages' => [
                    [
                        'role' => 'user',
                        'content' => $prompt,
                    ],
                ],
                'temperature' => 0.2,
                'max_tokens' => $maxTokens,
            ];
        $started = hrtime(true);

        try {
            $response = $this->http
                ->withToken($apiKey)
                ->acceptJson()
                ->asJson()
                ->timeout($timeout)
                ->post($baseUrl.$path, $body);
        } catch (Throwable $exception) {
            $this->telemetry->recordAiRequest($this->requestTelemetry(
                provider: $provider,
                endpointStyle: $messagesStyle ? 'messages' : 'chat',
                prompt: $prompt,
                latencyMs: $this->elapsedMs($started),
                ok: false,
                status: null,
                usage: null,
                content: null,
                error: $this->sanitizedError($exception->getMessage()),
            ));

            throw new RuntimeException(
                'AI provider connection failed: '.$this->sanitizedError($exception->getMessage()),
            );
        }

        $latencyMs = $this->elapsedMs($started);

        if (! $response->successful()) {
            $message = 'status='.$response->status().' endpoint_style='.($messagesStyle ? 'messages' : 'chat');
            $error = $this->responseErrorMessage($response->json());

            if ($error !== null) {
                $message .= ' error='.$error;
            }

            $this->telemetry->recordAiRequest($this->requestTelemetry(
                provider: $provider,
                endpointStyle: $messagesStyle ? 'messages' : 'chat',
                prompt: $prompt,
                latencyMs: $latencyMs,
                ok: false,
                status: $response->status(),
                usage: is_array(data_get($response->json(), 'usage')) ? data_get($response->json(), 'usage') : null,
                content: null,
                error: $this->sanitizedError($message),
            ));

            throw new RuntimeException($this->sanitizedError($message));
        }

        $payload = $response->json();
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
                usage: is_array(data_get($payload, 'usage')) ? data_get($payload, 'usage') : null,
                content: null,
                error: 'empty_message endpoint_style='.($messagesStyle ? 'messages' : 'chat'),
            ));

            throw new RuntimeException('empty_message endpoint_style='.($messagesStyle ? 'messages' : 'chat'));
        }

        $usage = is_array(data_get($payload, 'usage')) ? data_get($payload, 'usage') : null;
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
        ));

        return [
            'content' => $content,
            'model' => $model,
            'usage' => $usage,
            'latency_ms' => $latencyMs,
        ];
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
            maxTokens: config('services.opencode_go.max_tokens', 1200),
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
            maxTokens: config('services.opencode_go.fallback_max_tokens', config('services.opencode_go.max_tokens', 1200)),
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

    private function responseErrorMessage(mixed $payload): ?string
    {
        if (! is_array($payload)) {
            return null;
        }

        $message = data_get($payload, 'error.message') ?? data_get($payload, 'message');

        if (! is_string($message) || trim($message) === '') {
            return null;
        }

        return mb_strimwidth(
            preg_replace('/\s+/', ' ', trim($message)) ?? trim($message),
            0,
            160,
            '...',
            'UTF-8',
        );
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
    ): array {
        return [
            'api' => 'openai_compatible_chat',
            'provider' => $provider['name'],
            'model' => $provider['model'],
            'endpoint_style' => $endpointStyle,
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'completion_chars' => is_string($content) ? mb_strlen($content, 'UTF-8') : 0,
            'usage' => $usage,
            'latency_ms' => $latencyMs,
            'status' => $status,
            'ok' => $ok,
            'error' => $error,
            'secrets' => 'not_printed',
        ];
    }

    private function elapsedMs(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }

    private function sanitizedError(string $message): string
    {
        return SensitiveTextRedactor::redact($message, 240);
    }
}
