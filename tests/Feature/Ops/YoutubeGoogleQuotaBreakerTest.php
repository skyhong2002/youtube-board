<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionHealthCheck;
use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\YoutubeApiKeyPoolExhaustedException;
use App\Services\Ingestion\YoutubeDataApiClient;
use App\Services\Ingestion\YoutubeQuotaBudgetLedger;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class YoutubeGoogleQuotaBreakerTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_exhausting_every_key_trips_the_breaker_for_the_pacific_quota_date(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-10 18:30:00', 'America/Los_Angeles'));
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', 'fallback-key');
        $this->seedLedger('2026-10-10', consumed: 4300);
        Http::fake(['www.googleapis.com/*' => $this->quotaError('quotaExceeded')]);

        try {
            app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);
            $this->fail('Expected the key pool to be exhausted.');
        } catch (YoutubeApiKeyPoolExhaustedException) {
        }

        $state = app(YoutubeQuotaBudgetLedger::class)->state(9000);
        $this->assertTrue($state['google_quota_exhausted']);
        $this->assertSame(4300, $state['google_exhausted_units']);
        $this->assertNotNull($state['google_exhausted_at']);
    }

    public function test_one_exhausted_key_does_not_trip_the_breaker_when_another_key_succeeds(): void
    {
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', 'fallback-key');
        Http::fake(fn (Request $request) => $request['key'] === 'primary-key'
            ? $this->quotaError('quotaExceeded')
            : Http::response(['items' => [['id' => 'video-1', 'liveStreamingDetails' => []]]]));

        app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);

        $this->assertFalse(app(YoutubeQuotaBudgetLedger::class)->state(9000)['google_quota_exhausted']);
    }

    public function test_per_minute_rate_limits_do_not_trip_the_breaker(): void
    {
        config()->set('services.youtube.api_key', 'primary-key');
        config()->set('services.youtube.api_keys', '');
        Http::fake(['www.googleapis.com/*' => $this->quotaError('rateLimitExceeded')]);

        try {
            app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1']);
        } catch (YoutubeApiKeyPoolExhaustedException) {
        }

        $this->assertFalse(app(YoutubeQuotaBudgetLedger::class)->state(9000)['google_quota_exhausted']);
    }

    public function test_tripped_breaker_refuses_reservations_until_the_next_quota_date(): void
    {
        $ledger = app(YoutubeQuotaBudgetLedger::class);
        $exhaustedDay = CarbonImmutable::parse('2026-10-10 18:30:00', 'America/Los_Angeles');
        $ledger->markGoogleExhausted($exhaustedDay);

        $blocked = $ledger->reserve(10, 9000, $exhaustedDay);
        $nextDay = $ledger->reserve(10, 9000, $exhaustedDay->addDay()->startOfDay());

        $this->assertFalse($blocked['allowed']);
        $this->assertSame('google_quota_exhausted', $blocked['reason']);
        $this->assertTrue($nextDay['allowed']);
    }

    public function test_runner_skips_youtube_jobs_without_failing_while_the_breaker_is_tripped(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 03:17:00', 'Asia/Taipei'));
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        Http::preventStrayRequests();
        $this->seedLedger('2026-05-24', consumed: 4300, googleExhaustedAt: '2026-05-25 01:00:00');

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );

        $job = $result['jobs'][0];
        $this->assertSame('skip:youtube-google-quota-exhausted', $job['action']);
        $this->assertFalse($job['failed']);
        $this->assertNull($job['exit_code']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        Http::assertNothingSent();
    }

    public function test_health_warns_when_google_quota_runs_out_below_the_local_budget(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-10 18:30:00', 'America/Los_Angeles'));
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        $this->seedLedger('2026-10-10', consumed: 4300, googleExhaustedAt: '2026-10-11 01:00:00', googleExhaustedUnits: 4300);

        $youtube = app(IngestionHealthCheck::class)->check()['youtube'];

        $this->assertSame('warn', $youtube['status']);
        $this->assertTrue($youtube['quota']['google_quota_exhausted']);
        $this->assertStringContainsString('outside this app', $youtube['quota']['warning']);
    }

    private function quotaError(string $reason): \GuzzleHttp\Promise\PromiseInterface
    {
        return Http::response([
            'error' => [
                'message' => 'The request cannot be completed because you have exceeded your quota.',
                'errors' => [
                    ['domain' => 'youtube.quota', 'reason' => $reason],
                ],
            ],
        ], 403);
    }

    private function seedLedger(
        string $quotaDate,
        int $consumed,
        ?string $googleExhaustedAt = null,
        ?int $googleExhaustedUnits = null,
    ): void {
        DB::table('ingestion_youtube_quota_daily')->insert([
            'provider' => 'youtube_data_api_v3',
            'quota_date' => $quotaDate,
            'consumed_units' => $consumed,
            'reserved_units' => 0,
            'google_exhausted_at' => $googleExhaustedAt,
            'google_exhausted_units' => $googleExhaustedUnits,
            'created_at' => $quotaDate.' 00:00:00',
            'updated_at' => $quotaDate.' 00:00:00',
        ]);
    }
}
