<?php

namespace Tests\Unit;

use App\Support\SensitiveTextRedactor;
use RuntimeException;
use Tests\TestCase;

class SensitiveTextRedactorTest extends TestCase
{
    public function test_it_redacts_common_secret_shapes_and_configured_values(): void
    {
        config()->set('app.key', 'base64:configured-app-key');
        config()->set('database.connections.mysql.password', 'configured-db-password');
        config()->set('services.youtube.api_key', 'configured-youtube-key');
        config()->set('services.youtube.api_keys', 'fallback-one,fallback-two');
        config()->set('services.opencode_go.api_key', 'configured-ai-key');
        config()->set('services.opencode_go.fallback_api_key', 'configured-fallback-ai-key');
        config()->set('services.dokploy.deploy_webhook_url', 'https://deploy.test/hook/configured-webhook-token');
        config()->set('services.dokploy.deploy_relay_secret', 'configured-relay-secret');

        $message = implode(' ', [
            'https://api.test/items?key=query-secret&token=token-secret',
            'Bearer bearer-secret',
            'password=db-secret',
            'authorization: auth-secret',
            'webhook_url="https://hooks.test/private"',
            '{"access_token":"json-secret"}',
            'Authorization: Basic basic-header-secret',
            "Cookie: session=cookie-secret; theme=second-cookie-secret\nnext-header: retained",
            'https://basic-user:basic-password@example.test/path',
            'base64:configured-app-key configured-db-password configured-youtube-key',
            'fallback-one fallback-two configured-ai-key configured-fallback-ai-key',
            'https://deploy.test/hook/configured-webhook-token configured-relay-secret',
            '-----BEGIN PRIVATE KEY----- private-material -----END PRIVATE KEY-----',
        ]);

        $redacted = SensitiveTextRedactor::redact($message, 5000);

        $this->assertStringContainsString('<redacted>', $redacted);
        foreach ([
            'query-secret',
            'token-secret',
            'bearer-secret',
            'db-secret',
            'auth-secret',
            'hooks.test/private',
            'json-secret',
            'basic-header-secret',
            'cookie-secret',
            'second-cookie-secret',
            'basic-user',
            'basic-password',
            'configured-app-key',
            'configured-db-password',
            'configured-youtube-key',
            'fallback-one',
            'fallback-two',
            'configured-ai-key',
            'configured-fallback-ai-key',
            'configured-webhook-token',
            'configured-relay-secret',
            'private-material',
        ] as $secret) {
            $this->assertStringNotContainsString($secret, $redacted);
        }
        $this->assertStringContainsString('next-header: retained', $redacted);
    }

    public function test_exception_output_is_bounded_after_redaction(): void
    {
        $redacted = SensitiveTextRedactor::exception(
            new RuntimeException('token=super-secret '.str_repeat('x', 1000)),
            80,
        );

        $this->assertLessThanOrEqual(83, mb_strwidth($redacted, 'UTF-8'));
        $this->assertStringContainsString('token=<redacted>', $redacted);
        $this->assertStringNotContainsString('super-secret', $redacted);
    }
}
