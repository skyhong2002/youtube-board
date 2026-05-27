<?php

namespace Tests\Feature\Dev;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class YoutubeIntegrationProbeTest extends TestCase
{
    public function test_youtube_probe_returns_sanitized_success_payload(): void
    {
        config()->set('services.youtube.api_key', 'test-key');

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'dQw4w9WgXcQ',
                        'snippet' => [
                            'title' => 'Example video',
                            'channelTitle' => 'Example channel',
                            'publishedAt' => '2009-10-25T06:57:33Z',
                        ],
                        'statistics' => [
                            'viewCount' => '1',
                        ],
                    ],
                ],
            ]),
        ]);

        $response = $this->get(route('dev.integrations.youtube.probe'));

        $response->assertOk();
        $response->assertJsonPath('ok', true);
        $response->assertJsonPath('service', 'youtube_data_api_v3');
        $response->assertJsonPath('video.id', 'dQw4w9WgXcQ');
        $response->assertJsonMissing(['test-key']);
    }

    public function test_youtube_probe_has_chrome_friendly_alias(): void
    {
        config()->set('services.youtube.api_key', 'test-key');

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'dQw4w9WgXcQ',
                        'snippet' => [
                            'title' => 'Example video',
                            'channelTitle' => 'Example channel',
                            'publishedAt' => '2009-10-25T06:57:33Z',
                        ],
                        'statistics' => [
                            'viewCount' => '1',
                        ],
                    ],
                ],
            ]),
        ]);

        $response = $this->get(route('dev.yt.check'));

        $response->assertOk();
        $response->assertJsonPath('ok', true);
        $response->assertJsonPath('video.id', 'dQw4w9WgXcQ');
        $response->assertJsonMissing(['test-key']);
    }

    public function test_youtube_probe_has_browser_friendly_page(): void
    {
        config()->set('services.youtube.api_key', 'test-key');

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'dQw4w9WgXcQ',
                        'snippet' => [
                            'title' => 'Example video',
                            'channelTitle' => 'Example channel',
                            'publishedAt' => '2009-10-25T06:57:33Z',
                        ],
                        'statistics' => [
                            'viewCount' => '1',
                        ],
                    ],
                ],
            ]),
        ]);

        $response = $this->get(route('dev.check'));

        $response->assertOk();
        $response->assertSee('整合檢查');
        $response->assertSee('live probe');
        $response->assertSee('YouTube Data API v3');
        $response->assertSee('OpenAI-compatible AI API');
        $response->assertSee('Dokploy deploy relay');
        $response->assertSee('tag.analysis.tw APIs');
        $response->assertSee('Database');
        $response->assertSee('Example video');
        $response->assertDontSee('Integration Check');
        $response->assertDontSee('test-key');
    }
}
