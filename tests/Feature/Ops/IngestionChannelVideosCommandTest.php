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

class IngestionChannelVideosCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_channels_videos_previews_legacy_due_vtime_discovery_in_preview_mode(): void
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
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'channel-null',
                'title' => 'Unchecked Uploads Channel',
                'uploads' => 'uploads-null',
                'videoCount' => 120,
            ],
            [
                'u_id' => 2,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => '2026-05-24 12:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-due',
                'title' => 'Due Uploads Channel',
                'uploads' => 'uploads-due',
                'videoCount' => 40,
            ],
            [
                'u_id' => 3,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => '2026-05-25 12:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-fresh',
                'title' => 'Fresh Uploads Channel',
                'uploads' => 'uploads-fresh',
                'videoCount' => 15,
            ],
            [
                'u_id' => 4,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => null,
                'flag_del' => 1,
                'youtube_id' => 'channel-deleted',
                'title' => 'Deleted Uploads Channel',
                'uploads' => 'uploads-deleted',
                'videoCount' => 10,
            ],
        ]);

        DB::table('urt_video')->insert([
            $this->videoRow(1, 'video-a', '2026-05-24 12:00:00'),
            $this->videoRow(1, 'video-b', '2026-05-23 12:00:00'),
            $this->videoRow(1, 'video-c', '2026-05-22 12:00:00'),
            $this->videoRow(1, 'old-video', '2026-04-01 12:00:00'),
            $this->videoRow(2, 'due-old-video', '2026-04-01 12:00:00'),
        ]);

        DB::table('urt_video_live')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'videoId' => 'live-a',
            'publishedAt' => '2026-05-24 12:00:00',
            'u_id' => 1,
        ]);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('due_vtime', $payload['source']);
        $this->assertSame(3, $payload['active_channels']);
        $this->assertSame(2, $payload['due_channels']);
        $this->assertSame(2, $payload['eligible_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('2026-05-24 19:00:00', $payload['would_set_initial_vtime']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame(1, $payload['rows'][0]['u_id']);
        $this->assertSame('uploads-null', $payload['rows'][0]['uploads']);
        $this->assertSame(3, $payload['rows'][0]['local_recent_week_count']);
        $this->assertSame(4, $payload['rows'][0]['local_video_rows']);
        $this->assertSame(1, $payload['rows'][0]['local_live_rows']);
        $this->assertSame('2026-05-25 12:40:00', $payload['rows'][0]['estimated_next_vtime_from_local_week_count']);
        $this->assertContains('urt_video insert for playlist items', $payload['writes_skipped']);

        $this->assertNull(DB::table('urt_channel')->where('u_id', 1)->value('vtime'));
        $this->assertSame(5, DB::table('urt_video')->count());
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
    }

    public function test_youtube_channels_videos_supports_legacy_live_tag_branches(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 1,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => '2026-05-25 12:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-live',
                'title' => 'Live Channel',
                'uploads' => 'uploads-live',
                'videoCount' => 120,
            ],
            [
                'u_id' => 2,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => '2026-05-25 12:00:00',
                'flag_del' => null,
                'youtube_id' => 'channel-group',
                'title' => 'Live Group Channel',
                'uploads' => 'uploads-group',
                'videoCount' => 120,
            ],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[52],[1]'],
            ['u_id' => 2, 'tags' => '[89],[1]'],
        ]);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--live' => 1,
            '--force' => 3,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('live_tag_52', $payload['source']);
        $this->assertSame(1, $payload['live']);
        $this->assertSame(52, $payload['live_tag_id']);
        $this->assertSame(1, $payload['tagged_channels']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertSame(1, $payload['rows'][0]['u_id']);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--live' => 2,
            '--force' => 3,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('live_tag_89', $payload['source']);
        $this->assertSame(2, $payload['live']);
        $this->assertSame(89, $payload['live_tag_id']);
        $this->assertSame(2, $payload['rows'][0]['u_id']);
    }

    public function test_youtube_channels_videos_supports_single_channel_rescan_and_scheduler_variants(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_channel')->insert([
            [
                'u_id' => 10,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => '2026-05-24 12:00:00',
                'flag_del' => null,
                'youtube_id' => 'target-channel',
                'title' => 'Target Channel',
                'uploads' => 'target-uploads',
                'videoCount' => 15000,
            ],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[52],[89]'],
        ]);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--id' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('single_channel', $payload['source']);
        $this->assertSame(10, $payload['target_u_id']);
        $this->assertSame('target-uploads', $payload['rows'][0]['uploads']);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--rescan' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('rescan_large_channels', $payload['source']);
        $this->assertSame(1, $payload['selected_rows']);

        $general = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.videos.general',
        );
        $live = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 02:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.videos.live',
        );
        $liveGroup = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:01:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.channels.videos.live_group',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $general['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $general['jobs'][0]['action']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $live['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $live['jobs'][0]['action']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $liveGroup['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $liveGroup['jobs'][0]['action']);
    }

    public function test_youtube_channels_videos_execute_requires_api_key_before_upsert(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'vtime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-missing-key',
            'title' => 'Missing Key Uploads Channel',
            'uploads' => 'UU-missing-key',
            'videoCount' => 10,
        ]);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not', $output, $output);
        $this->assertNull(DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        $this->assertSame(0, DB::table('urt_video')->count());
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
        $this->assertSame(0, DB::table('urt_video_live')->count());
    }

    public function test_youtube_channels_videos_execute_parses_playlist_and_upserts_idempotently(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'vtime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-execute',
            'title' => 'Execute Uploads Channel',
            'uploads' => 'UU-execute',
            'videoCount' => 10,
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/playlistItems*' => Http::response([
                'items' => [
                    [
                        'id' => 'playlist-item-a',
                        'snippet' => [
                            'publishedAt' => '2026-05-24T09:00:00Z',
                            'channelId' => 'UC-execute',
                            'title' => 'Uploaded Video',
                            'description' => 'First description',
                            'thumbnails' => ['default' => ['url' => 'https://img.youtube.test/a.jpg']],
                            'channelTitle' => 'Execute Uploads Channel',
                            'playlistId' => 'UU-execute',
                            'position' => 0,
                            'resourceId' => ['videoId' => 'video-execute-a'],
                            'liveBroadcastContent' => 'none',
                        ],
                    ],
                    [
                        'id' => 'playlist-item-live',
                        'snippet' => [
                            'publishedAt' => '2026-05-23T09:00:00Z',
                            'channelId' => 'UC-execute',
                            'title' => 'Upcoming Live',
                            'description' => 'Live description',
                            'thumbnails' => ['default' => ['url' => 'https://img.youtube.test/default_live.jpg']],
                            'channelTitle' => 'Execute Uploads Channel',
                            'playlistId' => 'UU-execute',
                            'position' => 1,
                            'resourceId' => ['videoId' => 'video-execute-live'],
                            'liveBroadcastContent' => 'upcoming',
                        ],
                    ],
                ],
            ]),
        ]);

        $firstExitCode = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['updated_channels']);
        $this->assertSame(2, $firstPayload['applied'][0]['video_upserts']);
        $this->assertSame(2, $firstPayload['applied'][0]['schedule_upserts']);
        $this->assertSame(1, $firstPayload['applied'][0]['live_upserts']);
        $this->assertSame('2026-05-25 22:00:00', $firstPayload['applied'][0]['final_vtime']);
        $this->assertContains('urt_video.videoId', $firstPayload['write_targets']);

        $this->assertSame(2, DB::table('urt_video')->count());
        $this->assertSame(2, DB::table('urt_video_schedule')->count());
        $this->assertSame(1, DB::table('urt_video_live')->count());
        $this->assertSame('Uploaded Video', DB::table('urt_video')->where('videoId', 'video-execute-a')->value('title'));
        $this->assertSame('2026-05-25 22:00:00', (string) DB::table('urt_channel')->where('u_id', 10)->value('vtime'));

        $secondExitCode = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(2, DB::table('urt_video')->count());
        $this->assertSame(2, DB::table('urt_video_schedule')->count());
        $this->assertSame(1, DB::table('urt_video_live')->count());
        Http::assertSentCount(2);
    }

    public function test_youtube_channels_videos_execute_skips_bad_playlist_without_failing_batch(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 10,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-bad',
                'title' => 'Bad Uploads Channel',
                'uploads' => 'UU-bad',
                'videoCount' => 10,
            ],
            [
                'u_id' => 11,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-good',
                'title' => 'Good Uploads Channel',
                'uploads' => 'UU-good',
                'videoCount' => 10,
            ],
        ]);

        Http::fakeSequence()
            ->push(['error' => ['message' => 'The playlist cannot be found.']], 404)
            ->push([
                'items' => [
                    [
                        'id' => 'playlist-item-recovered',
                        'snippet' => [
                            'publishedAt' => '2026-05-25T03:00:00Z',
                            'channelId' => 'UC-good',
                            'title' => 'Recovered Upload',
                            'description' => 'Recovered description',
                            'thumbnails' => ['default' => ['url' => 'https://img.youtube.test/recovered.jpg']],
                            'channelTitle' => 'Good Uploads Channel',
                            'playlistId' => 'UU-good',
                            'position' => 0,
                            'resourceId' => ['videoId' => 'video-recovered'],
                            'liveBroadcastContent' => 'none',
                        ],
                    ],
                ],
            ]);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--limit' => 2,
            '--max-results' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['updated_channels']);
        $this->assertSame(1, $payload['skipped_channels']);
        $this->assertSame(10, $payload['skipped'][0]['u_id']);
        $this->assertStringStartsWith('playlist_api_error:', $payload['skipped'][0]['reason']);
        $this->assertSame(11, $payload['applied'][0]['u_id']);
        $this->assertSame('Recovered Upload', DB::table('urt_video')->where('videoId', 'video-recovered')->value('title'));
        $this->assertSame('2026-05-25 13:00:00', (string) DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        Http::assertSentCount(2);
    }

    public function test_youtube_channels_videos_execute_honors_raised_general_batch_cap(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        $channels = [];
        $sequence = Http::fakeSequence();

        for ($i = 1; $i <= 5; $i++) {
            $channels[] = [
                'u_id' => $i,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-upload-batch-'.$i,
                'title' => 'Upload Batch Channel '.$i,
                'uploads' => 'UU-upload-batch-'.$i,
                'videoCount' => 10,
            ];

            $sequence->push([
                'items' => [[
                    'id' => 'playlist-item-batch-'.$i,
                    'snippet' => [
                        'publishedAt' => '2026-05-25T03:00:00Z',
                        'channelId' => 'UC-upload-batch-'.$i,
                        'title' => 'Batch Upload '.$i,
                        'description' => 'Batch upload description',
                        'thumbnails' => ['default' => ['url' => 'https://img.youtube.test/batch-'.$i.'.jpg']],
                        'channelTitle' => 'Upload Batch Channel '.$i,
                        'playlistId' => 'UU-upload-batch-'.$i,
                        'position' => 0,
                        'resourceId' => ['videoId' => 'video-upload-batch-'.$i],
                        'liveBroadcastContent' => 'none',
                    ],
                ]],
            ]);
        }

        DB::table('urt_channel')->insert($channels);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--limit' => 5,
            '--max-results' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(5, $payload['selected_rows']);
        $this->assertSame(5, $payload['api_requested_channels']);
        $this->assertSame(5, $payload['updated_channels']);
        $this->assertSame(5, DB::table('urt_video')->count());
        $this->assertSame('Batch Upload 5', DB::table('urt_video')->where('videoId', 'video-upload-batch-5')->value('title'));
        Http::assertSentCount(5);
    }

    public function test_youtube_tag_videos_backfill_paginates_uploads_and_rebuilds_tag_date_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        $this->createTagDateTables();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 10,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-news',
                'title' => 'Daily News Channel',
                'uploads' => 'UU-news',
                'videoCount' => 1000,
            ],
            [
                'u_id' => 11,
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => null,
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-other',
                'title' => 'Other Channel',
                'uploads' => 'UU-other',
                'videoCount' => 1000,
            ],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[102]'],
            ['u_id' => 11, 'tags' => '[1]'],
        ]);
        DB::table('tags')->insert([
            'tag' => '每日',
            'max_count' => 10,
            'hours_count' => 20,
            'max_hours' => '2026-05-26 12:00:00',
            'no_tag' => null,
        ]);

        Http::fakeSequence()
            ->push([
                'nextPageToken' => 'PAGE2',
                'items' => [
                    $this->playlistItem('item-future', 'video-future', '2026-05-27T01:00:00Z', 'Future upload'),
                    $this->playlistItem('item-a', 'video-a', '2026-05-26T09:00:00Z', '每日 upload A'),
                ],
            ])
            ->push([
                'items' => [
                    $this->playlistItem('item-live', 'video-live', '2026-05-26T01:00:00Z', '每日 live', 'upcoming', 'https://img.youtube.test/default_live.jpg'),
                    $this->playlistItem('item-old', 'video-old', '2026-05-25T15:59:00Z', 'Old upload'),
                ],
            ]);

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-26',
            '--to' => '2026-05-26',
            '--execute' => true,
            '--limit' => 10,
            '--max-pages' => 5,
            '--max-results' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['selected_channels']);
        $this->assertSame(2, $payload['api_pages']);
        $this->assertSame(4, $payload['api_items']);
        $this->assertSame(2, $payload['videos_in_range']);
        $this->assertSame(2, DB::table('urt_video')->count());
        $this->assertSame(2, DB::table('urt_video_schedule')->count());
        $this->assertSame(1, DB::table('urt_video_live')->count());
        $this->assertSame(1, DB::table('urt_show_tag_date')->where('tagid', '102')->count());
        $this->assertSame(2, (int) DB::table('urt_show_tag_date')->where('tagid', '102')->value('count_videos'));
        Http::assertSentCount(2);
    }

    private function createTables(): void
    {
        foreach (['urt_video_schedule', 'urt_video_live', 'urt_video', 'urt_count', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->dateTime('ctime');
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
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->integer('u_id');
            $table->string('id')->nullable();
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('channelId')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->string('playlistId')->nullable();
            $table->integer('position')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
        });

        Schema::create('urt_video_live', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->integer('u_id');
        });

        Schema::create('urt_video_schedule', function ($table): void {
            $table->integer('pk')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->string('videoId')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function videoRow(int $uId, string $videoId, string $publishedAt): array
    {
        static $pk = 1;

        return [
            'pk' => $pk++,
            'ctime' => '2026-05-24 00:00:00',
            'u_id' => $uId,
            'videoId' => $videoId,
            'publishedAt' => $publishedAt,
        ];
    }

    private function createTagDateTables(): void
    {
        foreach (['urt_show_tag_date', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->integer('max_count')->nullable();
            $table->integer('hours_count')->nullable();
            $table->dateTime('max_hours')->nullable();
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->date('the_date')->nullable();
            $table->integer('tags_count')->nullable();
            $table->integer('total_views')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function playlistItem(
        string $itemId,
        string $videoId,
        string $publishedAt,
        string $title,
        string $broadcast = 'none',
        string $thumbnail = 'https://img.youtube.test/default.jpg',
    ): array {
        return [
            'id' => $itemId,
            'snippet' => [
                'publishedAt' => $publishedAt,
                'channelId' => 'UC-news',
                'title' => $title,
                'description' => $title.' description',
                'thumbnails' => ['default' => ['url' => $thumbnail]],
                'channelTitle' => 'Daily News Channel',
                'playlistId' => 'UU-news',
                'position' => 0,
                'resourceId' => ['videoId' => $videoId],
                'liveBroadcastContent' => $broadcast,
            ],
        ];
    }
}
