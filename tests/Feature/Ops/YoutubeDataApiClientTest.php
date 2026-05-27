<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\YoutubeDataApiClient;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class YoutubeDataApiClientTest extends TestCase
{
    public function test_youtube_client_retries_next_configured_key_after_quota_failure(): void
    {
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', 'fallback-key');

        $requestedKeys = [];

        Http::fake(function (Request $request) use (&$requestedKeys) {
            $requestedKeys[] = $request['key'];

            if ($request['key'] === 'primary-key') {
                return Http::response([
                    'error' => [
                        'message' => 'The request cannot be completed because you have exceeded your quota.',
                        'errors' => [
                            ['reason' => 'quotaExceeded'],
                        ],
                    ],
                ], 403);
            }

            return Http::response([
                'items' => [
                    [
                        'id' => 'video-1',
                        'liveStreamingDetails' => [
                            'concurrentViewers' => '123',
                        ],
                    ],
                ],
            ]);
        });

        $details = app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $this->assertSame(['primary-key', 'fallback-key'], $requestedKeys);
        $this->assertSame('123', $details['video-1']['concurrentViewers']);
    }

    public function test_youtube_client_does_not_retry_non_quota_failures(): void
    {
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', 'fallback-key');

        Http::fake([
            'www.googleapis.com/*' => Http::response([
                'error' => [
                    'message' => 'The request is missing a valid parameter.',
                    'errors' => [
                        ['reason' => 'badRequest'],
                    ],
                ],
            ], 400),
        ]);

        try {
            app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);
            $this->fail('Expected YouTube API exception was not thrown.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('YouTube API error 400: The request is missing a valid parameter.', $exception->getMessage());
        }

        Http::assertSentCount(1);
    }
}
