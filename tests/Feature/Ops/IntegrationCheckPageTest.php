<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class IntegrationCheckPageTest extends TestCase
{
    public function test_public_integration_check_page_uses_config_only_checks(): void
    {
        config()->set('services.youtube.api_key', 'test-youtube-key');
        config()->set('services.opencode_go.api_key', 'test-ai-key');
        config()->set('services.opencode_go.base_url', 'https://example.test/v1');
        config()->set('services.opencode_go.model', 'example-model');
        config()->set('services.dokploy.deploy_webhook_url', 'https://example.test/deploy');
        config()->set('services.dokploy.deploy_relay_secret', 'test-secret');

        Http::preventStrayRequests();

        $response = $this->get(route('ops.integrations'));

        $response->assertOk();
        $response->assertSee('整合檢查');
        $response->assertSee('config-only');
        $response->assertSee('YouTube Data API v3');
        $response->assertSee('OpenAI-compatible AI API');
        $response->assertSee('Dokploy deploy relay');
        $response->assertSee('tag.analysis.tw APIs');
        $response->assertSee('Database');
        $response->assertSee('config only; no external request');
        $response->assertDontSee('live probe: videos.list');
        $response->assertDontSee('test-youtube-key');
        $response->assertDontSee('test-ai-key');
        $response->assertDontSee('test-secret');
    }

    public function test_dev_check_redirects_to_public_integration_check_outside_local_environments(): void
    {
        $this->app->detectEnvironment(fn () => 'production');

        $response = $this->get(route('dev.check'));

        $response->assertRedirect(secure_url('/ops/integrations'));
        $response->assertStatus(308);
    }
}
