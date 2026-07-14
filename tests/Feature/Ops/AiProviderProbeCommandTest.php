<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\OpenCodeChatClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AiProviderProbeCommandTest extends TestCase
{
    public function test_ai_provider_probe_can_validate_fallback_without_primary_provider(): void
    {
        config()->set('services.opencode_go.api_key', null);
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.fallback_model', 'gpt-4o-mini');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');

        Http::fake([
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => 'OK',
                        ],
                    ],
                ],
                'usage' => ['prompt_tokens' => 4, 'completion_tokens' => 1, 'total_tokens' => 5],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'fallback',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('probe', $payload['mode']);
        $this->assertSame('not_printed', $payload['secrets']);
        $this->assertSame(['ok' => 1, 'failed' => 0], $payload['summary']);
        $this->assertSame('fallback', $payload['providers'][0]['provider']);
        $this->assertTrue($payload['providers'][0]['ok']);
        $this->assertSame('gpt-4o-mini', $payload['providers'][0]['model']);
        $this->assertSame(['prompt_tokens' => 4, 'completion_tokens' => 1, 'total_tokens' => 5], $payload['providers'][0]['usage']);
        $this->assertStringNotContainsString('fallback-key', Artisan::output());

        Http::assertSentCount(1);
        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://api.openai.test/v1/chat/completions'
                && $request->hasHeader('Authorization', 'Bearer fallback-key')
                && $request['model'] === 'gpt-4o-mini'
                && $request['max_tokens'] === 16;
        });
    }

    public function test_ai_provider_probe_uses_completion_token_limit_for_gpt_five_models(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');

        Http::fake([
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'primary',
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://api.openai.test/v1/chat/completions'
                && $request['model'] === 'gpt-5.4-mini'
                && $request['max_completion_tokens'] === 16
                && ! isset($request['max_tokens']);
        });
    }

    public function test_ai_connection_failure_is_sanitized_and_falls_back(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-super-secret');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'primary-model');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-super-secret');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'fallback-model');

        $attempts = 0;
        Http::fake(function (Request $request) use (&$attempts) {
            $attempts++;

            if (str_starts_with($request->url(), 'https://primary.test/')) {
                throw new ConnectionException(
                    'failed https://primary.test/v1/chat/completions?token=primary-super-secret Bearer primary-super-secret',
                );
            }

            return Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]);
        });

        $result = app(OpenCodeChatClient::class)->complete('Reply OK');

        $this->assertSame('fallback', $result['provider']);
        $this->assertCount(1, $result['provider_failures']);
        $this->assertStringContainsString('<redacted>', $result['provider_failures'][0]);
        $this->assertStringNotContainsString('primary-super-secret', $result['provider_failures'][0]);
        $this->assertStringNotContainsString('fallback-super-secret', json_encode($result));
        $this->assertSame(2, $attempts);
        Http::assertSentCount(1);
    }
}
