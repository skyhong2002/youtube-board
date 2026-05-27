<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyChannelStatsCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_channels_stats_previews_legacy_channel_queue_without_api_or_writes(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        Http::preventStrayRequests();
        $this->createTables();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 1,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'channel-null',
                'title' => 'Unchecked Channel',
                'viewCount' => 1000,
                'subscriberCount' => 100,
                'videoCount' => 10,
            ],
            [
                'u_id' => 2,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => '2026-05-23 19:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-stale',
                'title' => 'Stale Channel',
                'viewCount' => 2000,
                'subscriberCount' => 200,
                'videoCount' => 20,
            ],
            [
                'u_id' => 3,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => '2026-05-24 12:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-fresh',
                'title' => 'Fresh Channel',
                'viewCount' => 3000,
                'subscriberCount' => 300,
                'videoCount' => 30,
            ],
            [
                'u_id' => 4,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => 1,
                'youtube_id' => 'channel-deleted',
                'title' => 'Deleted Channel',
                'viewCount' => 4000,
                'subscriberCount' => 400,
                'videoCount' => 40,
            ],
        ]);

        DB::table('urt_count')->insert([
            'u_id' => 1,
            'mtime' => null,
            'viewCount' => 900,
            'subscriberCount' => 90,
            'videoCount' => 9,
            'tags' => '1,2',
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--hours' => 22,
            '--limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('stale_or_unchecked', $payload['source']);
        $this->assertSame(3, $payload['active_channels']);
        $this->assertSame(1, $payload['unchecked_channels']);
        $this->assertSame(1, $payload['stale_channels']);
        $this->assertSame(2, $payload['eligible_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('2026-05-24 18:00:00', $payload['would_set_stime']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame(1, $payload['rows'][0]['u_id']);
        $this->assertSame('Unchecked Channel', $payload['rows'][0]['title']);
        $this->assertSame(900, $payload['rows'][0]['count_table']['viewCount']);
        $this->assertContains('urt_channel.stime reserve update', $payload['writes_skipped']);

        $this->assertNull(DB::table('urt_channel')->where('u_id', 1)->value('stime'));
        $this->assertSame(1000, DB::table('urt_channel')->where('u_id', 1)->value('viewCount'));
        $this->assertSame(0, DB::table('urt_log')->count());
    }

    public function test_youtube_channels_stats_preserves_legacy_23_hour_null_stime_sweep(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 23:05:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 23:05:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 1,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'channel-null',
                'title' => 'Unchecked Channel',
                'viewCount' => 1000,
                'subscriberCount' => 100,
                'videoCount' => 10,
            ],
            [
                'u_id' => 2,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => '2026-05-23 19:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-stale',
                'title' => 'Stale Channel',
                'viewCount' => 2000,
                'subscriberCount' => 200,
                'videoCount' => 20,
            ],
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('null_stime_at_23', $payload['source']);
        $this->assertTrue($payload['legacy_null_sweep_hour']);
        $this->assertSame(1, $payload['eligible_rows']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertSame(1, $payload['rows'][0]['u_id']);
    }

    public function test_youtube_channels_stats_supports_single_channel_preview_and_scheduler_execution(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'stime' => '2026-05-24 12:00:00',
            'flag_del' => null,
            'youtube_id' => 'target-channel',
            'title' => 'Target Channel',
            'viewCount' => 1000,
            'subscriberCount' => 100,
            'videoCount' => 10,
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--u_id' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('single_channel', $payload['source']);
        $this->assertSame(10, $payload['target_u_id']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('target-channel', $payload['rows'][0]['youtube_id']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:09:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.stats',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:read-only-guardrail', $result['jobs'][0]['action']);
    }

    public function test_youtube_channels_stats_execute_requires_api_key_and_does_not_write_when_missing(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'stime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-missing-key',
            'title' => 'Missing Key Channel',
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 1,
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--limit' => 1,
        ]);

        $this->assertSame(1, $exitCode);
        $output = Artisan::output();
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not', $output, $output);
        $this->assertNull(DB::table('urt_channel')->where('u_id', 10)->value('stime'));
        $this->assertSame(100, DB::table('urt_channel')->where('u_id', 10)->value('viewCount'));
        $this->assertSame(0, DB::table('urt_log')->count());
    }

    public function test_youtube_channels_stats_execute_parses_api_and_upserts_idempotently(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'stime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-execute',
            'title' => 'Execute Channel',
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 1,
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [[
                    'id' => 'UC-execute',
                    'statistics' => [
                        'viewCount' => '1234',
                        'subscriberCount' => '55',
                        'hiddenSubscriberCount' => false,
                        'videoCount' => '9',
                    ],
                ]],
            ]),
        ]);

        $firstExitCode = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['updated_rows']);
        $this->assertContains('urt_channel.viewCount', $firstPayload['write_targets']);
        $this->assertSame(1234, DB::table('urt_channel')->where('u_id', 10)->value('viewCount'));
        $this->assertSame(55, DB::table('urt_count')->where('u_id', 10)->value('subscriberCount'));
        $this->assertSame(1, DB::table('urt_log')->where('u_id', 10)->where('themonth', '2026-05-01')->count());

        $log = json_decode((string) DB::table('urt_log')->where('u_id', 10)->value('thedata'), true);
        $this->assertSame(1234, $log['2026-05-24']['view']);
        $this->assertSame(55, $log['2026-05-24']['subscriber']);
        $this->assertSame(9, $log['2026-05-24']['video']);

        $secondExitCode = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(1, DB::table('urt_log')->where('u_id', 10)->where('themonth', '2026-05-01')->count());
        $this->assertSame(1, DB::table('urt_count')->where('u_id', 10)->count());
        Http::assertSentCount(2);
    }

    public function test_scheduler_enabled_local_polling_allowlist_can_fetch_channel_stats(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.channels.stats']);
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'stime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-scheduled-execute',
            'title' => 'Scheduled Execute Channel',
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 1,
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [[
                    'id' => 'UC-scheduled-execute',
                    'statistics' => [
                        'viewCount' => '777',
                        'subscriberCount' => '88',
                        'hiddenSubscriberCount' => false,
                        'videoCount' => '11',
                    ],
                ]],
            ]),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:09:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.stats',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
        $this->assertSame('youtube:channels:stats --execute --limit=1', $result['jobs'][0]['effective_command']);
        $this->assertSame(777, DB::table('urt_channel')->where('u_id', 10)->value('viewCount'));
        $this->assertSame(88, DB::table('urt_count')->where('u_id', 10)->value('subscriberCount'));
        $this->assertSame(1, DB::table('urt_log')->where('u_id', 10)->where('themonth', '2026-05-01')->count());
        Http::assertSentCount(1);
    }

    private function createTables(): void
    {
        foreach (['urt_log', 'urt_count', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('flag_del')->nullable();
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('subscriberCount')->nullable();
            $table->integer('videoCount')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->dateTime('mtime')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('subscriberCount')->nullable();
            $table->integer('videoCount')->nullable();
            $table->string('tags')->nullable();
        });

        Schema::create('urt_log', function ($table): void {
            $table->integer('pk')->nullable();
            $table->integer('u_id')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->string('themonth')->nullable();
            $table->text('thedata')->nullable();
        });
    }
}
