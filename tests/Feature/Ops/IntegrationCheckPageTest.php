<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class IntegrationCheckPageTest extends TestCase
{
    public function test_public_integration_check_page_uses_config_checks_and_cached_tag_analysis_probe(): void
    {
        config()->set('services.youtube.api_key', 'test-youtube-key');
        config()->set('services.opencode_go.api_key', 'test-ai-key');
        config()->set('services.opencode_go.base_url', 'https://example.test/v1');
        config()->set('services.opencode_go.model', 'example-model');
        config()->set('services.dokploy.deploy_webhook_url', 'https://example.test/deploy');
        config()->set('services.dokploy.deploy_relay_secret', 'test-secret');

        Http::fake([
            'https://tag.analysis.tw/api/tag_json.php*' => Http::response([
                [
                    'tag' => '測試',
                    'max_count' => '10',
                    'hours_count' => '20',
                    'max_hours' => '2026-05-28 18:00:00',
                    'mtime' => '2026-05-28 18:30:00',
                    'no_tag' => '0',
                ],
            ]),
            'https://tag.analysis.tw/api/group.php*' => Http::response(['result' => null]),
        ]);
        Http::preventStrayRequests();

        $response = $this->get(route('ops.integrations'));

        $response->assertOk();
        $response->assertSee('整合檢查');
        $response->assertSee('config-only');
        $response->assertSee('YouTube Data API v3');
        $response->assertSee('OpenAI-compatible AI API');
        $response->assertSee('Dokploy deploy relay');
        $response->assertSee('新文易數 tag.analysis.tw APIs');
        $response->assertSee('Database');
        $response->assertSee('cached public endpoint probe');
        $response->assertSee('rows=1');
        $response->assertSee('rows=0');
        $response->assertSee('config only; no external request');
        $response->assertDontSee('live probe: videos.list');
        $response->assertDontSee('legacy 外部端點');
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
