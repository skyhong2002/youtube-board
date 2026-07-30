<?php

namespace App\Services\Notifications;

use Illuminate\Support\Facades\Http;

/**
 * Sends a formatted post to the configured Telegram channel.
 *
 * Fails safe to dry-run: unless `services.telegram.enabled` is true AND a bot
 * token and channel id are configured, nothing is sent (the caller logs the
 * rendered message instead). This keeps the feature inert until the operator
 * explicitly turns it on.
 */
class TelegramClient
{
    /**
     * True when a real send would happen (enabled with bot token + channel).
     */
    public function isLive(): bool
    {
        $config = (array) config('services.telegram', []);

        return (bool) ($config['enabled'] ?? false)
            && trim((string) ($config['bot_token'] ?? '')) !== ''
            && trim((string) ($config['channel_id'] ?? '')) !== '';
    }

    /**
     * @return array{sent: bool, dry_run: bool, ok: bool, error: string|null}
     */
    public function send(string $html, ?string $previewUrl = null): array
    {
        $config = (array) config('services.telegram', []);
        $token = trim((string) ($config['bot_token'] ?? ''));
        $channel = trim((string) ($config['channel_id'] ?? ''));

        if (! ($config['enabled'] ?? false) || $token === '' || $channel === '') {
            return ['sent' => false, 'dry_run' => true, 'ok' => false, 'error' => null];
        }

        try {
            $linkPreview = $previewUrl !== null && str_starts_with($previewUrl, 'https://')
                ? [
                    'is_disabled' => false,
                    'url' => $previewUrl,
                    'prefer_large_media' => true,
                    'show_above_text' => false,
                ]
                : ['is_disabled' => true];

            $response = Http::baseUrl((string) ($config['api_base_url'] ?? 'https://api.telegram.org'))
                ->timeout((int) ($config['timeout'] ?? 15))
                ->asJson()
                ->post('/bot'.$token.'/sendMessage', [
                    'chat_id' => $channel,
                    'text' => $html,
                    'parse_mode' => 'HTML',
                    'link_preview_options' => $linkPreview,
                ]);
        } catch (\Throwable $exception) {
            // A timeout on one post must not abort the rest of the digest batch;
            // the unmarked post is retried naturally on the next scheduled run.
            return [
                'sent' => false,
                'dry_run' => false,
                'ok' => false,
                'error' => 'telegram send failed: '.$exception::class,
            ];
        }

        $ok = $response->successful() && (bool) data_get($response->json(), 'ok', false);

        return [
            'sent' => $ok,
            'dry_run' => false,
            'ok' => $ok,
            'error' => $ok ? null : (string) data_get($response->json(), 'description', 'telegram sendMessage failed'),
        ];
    }
}
