<?php

namespace App\Services\Notifications;

use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Minimal OpenAI chat-completions client dedicated to the Telegram digest.
 *
 * Deliberately independent of the ingestion {@see \App\Services\Ingestion\OpenCodeChatClient}
 * (no JSON-schema/token-cap/business-lock machinery): the digest targets the full
 * gpt-5.4 model on the direct OpenAI endpoint via the `services.telegram.ai` config.
 */
class OpenAiChatClient
{
    /**
     * @param  array<string, mixed>  $options  Extra body fields (e.g. response_format).
     * @return array{content: string, model: string}
     */
    public function complete(string $system, string $user, array $options = []): array
    {
        $config = (array) config('services.telegram.ai', []);
        $apiKey = trim((string) ($config['api_key'] ?? ''));

        if ($apiKey === '') {
            throw new RuntimeException('Telegram digest OpenAI API key is not configured.');
        }

        $model = (string) ($config['model'] ?? 'gpt-5.4');

        $response = Http::baseUrl((string) ($config['base_url'] ?? 'https://api.openai.com/v1'))
            ->timeout((int) ($config['timeout'] ?? 60))
            ->withToken($apiKey)
            ->acceptJson()
            ->asJson()
            ->post('chat/completions', array_merge([
                'model' => $model,
                'messages' => [
                    ['role' => 'system', 'content' => $system],
                    ['role' => 'user', 'content' => $user],
                ],
                'max_completion_tokens' => (int) ($config['max_output_tokens'] ?? 900),
            ], $options))
            ->throw();

        $json = $response->json();

        return [
            'content' => (string) data_get($json, 'choices.0.message.content', ''),
            'model' => (string) data_get($json, 'model', $model),
        ];
    }
}
