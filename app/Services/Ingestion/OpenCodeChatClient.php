<?php

namespace App\Services\Ingestion;

use Illuminate\Http\Client\Factory as HttpFactory;
use RuntimeException;

class OpenCodeChatClient
{
    public function __construct(private readonly HttpFactory $http)
    {
    }

    /**
     * @return array{content: string, model: string, usage: array<string, mixed>|null}
     */
    public function complete(string $prompt): array
    {
        $apiKey = (string) config('services.opencode_go.api_key', '');
        $baseUrl = rtrim((string) config('services.opencode_go.base_url', ''), '/');
        $model = (string) config('services.opencode_go.model', 'qwen3.6-plus');
        $endpointStyle = (string) config('services.opencode_go.endpoint_style', 'auto');
        $timeout = max(5, (int) config('services.opencode_go.timeout', 180));
        $maxTokens = max(128, (int) config('services.opencode_go.max_tokens', 1200));

        if ($apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY is missing; secrets=not_printed');
        }

        if ($baseUrl === '') {
            throw new RuntimeException('OPENAI_BASE_URL is missing; secrets=not_printed');
        }

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

        $response = $this->http
            ->withToken($apiKey)
            ->acceptJson()
            ->asJson()
            ->timeout($timeout)
            ->post($baseUrl.$path, $body);

        if (! $response->successful()) {
            throw new RuntimeException('OpenCode completion failed status='.$response->status().' endpoint_style='.($messagesStyle ? 'messages' : 'chat').' secrets=not_printed');
        }

        $payload = $response->json();
        $content = $messagesStyle
            ? $this->extractMessagesContent($payload)
            : $this->extractChatContent($payload);

        if (! is_string($content) || trim($content) === '') {
            throw new RuntimeException('OpenCode completion returned an empty message endpoint_style='.($messagesStyle ? 'messages' : 'chat').' secrets=not_printed');
        }

        return [
            'content' => $content,
            'model' => $model,
            'usage' => is_array(data_get($payload, 'usage')) ? data_get($payload, 'usage') : null,
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
            'qwen3.6-plus',
            'qwen3.5-plus',
            'minimax-m2.7',
            'minimax-m2.5',
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
}
