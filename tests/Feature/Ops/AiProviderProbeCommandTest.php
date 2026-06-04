<?php

namespace Tests\Feature\Ops;

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
}
