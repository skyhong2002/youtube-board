<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionTelemetry;
use App\Services\Ingestion\YoutubeApiKeyPoolExhaustedException;
use App\Services\Ingestion\YoutubeDataApiClient;
use Illuminate\Http\Client\ConnectionException;
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

    public function test_youtube_client_uses_fallback_key_after_daily_limit_failure(): void
    {
        config()->set('services.youtube.api_key', 'exhausted-primary-key');
        config()->set('services.youtube.api_keys', 'fallback-key');
        $requestedKeys = [];

        Http::fake(function (Request $request) use (&$requestedKeys) {
            $requestedKeys[] = $request['key'];

            if ($request['key'] === 'exhausted-primary-key') {
                return Http::response([
                    'error' => [
                        'message' => 'Daily Limit Exceeded',
                        'errors' => [['reason' => 'dailyLimitExceededUnreg']],
                    ],
                ], 403);
            }

            return Http::response([
                'items' => [[
                    'id' => 'video-1',
                    'liveStreamingDetails' => ['concurrentViewers' => '321'],
                ]],
            ]);
        });

        $details = app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $this->assertSame(['exhausted-primary-key', 'fallback-key'], $requestedKeys);
        $this->assertSame('321', $details['video-1']['concurrentViewers']);
        Http::assertSentCount(2);
    }

    public function test_youtube_client_uses_fallback_key_after_authentication_failure(): void
    {
        config()->set('services.youtube.api_key', 'invalid-primary-key');
        config()->set('services.youtube.api_keys', 'working-fallback-key');
        config()->set('services.youtube.transient_retries', 3);
        $requestedKeys = [];

        Http::fake(function (Request $request) use (&$requestedKeys) {
            $requestedKeys[] = $request['key'];

            if ($request['key'] === 'invalid-primary-key') {
                return Http::response([
                    'error' => [
                        'message' => 'API key not valid. Please pass a valid API key.',
                        'errors' => [['reason' => 'keyInvalid']],
                    ],
                ], 400);
            }

            return Http::response([
                'items' => [[
                    'id' => 'video-1',
                    'liveStreamingDetails' => ['concurrentViewers' => '789'],
                ]],
            ]);
        });

        $details = app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $this->assertSame(['invalid-primary-key', 'working-fallback-key'], $requestedKeys);
        $this->assertSame('789', $details['video-1']['concurrentViewers']);
        Http::assertSentCount(2);
    }

    public function test_youtube_client_uses_fallback_key_after_expired_key_response(): void
    {
        config()->set('services.youtube.api_key', 'expired-primary-key');
        config()->set('services.youtube.api_keys', 'working-fallback-key');
        $requestedKeys = [];

        Http::fake(function (Request $request) use (&$requestedKeys) {
            $requestedKeys[] = $request['key'];

            if ($request['key'] === 'expired-primary-key') {
                return Http::response([
                    'error' => [
                        'message' => 'API key expired. Please renew the API key.',
                        'errors' => [['reason' => 'badRequest']],
                    ],
                ], 400);
            }

            return Http::response([
                'items' => [[
                    'id' => 'video-1',
                    'liveStreamingDetails' => ['concurrentViewers' => '654'],
                ]],
            ]);
        });

        $details = app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $this->assertSame(['expired-primary-key', 'working-fallback-key'], $requestedKeys);
        $this->assertSame('654', $details['video-1']['concurrentViewers']);
        Http::assertSentCount(2);
    }

    public function test_youtube_client_classifies_canonical_expired_reason_and_uses_fallback(): void
    {
        config()->set('services.youtube.api_key', 'expired-primary-key');
        config()->set('services.youtube.api_keys', 'working-fallback-key');
        $requestedKeys = [];

        Http::fake(function (Request $request) use (&$requestedKeys) {
            $requestedKeys[] = $request['key'];

            if ($request['key'] === 'expired-primary-key') {
                return Http::response([
                    'error' => [
                        'message' => 'Credential rejected.',
                        'errors' => [['reason' => 'API_KEY_EXPIRED']],
                    ],
                ], 400);
            }

            return Http::response([
                'items' => [[
                    'id' => 'video-1',
                    'liveStreamingDetails' => ['concurrentViewers' => '987'],
                ]],
            ]);
        });

        $details = app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $events = app(IngestionTelemetry::class)->snapshot()['youtube_requests'];

        $this->assertSame(['expired-primary-key', 'working-fallback-key'], $requestedKeys);
        $this->assertSame('987', $details['video-1']['concurrentViewers']);
        $this->assertCount(2, $events);
        $this->assertSame(400, $events[0]['status']);
        $this->assertTrue($events[0]['api_key_fallback']);
        $this->assertFalse($events[0]['quota_or_rate_limit_retry']);
        $this->assertFalse($events[0]['transient_retry']);
        $this->assertSame(1, $events[0]['api_key_attempt']);
        $this->assertTrue($events[1]['ok']);
        Http::assertSentCount(2);
    }

    public function test_youtube_client_classifies_expired_only_key_pool_as_authentication_exhaustion(): void
    {
        config()->set('services.youtube.api_key', 'expired-only-key');
        config()->set('services.youtube.api_keys', null);

        Http::fake([
            'www.googleapis.com/*' => Http::response([
                'error' => [
                    'message' => 'Credential rejected.',
                    'errors' => [['reason' => 'API_KEY_EXPIRED']],
                ],
            ], 400),
        ]);

        try {
            app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);
            $this->fail('Expected the expired YouTube key pool to fail closed.');
        } catch (YoutubeApiKeyPoolExhaustedException $exception) {
            $this->assertSame(
                YoutubeApiKeyPoolExhaustedException::AUTHENTICATION_FAILURE,
                $exception->failureReason(),
            );
        }

        $events = app(IngestionTelemetry::class)->snapshot()['youtube_requests'];

        $this->assertCount(1, $events);
        $this->assertSame(400, $events[0]['status']);
        $this->assertTrue($events[0]['api_key_fallback']);
        $this->assertFalse($events[0]['quota_or_rate_limit_retry']);
        $this->assertFalse($events[0]['transient_retry']);
        $this->assertSame(1, $events[0]['api_key_attempt']);
        Http::assertSentCount(1);
    }

    public function test_youtube_client_retries_one_transient_server_failure_with_the_same_key(): void
    {
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 1);
        config()->set('services.youtube.retry_delay_ms', 0);
        $requestedKeys = [];
        $attempt = 0;

        Http::fake(function (Request $request) use (&$requestedKeys, &$attempt) {
            $requestedKeys[] = $request['key'];
            $attempt++;

            if ($attempt === 1) {
                return Http::response(['error' => ['message' => 'temporary backend error']], 503);
            }

            return Http::response([
                'items' => [[
                    'id' => 'video-1',
                    'liveStreamingDetails' => ['concurrentViewers' => '456'],
                ]],
            ]);
        });

        $details = app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $this->assertSame(['primary-key', 'primary-key'], $requestedKeys);
        $this->assertSame('456', $details['video-1']['concurrentViewers']);
        Http::assertSentCount(2);
    }

    public function test_youtube_client_bounds_persistent_transient_failures(): void
    {
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 1);
        config()->set('services.youtube.retry_delay_ms', 0);
        Http::fake(['www.googleapis.com/*' => Http::response(['error' => ['message' => 'temporary backend error']], 503)]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('YouTube API error 503');

        try {
            app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);
        } finally {
            Http::assertSentCount(2);
        }
    }

    public function test_youtube_connection_failures_never_expose_configured_keys(): void
    {
        config()->set('services.youtube.api_key', 'youtube-super-secret');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        config()->set('services.youtube.retry_delay_ms', 0);
        Http::fake(function (): never {
            throw new ConnectionException(
                'failed https://www.googleapis.com/youtube/v3/videos?part=statistics&key=youtube-super-secret token=another-secret Bearer bearer-secret',
            );
        });

        try {
            app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);
            $this->fail('Expected sanitized YouTube connection exception was not thrown.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('<redacted>', $exception->getMessage());
            $this->assertStringNotContainsString('youtube-super-secret', $exception->getMessage());
            $this->assertStringNotContainsString('another-secret', $exception->getMessage());
            $this->assertStringNotContainsString('bearer-secret', $exception->getMessage());
            $this->assertNull($exception->getPrevious());
        }
    }
}
