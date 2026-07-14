<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\OpenCodeChatClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use RuntimeException;
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

    public function test_ai_provider_probe_reports_the_response_model_separately_from_configuration(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');

        Http::fake([
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-06-15',
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
        ]);

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'primary',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('gpt-5.4-mini-2026-06-15', $payload['providers'][0]['model']);
        $this->assertSame('gpt-5.4-mini', $payload['providers'][0]['configured_model']);
    }

    public function test_openai_provider_alias_probes_the_primary_endpoint_and_model(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-openai-key');
        config()->set('services.opencode_go.base_url', 'https://primary.openai.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-opencode-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.opencode.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');

        Http::fake([
            'https://primary.openai.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
            'https://fallback.opencode.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'fallback']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'openai',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['ok' => 1, 'failed' => 0], $payload['summary']);
        $this->assertSame('primary', $payload['providers'][0]['provider']);
        $this->assertSame('gpt-5.4-mini', $payload['providers'][0]['model']);
        $this->assertStringNotContainsString('primary-openai-key', Artisan::output());
        $this->assertStringNotContainsString('fallback-opencode-key', Artisan::output());

        Http::assertSentCount(1);
        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://primary.openai.test/v1/chat/completions'
                && $request->hasHeader('Authorization', 'Bearer primary-openai-key')
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

    public function test_all_provider_failures_use_a_generic_sanitized_error(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-super-secret');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-super-secret');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');

        Http::fake(fn (): mixed => Http::response(['error' => ['message' => 'quota token=primary-super-secret']], 429));

        try {
            app(OpenCodeChatClient::class)->complete('Reply OK');
            $this->fail('Expected both configured providers to fail.');
        } catch (RuntimeException $exception) {
            $this->assertStringStartsWith('AI completion failed after 2 provider(s):', $exception->getMessage());
            $this->assertStringContainsString('secrets=not_printed', $exception->getMessage());
            $this->assertStringNotContainsString('primary-super-secret', $exception->getMessage());
            $this->assertStringNotContainsString('fallback-super-secret', $exception->getMessage());
            $this->assertStringNotContainsString('OpenCode completion failed', $exception->getMessage());
        }
    }
}
