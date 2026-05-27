<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyTvbsIngestionCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_tvbs_videos_previews_legacy_tag_29_discovery_without_api_or_writes(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createVideoDiscoveryTables();

        DB::table('urt_channel')->insert([
            $this->channelRow(1, 'TVBS Primary', 'uploads-primary'),
            $this->channelRow(2, 'TVBS Secondary', 'uploads-secondary'),
            $this->channelRow(3, 'General Live', 'uploads-general'),
            $this->channelRow(4, 'Deleted TVBS', 'uploads-deleted', 1),
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[29],[1]'],
            ['u_id' => 2, 'tags' => '[29],[2]'],
            ['u_id' => 3, 'tags' => '[52],[1]'],
            ['u_id' => 4, 'tags' => '[29]'],
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(1, 'video-recent-a', '2026-05-25 10:00:00'),
            $this->videoRow(1, 'video-recent-b', '2026-05-24 10:00:00'),
            $this->videoRow(1, 'video-old', '2026-04-01 10:00:00'),
        ]);
        DB::table('urt_video_live_tvbs')->insert([
            $this->tvbsLiveRow('tvbs-live-active', 1, '2026-05-25 09:00:00'),
            $this->tvbsLiveRow('tvbs-live-ended', 1, '2026-05-24 09:00:00', actualEndTime: '2026-05-24 10:00:00'),
        ]);

        $exitCode = Artisan::call('youtube:tvbs:videos', [
            '--limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('tvbs_tag_29_all_channels', $payload['source']);
        $this->assertSame(29, $payload['tvbs_tag_id']);
        $this->assertSame(3, $payload['active_channels']);
        $this->assertSame(3, $payload['tagged_channels']);
        $this->assertSame(2, $payload['eligible_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(80, $payload['legacy_loop_limit']);
        $this->assertSame(300, $payload['legacy_sleep_seconds']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame([], $payload['writes']);
        $this->assertContains('urt_video_live_tvbs insert for default_live.jpg, live, or upcoming playlist items', $payload['writes_skipped']);
        $this->assertSame(1, $payload['rows'][0]['u_id']);
        $this->assertSame('uploads-primary', $payload['rows'][0]['uploads']);
        $this->assertSame(2, $payload['rows'][0]['local_recent_week_count']);
        $this->assertSame(3, $payload['rows'][0]['local_video_rows']);
        $this->assertSame(2, $payload['rows'][0]['local_tvbs_live_rows']);
        $this->assertSame(1, $payload['rows'][0]['local_tvbs_active_live_rows']);

        $this->assertSame(3, DB::table('urt_video')->count());
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
        $this->assertSame(2, DB::table('urt_video_live_tvbs')->count());
    }

    public function test_youtube_tvbs_videos_execute_requires_api_key_and_does_not_write_when_missing(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        $this->createVideoDiscoveryTables();

        DB::table('urt_channel')->insert($this->channelRow(1, 'TVBS Primary', 'uploads-primary'));
        DB::table('urt_count')->insert(['u_id' => 1, 'tags' => '[29]']);

        $exitCode = Artisan::call('youtube:tvbs:videos', [
            '--execute' => true,
            '--id' => 1,
            '--limit' => 1,
            '--max-results' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not_printed', $output, $output);
        $this->assertSame(0, DB::table('urt_video')->count());
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
        $this->assertSame(0, DB::table('urt_video_live_tvbs')->count());
    }

    public function test_youtube_tvbs_videos_execute_parses_api_and_upserts_tvbs_live_idempotently(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createVideoDiscoveryTables();

        DB::table('urt_channel')->insert($this->channelRow(1, 'TVBS Primary', 'uploads-primary'));
        DB::table('urt_count')->insert(['u_id' => 1, 'tags' => '[29]']);

        Http::fake([
            'www.googleapis.com/youtube/v3/playlistItems*' => Http::response([
                'items' => [
                    [
                        'id' => 'playlist-item-live',
                        'snippet' => [
                            'publishedAt' => '2026-05-25T03:30:00Z',
                            'channelId' => 'channel-1',
                            'title' => 'TVBS live item',
                            'description' => 'local fake TVBS live',
                            'thumbnails' => ['default' => ['url' => 'https://i.ytimg.com/default_live.jpg']],
                            'channelTitle' => 'TVBS Primary',
                            'playlistId' => 'uploads-primary',
                            'position' => 0,
                            'resourceId' => ['videoId' => 'tvbs-video-live'],
                            'liveBroadcastContent' => 'live',
                        ],
                    ],
                    [
                        'id' => 'playlist-item-normal',
                        'snippet' => [
                            'publishedAt' => '2026-05-24T03:30:00Z',
                            'channelId' => 'channel-1',
                            'title' => 'TVBS normal item',
                            'description' => 'local fake TVBS normal',
                            'thumbnails' => ['default' => ['url' => 'https://i.ytimg.com/default.jpg']],
                            'channelTitle' => 'TVBS Primary',
                            'playlistId' => 'uploads-primary',
                            'position' => 1,
                            'resourceId' => ['videoId' => 'tvbs-video-normal'],
                            'liveBroadcastContent' => 'none',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $firstExitCode = Artisan::call('youtube:tvbs:videos', [
            '--execute' => true,
            '--id' => 1,
            '--limit' => 1,
            '--max-results' => 2,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame('tvbs_single_channel_id', $firstPayload['source']);
        $this->assertSame(1, $firstPayload['api_requested_channels']);
        $this->assertSame(2, $firstPayload['applied'][0]['video_upserts']);
        $this->assertSame(2, $firstPayload['applied'][0]['schedule_upserts']);
        $this->assertSame(1, $firstPayload['applied'][0]['tvbs_live_upserts']);
        $this->assertContains('urt_video_live_tvbs.videoId', $firstPayload['write_targets']);
        $this->assertSame(2, DB::table('urt_video')->count());
        $this->assertSame(2, DB::table('urt_video_schedule')->count());
        $this->assertSame(1, DB::table('urt_video_live_tvbs')->where('videoId', 'tvbs-video-live')->count());
        $this->assertSame(0, DB::table('urt_video_live_tvbs')->where('videoId', 'tvbs-video-normal')->count());
        $this->assertSame('TVBS live item', DB::table('urt_video')->where('videoId', 'tvbs-video-live')->value('title'));
        $this->assertSame('2026-05-25 11:30:00', DB::table('urt_video')->where('videoId', 'tvbs-video-live')->value('publishedAt'));

        $secondExitCode = Artisan::call('youtube:tvbs:videos', [
            '--execute' => true,
            '--id' => 1,
            '--limit' => 1,
            '--max-results' => 2,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(2, DB::table('urt_video')->count());
        $this->assertSame(2, DB::table('urt_video_schedule')->count());
        $this->assertSame(1, DB::table('urt_video_live_tvbs')->where('videoId', 'tvbs-video-live')->count());
        Http::assertSentCount(2);
    }

    public function test_youtube_tvbs_live_poll_previews_stale_rows_without_api_or_writes(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createLivePollingTables();

        DB::table('urt_video_live_tvbs')->insert([
            $this->tvbsLiveRow('eligible-tvbs-01', 1, null, scheduledStartTime: '2026-05-25 11:30:00', concurrentViewers: 301, maxCurrent: 350),
            $this->tvbsLiveRow('eligible-tvbs-02', 2, '2026-05-25 11:59:00', scheduledStartTime: null, concurrentViewers: 201, maxCurrent: 250),
            $this->tvbsLiveRow('fresh-tvbs', 3, '2026-05-25 11:59:50'),
            $this->tvbsLiveRow('ended-tvbs', 4, '2026-05-25 11:59:00', actualEndTime: '2026-05-25 11:45:00'),
            $this->tvbsLiveRow('future-tvbs', 5, '2026-05-25 11:59:00', scheduledStartTime: '2026-05-25 12:30:00'),
            $this->tvbsLiveRow('deleted-tvbs', 6, '2026-05-25 11:59:00', delFlag: 1),
        ]);
        DB::table('urt_video_live_log_tvbs')->insert([
            'videoId' => 'eligible-tvbs-01',
            'u_id' => 1,
            'the_date' => '2026-05-25',
            'ctime' => '2026-05-25 11:00:00',
            'mtime' => '2026-05-25 11:30:00',
            'max_current' => 350,
            'log_json' => json_encode(['11:30' => 350]),
        ]);
        DB::table('urt_video')->insert([
            'videoId' => 'eligible-tvbs-01',
            'title' => 'TVBS Live Title',
            'channelTitle' => 'TVBS Channel',
        ]);

        $exitCode = Artisan::call('youtube:tvbs:live:poll', [
            '--limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('stale_tvbs_live_rows', $payload['source']);
        $this->assertSame(40, $payload['effective_stale_seconds']);
        $this->assertSame('2026-05-25 11:59:20', $payload['too_soon']);
        $this->assertSame(4, $payload['active_live_rows']);
        $this->assertSame(2, $payload['eligible_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(1, $payload['displayed_rows']);
        $this->assertSame(1, $payload['existing_today_log_rows']);
        $this->assertSame(1, $payload['missing_today_log_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame([], $payload['writes']);
        $this->assertContains('urt_video_live_log_tvbs log_json/max_current update for current minute', $payload['writes_skipped']);
        $this->assertSame('eligible-tvbs-01', $payload['rows'][0]['video_id']);
        $this->assertSame('TVBS Live Title', $payload['rows'][0]['title']);
        $this->assertTrue($payload['rows'][0]['today_log_exists']);
        $this->assertSame(1, $payload['rows'][0]['today_log_points']);
        $this->assertSame('12:00', $payload['rows'][0]['would_write_minute']);

        $this->assertNull(DB::table('urt_video_live_tvbs')->where('videoId', 'eligible-tvbs-01')->value('mtime'));
        $this->assertSame(1, DB::table('urt_video_live_log_tvbs')->count());
    }

    public function test_youtube_tvbs_live_poll_execute_requires_api_key_and_does_not_write_when_missing(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        $this->createLivePollingTables();

        DB::table('urt_video_live_tvbs')->insert($this->tvbsLiveRow('missing-key-tvbs', 1, '2026-05-25 11:59:00'));

        $exitCode = Artisan::call('youtube:tvbs:live:poll', [
            '--execute' => true,
            '--videoId' => 'missing-key-tvbs',
            '--limit' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not_printed', $output, $output);
        $this->assertSame('2026-05-25 11:59:00', DB::table('urt_video_live_tvbs')->where('videoId', 'missing-key-tvbs')->value('mtime'));
        $this->assertSame(0, DB::table('urt_video_live_log_tvbs')->count());
    }

    public function test_youtube_tvbs_live_poll_execute_parses_api_and_upserts_log_idempotently(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 20:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createLivePollingTables();

        DB::table('urt_video_live_tvbs')->insert($this->tvbsLiveRow(
            videoId: 'execute-tvbs-live',
            uId: 29,
            mtime: '2026-05-25 19:59:00',
            scheduledStartTime: '2026-05-25 19:30:00',
            concurrentViewers: 100,
            maxCurrent: 120,
        ));

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'execute-tvbs-live',
                        'liveStreamingDetails' => [
                            'actualStartTime' => '2026-05-25T11:30:00Z',
                            'scheduledStartTime' => '2026-05-25T11:00:00Z',
                            'activeLiveChatId' => 'chat-execute-tvbs-new',
                            'concurrentViewers' => '456',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $firstExitCode = Artisan::call('youtube:tvbs:live:poll', [
            '--execute' => true,
            '--videoId' => 'execute-tvbs-live',
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame('single_tvbs_video', $firstPayload['source']);
        $this->assertSame(1, $firstPayload['updated_videos']);
        $this->assertContains('urt_video_live_tvbs.concurrentViewers', $firstPayload['write_targets']);
        $this->assertSame('2026-05-25 20:00:00', DB::table('urt_video_live_tvbs')->where('videoId', 'execute-tvbs-live')->value('mtime'));
        $this->assertSame('2026-05-25 19:30:00', DB::table('urt_video_live_tvbs')->where('videoId', 'execute-tvbs-live')->value('actualStartTime'));
        $this->assertSame('2026-05-25 19:00:00', DB::table('urt_video_live_tvbs')->where('videoId', 'execute-tvbs-live')->value('scheduledStartTime'));
        $this->assertSame('chat-execute-tvbs-new', DB::table('urt_video_live_tvbs')->where('videoId', 'execute-tvbs-live')->value('activeLiveChatId'));
        $this->assertSame(456, DB::table('urt_video_live_tvbs')->where('videoId', 'execute-tvbs-live')->value('concurrentViewers'));
        $this->assertSame(456, DB::table('urt_video_live_tvbs')->where('videoId', 'execute-tvbs-live')->value('max_current'));
        $this->assertSame(1, DB::table('urt_video_live_log_tvbs')->where('videoId', 'execute-tvbs-live')->count());

        $log = DB::table('urt_video_live_log_tvbs')->where('videoId', 'execute-tvbs-live')->first();
        $this->assertIsObject($log);
        $this->assertSame('2026-05-25', (string) $log->the_date);
        $this->assertSame(29, (int) $log->u_id);
        $this->assertSame(456, (int) $log->max_current);
        $this->assertSame(['20:00' => 456], json_decode((string) $log->log_json, true));

        $secondExitCode = Artisan::call('youtube:tvbs:live:poll', [
            '--execute' => true,
            '--videoId' => 'execute-tvbs-live',
            '--limit' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(1, DB::table('urt_video_live_log_tvbs')->where('videoId', 'execute-tvbs-live')->count());
        $this->assertSame(['20:00' => 456], json_decode((string) DB::table('urt_video_live_log_tvbs')->where('videoId', 'execute-tvbs-live')->value('log_json'), true));
        Http::assertSentCount(2);
    }

    public function test_youtube_tvbs_live_poll_keeps_single_video_preview_in_tvbs_scope(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createLivePollingTables();

        DB::table('urt_video_live_tvbs')->insert($this->tvbsLiveRow('target-tvbs-live', 99, '2026-05-25 11:59:50', scheduledStartTime: '2026-05-25 12:30:00'));

        $exitCode = Artisan::call('youtube:tvbs:live:poll', [
            '--videoId' => 'target-tvbs-live',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('single_tvbs_video', $payload['source']);
        $this->assertSame('target-tvbs-live', $payload['target_video_id']);
        $this->assertSame(1, $payload['eligible_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertStringContainsString('legacy get_live_tvbs.php uses urt_video_live', $payload['single_video_table_note']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_tvbs_previews_when_due(): void
    {
        $this->createVideoDiscoveryTables();
        $this->createLivePollingTables(dropVideoTable: false);
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tvbs.videos', 'youtube.tvbs.live.poll']);
        config()->set('services.youtube.api_key', 'test-key');
        Http::fake([
            'www.googleapis.com/youtube/v3/playlistItems*' => Http::response(['items' => []], 200),
            'www.googleapis.com/youtube/v3/videos*' => Http::response(['items' => []], 200),
        ]);

        DB::table('urt_channel')->insert($this->channelRow(1, 'TVBS Primary', 'uploads-primary'));
        DB::table('urt_count')->insert(['u_id' => 1, 'tags' => '[29]']);
        DB::table('urt_video_live_tvbs')->insert($this->tvbsLiveRow('eligible-tvbs-01', 1, '2026-05-25 11:59:00'));

        $videos = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 12:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tvbs.videos',
        );
        $livePoll = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tvbs.live.poll',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $videos['summary']);
        $this->assertSame('executed:local-polling', $videos['jobs'][0]['action']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $livePoll['summary']);
        $this->assertSame('executed:local-polling', $livePoll['jobs'][0]['action']);
    }

    private function createVideoDiscoveryTables(): void
    {
        foreach (['urt_video_schedule', 'urt_video_live_tvbs', 'urt_video', 'urt_count', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('vtime')->nullable();
            $table->integer('flag_del')->nullable();
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->string('uploads')->nullable();
            $table->integer('videoCount')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->text('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->string('id')->nullable();
            $table->integer('u_id')->nullable();
            $table->string('videoId');
            $table->string('title')->nullable();
            $table->string('channelId')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->string('playlistId')->nullable();
            $table->integer('position')->nullable();
            $table->text('description')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_video_live_tvbs', function ($table): void {
            $this->createTvbsLiveColumns($table);
        });

        Schema::create('urt_video_schedule', function ($table): void {
            $table->integer('pk')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->string('videoId')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });
    }

    private function createLivePollingTables(bool $dropVideoTable = true): void
    {
        foreach (['urt_video_live_log_tvbs', 'urt_video_live_tvbs'] as $table) {
            Schema::dropIfExists($table);
        }

        if ($dropVideoTable) {
            Schema::dropIfExists('urt_video');
        }

        Schema::create('urt_video_live_tvbs', function ($table): void {
            $this->createTvbsLiveColumns($table);
        });

        Schema::create('urt_video_live_log_tvbs', function ($table): void {
            $table->increments('pk');
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
            $table->longText('log_json')->nullable();
        });

        if ($dropVideoTable) {
            Schema::create('urt_video', function ($table): void {
                $table->string('videoId');
                $table->string('title')->nullable();
                $table->string('channelTitle')->nullable();
            });
        }
    }

    private function createTvbsLiveColumns($table): void
    {
        $table->increments('pk');
        $table->dateTime('ctime')->nullable();
        $table->dateTime('mtime')->nullable();
        $table->dateTime('publishedAt')->nullable();
        $table->string('videoId');
        $table->integer('u_id')->nullable();
        $table->dateTime('actualStartTime')->nullable();
        $table->dateTime('scheduledStartTime')->nullable();
        $table->integer('concurrentViewers')->nullable();
        $table->dateTime('actualEndTime')->nullable();
        $table->string('activeLiveChatId')->nullable();
        $table->integer('max_current')->nullable();
        $table->integer('del_flag')->nullable();
    }

    /**
     * @return array<string, mixed>
     */
    private function channelRow(int $uId, string $title, string $uploads, ?int $flagDel = null): array
    {
        return [
            'u_id' => $uId,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'vtime' => '2026-05-25 00:00:00',
            'flag_del' => $flagDel,
            'youtube_id' => 'channel-'.$uId,
            'title' => $title,
            'uploads' => $uploads,
            'videoCount' => 100 + $uId,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function videoRow(int $uId, string $videoId, string $publishedAt): array
    {
        return [
            'ctime' => '2026-05-24 00:00:00',
            'u_id' => $uId,
            'videoId' => $videoId,
            'title' => 'Video '.$videoId,
            'channelTitle' => 'Channel '.$uId,
            'publishedAt' => $publishedAt,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function tvbsLiveRow(
        string $videoId,
        int $uId,
        ?string $mtime,
        ?string $scheduledStartTime = null,
        ?string $actualEndTime = null,
        ?int $delFlag = null,
        int $concurrentViewers = 100,
        int $maxCurrent = 200,
    ): array {
        return [
            'ctime' => '2026-05-25 10:00:00',
            'mtime' => $mtime,
            'publishedAt' => '2026-05-25 09:00:00',
            'videoId' => $videoId,
            'u_id' => $uId,
            'actualStartTime' => '2026-05-25 10:30:00',
            'scheduledStartTime' => $scheduledStartTime,
            'concurrentViewers' => $concurrentViewers,
            'actualEndTime' => $actualEndTime,
            'activeLiveChatId' => 'chat-'.$videoId,
            'max_current' => $maxCurrent,
            'del_flag' => $delFlag,
        ];
    }
}
