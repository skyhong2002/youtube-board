<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class IntegrationCheckPageTest extends TestCase
{
    public function test_public_integration_check_page_uses_config_checks_and_cached_tag_analysis_probe(): void
    {
        Cache::flush();
        Storage::fake('local');
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
        $response->assertSee('Local estimate');
        $response->assertSee('0 / 10,000 units');
        $response->assertSee('Quota usage');
        $response->assertSee('not configured; requires Google Cloud Monitoring read credentials');
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

    public function test_public_integration_check_page_shows_local_youtube_quota_estimate(): void
    {
        Cache::flush();
        Storage::fake('local');
        config()->set('services.youtube.api_key', 'test-youtube-key');

        Storage::disk('local')->put('ingestion-runs/20260601-110000-00000000-0000-4000-8000-000000000000.json', json_encode([
            'id' => '20260601-110000-00000000-0000-4000-8000-000000000000',
            'created_at' => now('America/Los_Angeles')->format('Y-m-d H:i:s T'),
            'request' => [
                'source' => 'artisan',
                'mode' => 'execute',
            ],
            'result' => [
                'mode' => 'execute',
                'jobs' => [
                    [
                        'key' => 'youtube.tag_videos.backfill',
                        'executed' => true,
                        'failed' => false,
                        'estimated_youtube_quota_units' => 6,
                        'youtube_quota_estimate' => [
                            'estimated_units' => 6,
                            'basis' => 'test',
                        ],
                    ],
                ],
            ],
        ], JSON_THROW_ON_ERROR));

        Http::fake([
            'https://tag.analysis.tw/api/tag_json.php*' => Http::response([]),
            'https://tag.analysis.tw/api/group.php*' => Http::response(['result' => null]),
        ]);
        Http::preventStrayRequests();

        $response = $this->get(route('ops.integrations'));

        $response->assertOk();
        $response->assertSee('Local estimate');
        $response->assertSee('6 / 10,000 units');
        $response->assertSee('1 run');
        $response->assertDontSee('Local top quota jobs');
        $response->assertDontSee('youtube.tag_videos.backfill=6');
    }

    public function test_public_integration_check_page_can_show_youtube_quota_usage_from_cloud_monitoring(): void
    {
        Cache::flush();
        Storage::fake('local');
        $privateKey = openssl_pkey_new([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        $privateKeyPem = '';
        openssl_pkey_export($privateKey, $privateKeyPem);

        config()->set('services.youtube.api_key', 'test-youtube-key');
        config()->set('services.youtube.quota.daily_limit', 10000);
        config()->set('services.google_cloud.project_id', 'test-project');
        config()->set('services.google_cloud.monitoring_service_account_json', json_encode([
            'client_email' => 'quota-reader@example.iam.gserviceaccount.com',
            'private_key' => $privateKeyPem,
            'token_uri' => 'https://oauth2.googleapis.com/token',
        ]));
        config()->set('services.opencode_go.api_key', 'test-ai-key');
        config()->set('services.dokploy.deploy_webhook_url', 'https://example.test/deploy');
        config()->set('services.dokploy.deploy_relay_secret', 'test-secret');

        Http::fake([
            'https://oauth2.googleapis.com/token' => Http::response([
                'access_token' => 'test-monitoring-token',
                'expires_in' => 3600,
            ]),
            'https://monitoring.googleapis.com/v3/projects/test-project/timeSeries*' => Http::response([
                'timeSeries' => [
                    [
                        'metric' => [
                            'labels' => [
                                'method' => 'youtube.videos.list',
                                'quota_metric' => 'youtube.googleapis.com/default_requests',
                            ],
                        ],
                        'points' => [
                            [
                                'interval' => ['endTime' => '2026-06-01T01:05:00Z'],
                                'value' => ['int64Value' => '2'],
                            ],
                            [
                                'interval' => ['endTime' => '2026-06-01T01:04:00Z'],
                                'value' => ['int64Value' => '3'],
                            ],
                        ],
                    ],
                    [
                        'metric' => [
                            'labels' => [
                                'method' => 'youtube.playlistItems.list',
                                'quota_metric' => 'youtube.googleapis.com/default_requests',
                            ],
                        ],
                        'points' => [
                            [
                                'interval' => ['endTime' => '2026-06-01T01:03:00Z'],
                                'value' => ['int64Value' => '1'],
                            ],
                        ],
                    ],
                ],
            ]),
            'https://tag.analysis.tw/api/tag_json.php*' => Http::response([]),
            'https://tag.analysis.tw/api/group.php*' => Http::response(['result' => null]),
        ]);
        Http::preventStrayRequests();

        $response = $this->get(route('ops.integrations'));

        $response->assertOk();
        $response->assertSee('Quota usage');
        $response->assertSee('6 / 10,000 units (0.1%; sampled 2026-06-01T01:05:00Z)');
        $response->assertDontSee('Quota remaining');
        $response->assertDontSee('9,994 units');
        $response->assertDontSee('Top quota methods');
        $response->assertDontSee('youtube.videos.list=5');
        $response->assertDontSee('youtube.playlistItems.list=1');
        $response->assertDontSee('test-monitoring-token');
        $response->assertDontSee('PRIVATE KEY');
    }
}
