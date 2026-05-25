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
        $timeout = max(5, (int) config('services.opencode_go.timeout', 180));
        $maxTokens = max(128, (int) config('services.opencode_go.max_tokens', 1200));

        if ($apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY is missing; secrets=not_printed');
        }

        if ($baseUrl === '') {
            throw new RuntimeException('OPENAI_BASE_URL is missing; secrets=not_printed');
        }

        $response = $this->http
            ->withToken($apiKey)
            ->acceptJson()
            ->asJson()
            ->timeout($timeout)
            ->post($baseUrl.'/chat/completions', [
                'model' => $model,
                'messages' => [
                    [
                        'role' => 'user',
                        'content' => $prompt,
                    ],
                ],
                'temperature' => 0.2,
                'max_tokens' => $maxTokens,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException('OpenCode chat completion failed status='.$response->status().' secrets=not_printed');
        }

        $payload = $response->json();
        $content = data_get($payload, 'choices.0.message.content');

        if (! is_string($content) || trim($content) === '') {
            throw new RuntimeException('OpenCode chat completion returned an empty message; secrets=not_printed');
        }

        return [
            'content' => $content,
            'model' => $model,
            'usage' => is_array(data_get($payload, 'usage')) ? data_get($payload, 'usage') : null,
        ];
    }
}
