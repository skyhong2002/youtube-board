<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionChannelStatsCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_channels_stats_previews_channel_queue_in_preview_mode(): void
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
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('missing_log_or_stale_or_unchecked', $payload['source']);
        $this->assertSame(3, $payload['active_channels']);
        $this->assertSame(1, $payload['unchecked_channels']);
        $this->assertSame(1, $payload['stale_channels']);
        $this->assertSame(3, $payload['missing_log_channels']);
        $this->assertSame(2, $payload['eligible_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('2026-05-24 18:00:00', $payload['would_set_stime']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame([2, 1], collect($payload['rows'])->pluck('u_id')->all());
        $this->assertSame('Stale Channel', $payload['rows'][0]['title']);
        $this->assertSame(900, $payload['rows'][1]['count_table']['viewCount']);
        $this->assertContains('urt_channel.stime reserve update', $payload['writes_skipped']);

        $this->assertNull(DB::table('urt_channel')->where('u_id', 1)->value('stime'));
        $this->assertSame(1000, DB::table('urt_channel')->where('u_id', 1)->value('viewCount'));
        $this->assertSame(0, DB::table('urt_log')->count());
    }

    public function test_youtube_channels_stats_keeps_no_log_and_stale_rows_eligible_at_23_hour(): void
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
        $this->assertSame('missing_log_or_stale_or_unchecked_at_23', $payload['source']);
        $this->assertTrue($payload['null_sweep_hour']);
        $this->assertSame(2, $payload['missing_log_channels']);
        $this->assertSame(2, $payload['eligible_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(2, $payload['rows'][0]['u_id']);
        $this->assertSame(1, $payload['rows'][1]['u_id']);
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

        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:09:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.stats',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
    }

    public function test_youtube_channels_stats_execute_requires_api_key_before_upsert(): void
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
        $this->assertSame('youtube:channels:stats --execute --limit=25', $result['jobs'][0]['effective_command']);
        $this->assertSame(777, DB::table('urt_channel')->where('u_id', 10)->value('viewCount'));
        $this->assertSame(88, DB::table('urt_count')->where('u_id', 10)->value('subscriberCount'));
        $this->assertSame(1, DB::table('urt_log')->where('u_id', 10)->where('themonth', '2026-05-01')->count());
        Http::assertSentCount(1);
    }

    public function test_youtube_channels_stats_execute_honors_raised_batch_cap(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        $channels = [];
        $items = [];

        for ($i = 1; $i <= 61; $i++) {
            $channels[] = [
                'u_id' => $i,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-batch-'.$i,
                'title' => 'Batch Channel '.$i,
                'viewCount' => 100,
                'subscriberCount' => 10,
                'videoCount' => 1,
            ];
            $items[] = [
                'id' => 'UC-batch-'.$i,
                'statistics' => [
                    'viewCount' => (string) (1000 + $i),
                    'subscriberCount' => (string) (100 + $i),
                    'hiddenSubscriberCount' => false,
                    'videoCount' => (string) (10 + $i),
                ],
            ];
        }

        DB::table('urt_channel')->insert($channels);

        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response(['items' => $items]),
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--limit' => 61,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(50, $payload['selected_rows']);
        $this->assertSame(50, $payload['api_requested_rows']);
        $this->assertSame(50, $payload['updated_rows']);
        $this->assertSame(1050, DB::table('urt_channel')->where('u_id', 50)->value('viewCount'));
        $this->assertSame(100, DB::table('urt_channel')->where('u_id', 51)->value('viewCount'));
        Http::assertSent(function ($request): bool {
            parse_str(parse_url($request->url(), PHP_URL_QUERY) ?: '', $query);

            return count(explode(',', (string) ($query['id'] ?? ''))) === 50
                && ($query['maxResults'] ?? null) === '50';
        });
    }

    public function test_channel_statistics_zero_view_rows_cool_down_and_do_not_starve_later_channels(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        for ($uId = 1; $uId <= 25; $uId++) {
            DB::table('urt_channel')->insert([
                'u_id' => $uId,
                'ctime' => '2026-05-20 00:00:00',
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-zero-'.$uId,
                'title' => 'Zero View '.$uId,
                'viewCount' => 1000 + $uId,
            ]);
        }
        DB::table('urt_channel')->insert([
            [
                'u_id' => 26,
                'ctime' => '2026-05-20 00:00:00',
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-ready-after-zero',
                'title' => 'Ready After Zero',
                'viewCount' => 1,
            ],
            [
                'u_id' => 27,
                'ctime' => '2026-05-20 00:00:00',
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => '',
                'title' => 'Missing Identity',
                'viewCount' => 999999,
            ],
        ]);
        Http::fake(function ($request) {
            $ids = explode(',', (string) $request['id']);

            return Http::response([
                'items' => collect($ids)->map(fn (string $id): array => [
                    'id' => $id,
                    'statistics' => [
                        'viewCount' => $id === 'UC-ready-after-zero' ? '777' : '0',
                        'subscriberCount' => '10',
                        'hiddenSubscriberCount' => false,
                        'videoCount' => '1',
                    ],
                ])->all(),
            ]);
        });

        $firstExit = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--limit' => 25,
            '--json' => true,
        ]);
        $first = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $firstExit);
        $this->assertSame(25, $first['failed_rows']);
        $this->assertSame(25, $first['api_requested_rows']);
        $this->assertSame(0, $first['updated_rows']);
        $this->assertSame(1, $first['missing_youtube_id']);
        $this->assertSame('2026-05-24 18:00:00', DB::table('urt_channel')->where('u_id', 1)->value('stime'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 26)->value('stime'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 27)->value('stime'));

        $secondExit = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--limit' => 25,
            '--json' => true,
        ]);
        $second = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $secondExit);
        $this->assertSame(1, $second['selected_rows']);
        $this->assertSame(1, $second['api_requested_rows']);
        $this->assertSame(1, $second['updated_rows']);
        $this->assertSame(777, DB::table('urt_channel')->where('u_id', 26)->value('viewCount'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 27)->value('stime'));
        Http::assertSentCount(2);
    }

    public function test_channel_statistics_execute_isolates_a_failed_channel_and_sanitizes_the_warning(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.channels.stats']);
        $this->createTables();
        Log::spy();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 1,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-fail',
                'title' => 'Failing Channel',
                'viewCount' => 200,
                'subscriberCount' => 20,
                'videoCount' => 2,
            ],
            [
                'u_id' => 2,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-success',
                'title' => 'Successful Channel',
                'viewCount' => 100,
                'subscriberCount' => 10,
                'videoCount' => 1,
            ],
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_channel_statistics
BEFORE UPDATE ON urt_channel
WHEN OLD.u_id = 1
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);

        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [
                    [
                        'id' => 'UC-fail',
                        'statistics' => [
                            'viewCount' => '1111',
                            'subscriberCount' => '111',
                            'hiddenSubscriberCount' => false,
                            'videoCount' => '11',
                        ],
                    ],
                    [
                        'id' => 'UC-success',
                        'statistics' => [
                            'viewCount' => '2222',
                            'subscriberCount' => '222',
                            'hiddenSubscriberCount' => false,
                            'videoCount' => '22',
                        ],
                    ],
                ],
            ]),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.stats',
        );
        $job = $result['jobs'][0];

        $this->assertTrue($job['failed']);
        $this->assertSame('failed', $job['action']);
        $this->assertSame(1, $job['exit_code']);
        $this->assertSame(1, $result['summary']['failed']);
        $this->assertStringContainsString('reason=item_processing_failed', $job['output']);
        $this->assertStringNotContainsString('super-secret', $job['output']);
        $this->assertSame(200, DB::table('urt_channel')->where('u_id', 1)->value('viewCount'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 1)->value('stime'));
        $this->assertSame(2222, DB::table('urt_channel')->where('u_id', 2)->value('viewCount'));
        $this->assertSame(1111, DB::table('urt_count')->where('u_id', 1)->value('viewCount'));
        $this->assertSame(1, DB::table('urt_log')->where('u_id', 1)->count());
        $this->assertSame(1, DB::table('urt_log')->where('u_id', 2)->count());
        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Channel statistics item processing failed.'
                    && $context['u_id'] === 1
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            })
            ->once();
    }

    public function test_channel_statistics_rejects_malformed_counts_and_preserves_hidden_subscriber_value(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        foreach (['UC-malformed-count', 'UC-hidden-count', 'UC-valid-count'] as $index => $youtubeId) {
            $uId = $index + 1;
            DB::table('urt_channel')->insert([
                'u_id' => $uId,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'stime' => null,
                'flag_del' => null,
                'youtube_id' => $youtubeId,
                'title' => 'Payload Channel '.$uId,
                'viewCount' => 100 * $uId,
                'subscriberCount' => 10 * $uId,
                'videoCount' => $uId,
            ]);
            DB::table('urt_count')->insert([
                'u_id' => $uId,
                'viewCount' => 100 * $uId,
                'subscriberCount' => 10 * $uId,
                'videoCount' => $uId,
            ]);
        }

        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [
                    [
                        'id' => 'UC-malformed-count',
                        'statistics' => [
                            'viewCount' => '1000',
                            'subscriberCount' => 'not-a-count',
                            'hiddenSubscriberCount' => false,
                            'videoCount' => '10',
                        ],
                    ],
                    [
                        'id' => 'UC-hidden-count',
                        'statistics' => [
                            'viewCount' => '2000',
                            'hiddenSubscriberCount' => true,
                            'videoCount' => '20',
                        ],
                    ],
                    [
                        'id' => 'UC-valid-count',
                        'statistics' => [
                            'viewCount' => '3000',
                            'subscriberCount' => '300',
                            'hiddenSubscriberCount' => false,
                            'videoCount' => '30',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--limit' => 3,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(2, $payload['updated_rows']);
        $this->assertSame('api_item_missing', $payload['skipped'][0]['reason']);
        $this->assertSame(100, DB::table('urt_channel')->where('u_id', 1)->value('viewCount'));
        $this->assertSame('2026-05-24 18:00:00', DB::table('urt_channel')->where('u_id', 1)->value('stime'));
        $this->assertSame(2000, DB::table('urt_channel')->where('u_id', 2)->value('viewCount'));
        $this->assertSame(20, DB::table('urt_channel')->where('u_id', 2)->value('subscriberCount'));
        $this->assertSame(20, DB::table('urt_count')->where('u_id', 2)->value('subscriberCount'));
        $hiddenApplied = collect($payload['applied'])->firstWhere('youtube_id', 'UC-hidden-count');
        $this->assertIsArray($hiddenApplied);
        $this->assertNull($hiddenApplied['subscriberCount']);
        $hiddenLog = json_decode((string) DB::table('urt_log')->where('u_id', 2)->value('thedata'), true, 512, JSON_THROW_ON_ERROR);
        $this->assertTrue($hiddenLog['2026-05-24']['hidden']);
        $this->assertArrayNotHasKey('subscriber', $hiddenLog['2026-05-24']);
        $this->assertSame(300, DB::table('urt_channel')->where('u_id', 3)->value('subscriberCount'));
    }

    public function test_channel_statistics_preserves_malformed_existing_history_and_fails_the_row(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'stime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-malformed-history',
            'title' => 'Malformed History',
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 1,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 10,
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 1,
        ]);
        DB::table('urt_log')->insert([
            'u_id' => 10,
            'themonth' => '2026-05-01',
            'thedata' => '{malformed',
        ]);
        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [[
                    'id' => 'UC-malformed-history',
                    'statistics' => [
                        'viewCount' => '999',
                        'subscriberCount' => '99',
                        'hiddenSubscriberCount' => false,
                        'videoCount' => '9',
                    ],
                ]],
            ]),
        ]);

        $exitCode = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(0, $payload['updated_rows']);
        $this->assertSame('item_processing_failed', $payload['skipped'][0]['reason']);
        $this->assertSame(100, DB::table('urt_channel')->where('u_id', 10)->value('viewCount'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 10)->value('stime'));
        $this->assertSame(100, DB::table('urt_count')->where('u_id', 10)->value('viewCount'));
        $this->assertSame('{malformed', DB::table('urt_log')->where('u_id', 10)->value('thedata'));
    }

    public function test_hidden_subscriber_ingestion_still_rebuilds_view_and_video_deltas_without_overwriting_subscriber_deltas(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'youtube_id' => 'UC-hidden-deltas',
            'title' => 'Hidden subscriber deltas',
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 5,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 10,
            'viewCount' => 100,
            'subscriberCount' => 10,
            'videoCount' => 5,
            'view_week' => 1,
            'sub_week' => 7,
            'video_week' => 1,
            'view_month' => 2,
            'sub_month' => 12,
            'video_month' => 2,
        ]);
        DB::table('urt_log')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-18 12:00:00',
            'mtime' => '2026-05-18 12:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-18' => ['view' => 100, 'subscriber' => 10, 'video' => 5],
            ], JSON_THROW_ON_ERROR),
        ]);
        Http::fake([
            'www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [[
                    'id' => 'UC-hidden-deltas',
                    'statistics' => [
                        'viewCount' => '250',
                        'hiddenSubscriberCount' => true,
                        'videoCount' => '8',
                    ],
                ]],
            ]),
        ]);

        $statsExit = Artisan::call('youtube:channels:stats', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);
        $stats = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $statsExit);
        $this->assertSame(1, $stats['updated_rows']);

        $countsExit = Artisan::call('reports:counts:build', [
            '--execute' => true,
            '--id' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);
        $counts = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);
        $stored = DB::table('urt_count')->where('u_id', 10)->first();

        $this->assertSame(0, $countsExit);
        $this->assertSame(0, $counts['failed_rows']);
        $this->assertSame([
            'view_week' => 150,
            'video_week' => 3,
            'view_month' => 150,
            'video_month' => 3,
        ], $counts['rows'][0]['computed']);
        $this->assertSame(150, $stored->view_week);
        $this->assertSame(3, $stored->video_week);
        $this->assertSame(150, $stored->view_month);
        $this->assertSame(3, $stored->video_month);
        $this->assertSame(7, $stored->sub_week);
        $this->assertSame(12, $stored->sub_month);
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
            $table->integer('view_week')->nullable();
            $table->integer('sub_week')->nullable();
            $table->integer('video_week')->nullable();
            $table->integer('view_month')->nullable();
            $table->integer('sub_month')->nullable();
            $table->integer('video_month')->nullable();
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
