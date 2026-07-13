<?php

namespace App\Support;

use Throwable;

final class SensitiveTextRedactor
{
    /**
     * @param  iterable<mixed>  $additionalSecrets
     */
    public static function redact(string $message, int $width = 500, iterable $additionalSecrets = []): string
    {
        $message = preg_replace(
            '/-----BEGIN [^-]+-----.*?-----END [^-]+-----/s',
            '[redacted private key]',
            $message,
        ) ?? $message;
        $message = preg_replace(
            '/([?&](?:api[_-]?key|key|access[_-]?token|refresh[_-]?token|token|password|secret|signature)=)[^&\s]+/i',
            '$1<redacted>',
            $message,
        ) ?? $message;
        $message = preg_replace('/\bBearer\s+\S+/i', 'Bearer <redacted>', $message) ?? $message;
        $message = preg_replace(
            '/\b((?:Proxy-)?Authorization)\s*:\s*[^\r\n]*/i',
            '$1: <redacted>',
            $message,
        ) ?? $message;
        $message = preg_replace('/\b(Set-Cookie|Cookie)\s*:\s*[^\r\n]*/i', '$1: <redacted>', $message) ?? $message;
        $message = preg_replace(
            '/(["\']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token|authorization|signature|webhook(?:[_-]?url)?)["\']?\s*[:=]\s*)(?:"[^"]*"|\'[^\']*\'|[^,;\s]+)/i',
            '$1<redacted>',
            $message,
        ) ?? $message;
        $message = preg_replace(
            '#(https?://)([^/@\s:]+):([^/@\s]+)@#i',
            '$1<redacted>:<redacted>@',
            $message,
        ) ?? $message;

        foreach ([...self::configuredSecrets(), ...$additionalSecrets] as $secret) {
            if (! is_string($secret) || trim($secret) === '') {
                continue;
            }

            $message = str_replace(trim($secret), '<redacted>', $message);
        }

        return mb_strimwidth($message, 0, max(1, $width), '...', 'UTF-8');
    }

    /**
     * @param  iterable<mixed>  $additionalSecrets
     */
    public static function exception(
        Throwable $exception,
        int $width = 500,
        iterable $additionalSecrets = [],
    ): string {
        return self::redact($exception->getMessage(), $width, $additionalSecrets);
    }

    /**
     * @return list<mixed>
     */
    private static function configuredSecrets(): array
    {
        return [
            config('app.key'),
            config('database.connections.mysql.password'),
            config('services.youtube.api_key'),
            ...explode(',', (string) config('services.youtube.api_keys', '')),
            config('services.opencode_go.api_key'),
            config('services.opencode_go.fallback_api_key'),
            config('services.dokploy.deploy_webhook_url'),
            config('services.dokploy.deploy_relay_secret'),
        ];
    }
}
