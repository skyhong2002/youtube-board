<?php

namespace Tests\Feature\Ops;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionChannelRetireCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-18 12:00:00', 'Asia/Taipei'));
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        $this->createTables();
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    public function test_preview_lists_stale_candidates_without_calling_youtube(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        Http::fake();

        $exitCode = Artisan::call('youtube:channels:retire', ['--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(14, $payload['stale_days']);
        $this->assertSame(['dead-never-succeeded', 'dead-stale'], collect($payload['rows'])->pluck('youtube_id')->all());
        $this->assertSame([], $payload['writes']);
        $this->assertSame(0, DB::table('urt_channel')->whereNotNull('flag_del')->whereIn('youtube_id', ['dead-stale', 'dead-never-succeeded'])->count());
        Http::assertNothingSent();
    }

    public function test_execute_retires_only_channels_absent_from_a_fresh_response(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [['id' => 'dead-never-succeeded']],
            ], 200),
        ]);

        $exitCode = Artisan::call('youtube:channels:retire', ['--execute' => true, '--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('local-execute', $payload['mode']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(1, $payload['retired_rows']);
        $this->assertSame(1, $payload['skipped_rows']);
        $this->assertSame(0, $payload['failed_rows']);
        $this->assertSame('dead-stale', $payload['retired'][0]['youtube_id']);
        $this->assertSame(
            ['youtube_id' => 'dead-never-succeeded', 'reason' => 'still_on_youtube'],
            collect($payload['skipped'][0])->only(['youtube_id', 'reason'])->all(),
        );
        $this->assertSame(1, (int) DB::table('urt_channel')->where('youtube_id', 'dead-stale')->value('flag_del'));
        $this->assertSame('2026-07-18 12:00:00', DB::table('urt_channel')->where('youtube_id', 'dead-stale')->value('mtime'));
        $this->assertNull(DB::table('urt_channel')->where('youtube_id', 'dead-never-succeeded')->value('flag_del'));
        Http::assertSentCount(1);
        Http::assertSent(fn ($request): bool => str_contains($request->url(), 'part=id'));
    }

    public function test_execute_is_idempotent_and_skips_already_retired_channels(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        Http::fake(['www.googleapis.com/youtube/v3/channels*' => Http::response(['items' => []], 200)]);

        $this->assertSame(0, Artisan::call('youtube:channels:retire', ['--execute' => true, '--json' => true]));
        Artisan::output();
        $this->assertSame(2, DB::table('urt_channel')->where('flag_del', 1)->whereIn('youtube_id', ['dead-stale', 'dead-never-succeeded'])->count());

        $repeatExit = Artisan::call('youtube:channels:retire', ['--execute' => true, '--json' => true]);
        $repeat = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $repeatExit);
        $this->assertSame(0, $repeat['selected_rows']);
        Http::assertSentCount(1);
    }

    public function test_fresh_and_unpolled_channels_are_never_candidates(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        Http::fake();

        Artisan::call('youtube:channels:retire', ['--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);
        $ids = collect($payload['rows'])->pluck('youtube_id')->all();

        $this->assertNotContains('alive-fresh', $ids);
        $this->assertNotContains('never-polled', $ids);
        $this->assertNotContains('', $ids);
    }

    public function test_offset_skips_the_ordered_candidate_head(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        Http::fake();

        Artisan::call('youtube:channels:retire', ['--offset' => 1, '--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $payload['offset']);
        $this->assertSame(['dead-stale'], collect($payload['rows'])->pluck('youtube_id')->all());
    }

    public function test_stale_days_floor_and_limit_cap_are_enforced(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        Http::fake();

        Artisan::call('youtube:channels:retire', ['--stale-days' => 1, '--limit' => 500, '--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(7, $payload['stale_days']);
        $this->assertSame(50, $payload['limit']);
    }

    public function test_execute_without_credentials_is_blocked_before_any_call(): void
    {
        config()->set('services.youtube.api_key', null);
        config()->set('services.youtube.api_keys', null);
        $this->seedChannels();
        Http::fake();

        $exitCode = Artisan::call('youtube:channels:retire', ['--execute' => true, '--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('YOUTUBE_API_KEY is not configured.', $payload['blocked_reason']);
        $this->assertSame(0, DB::table('urt_channel')->whereNotNull('flag_del')->whereIn('youtube_id', ['dead-stale', 'dead-never-succeeded'])->count());
        Http::assertNothingSent();
    }

    public function test_failed_presence_lookup_retires_nothing(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.transient_retries', 0);
        $this->seedChannels();
        Http::fake(['www.googleapis.com/youtube/v3/channels*' => Http::response(['error' => ['code' => 500]], 500)]);

        $exitCode = Artisan::call('youtube:channels:retire', ['--execute' => true, '--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('presence_lookup_failed', $payload['blocked_reason']);
        $this->assertSame(0, DB::table('urt_channel')->whereNotNull('flag_del')->whereIn('youtube_id', ['dead-stale', 'dead-never-succeeded'])->count());
    }

    public function test_restore_clears_flag_only_when_the_channel_exists_again(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $this->seedChannels();
        DB::table('urt_channel')->where('youtube_id', 'dead-stale')->update(['flag_del' => 1]);
        $uId = (int) DB::table('urt_channel')->where('youtube_id', 'dead-stale')->value('u_id');

        Http::fakeSequence('www.googleapis.com/youtube/v3/channels*')
            ->push(['items' => []])
            ->push(['items' => [['id' => 'dead-stale']]]);
        $missingExit = Artisan::call('youtube:channels:retire', ['--restore' => true, '--u_id' => $uId, '--execute' => true, '--json' => true]);
        $missing = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $missingExit);
        $this->assertSame('still_missing_on_youtube', $missing['blocked_reason']);
        $this->assertSame(1, (int) DB::table('urt_channel')->where('u_id', $uId)->value('flag_del'));

        $restoredExit = Artisan::call('youtube:channels:retire', ['--restore' => true, '--u_id' => $uId, '--execute' => true, '--json' => true]);
        $restored = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $restoredExit);
        $this->assertTrue($restored['restored']);
        $this->assertNull(DB::table('urt_channel')->where('u_id', $uId)->value('flag_del'));
    }

    public function test_restore_requires_an_explicit_u_id(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        Http::fake();

        $exitCode = Artisan::call('youtube:channels:retire', ['--restore' => true, '--execute' => true, '--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('restore_requires_u_id', $payload['blocked_reason']);
        Http::assertNothingSent();
    }

    public function test_registry_lists_retirement_as_manual_only(): void
    {
        $job = collect(config('ingestion.jobs'))->firstWhere('key', 'youtube.channels.retire');

        $this->assertIsArray($job);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('', $job['scheduled_execute_command']);
    }

    private function seedChannels(): void
    {
        DB::table('urt_channel')->insert([
            [
                'u_id' => 1,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-06-01 00:00:00',
                'stime' => '2026-07-18 10:00:00',
                'flag_del' => null,
                'youtube_id' => 'dead-stale',
                'title' => 'Dead Stale Channel',
            ],
            [
                'u_id' => 2,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => null,
                'stime' => '2026-07-18 10:00:00',
                'flag_del' => null,
                'youtube_id' => 'dead-never-succeeded',
                'title' => 'Never Succeeded Channel',
            ],
            [
                'u_id' => 3,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-07-18 09:00:00',
                'stime' => '2026-07-18 09:00:00',
                'flag_del' => null,
                'youtube_id' => 'alive-fresh',
                'title' => 'Fresh Channel',
            ],
            [
                'u_id' => 4,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'never-polled',
                'title' => 'Never Polled Channel',
            ],
            [
                'u_id' => 5,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-06-01 00:00:00',
                'stime' => '2026-07-18 10:00:00',
                'flag_del' => 1,
                'youtube_id' => 'already-retired',
                'title' => 'Already Retired Channel',
            ],
            [
                'u_id' => 6,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-06-01 00:00:00',
                'stime' => '2026-07-18 10:00:00',
                'flag_del' => null,
                'youtube_id' => '',
                'title' => 'No YouTube Id Channel',
            ],
        ]);
    }

    private function createTables(): void
    {
        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->dateTime('vtime')->nullable();
            $table->integer('flag_del')->nullable();
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
        });
    }
}
