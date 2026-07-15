<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\ChannelVideosDiscoveryIngestion;
use App\Services\Ingestion\ChannelVideosDiscoveryPreview;
use App\Services\Ingestion\IngestionCommandLock;
use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\TagDateCacheBuilder;
use App\Services\Ingestion\YoutubeDataApiClient;
use App\Services\Ingestion\YoutubeQuotaWindowException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Mockery;
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
        $this->assertFalse($payload['initial_vtime_reservation']);
        $this->assertSame('after_video_schedule_live_writes', $payload['success_vtime_update_order']);
        $this->assertSame(5, $payload['database_failure_retry_minutes']);
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

        config()->set('ingestion.scheduled_write_allowlist', ['off']);

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

    public function test_youtube_channels_videos_manual_execute_uses_the_variant_job_lock(): void
    {
        config()->set('ingestion.lock_store', null);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        $variants = [
            'youtube.channels.videos.general' => [],
            'youtube.channels.videos.live' => ['--live' => 1],
            'youtube.channels.videos.live_group' => ['--live' => 2],
        ];

        foreach ($variants as $jobKey => $arguments) {
            $lock = Cache::lock(IngestionCommandLock::name($jobKey), 600);
            $this->assertTrue($lock->get());

            try {
                $exitCode = Artisan::call('youtube:channels:videos', [
                    '--execute' => true,
                    '--json' => true,
                    ...$arguments,
                ]);
                $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);
            } finally {
                $lock->release();
            }

            $this->assertSame(1, $exitCode);
            $this->assertSame('command_locked', $payload['blocked_reason']);
            $this->assertSame(IngestionCommandLock::name($jobKey), $payload['youtube_quota_budget']['lock']['name']);
        }

        Http::assertNothingSent();
    }

    public function test_youtube_channels_videos_scheduler_executes_each_shared_command_without_a_second_lock(): void
    {
        config()->set('ingestion.lock_store', null);
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', [
            'youtube.channels.videos.general',
            'youtube.channels.videos.live',
            'youtube.channels.videos.live_group',
        ]);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        Http::preventStrayRequests();
        $this->createTables();
        $variants = [
            'youtube.channels.videos.general' => '2026-05-25 00:05:00',
            'youtube.channels.videos.live' => '2026-05-25 02:05:00',
            'youtube.channels.videos.live_group' => '2026-05-25 00:01:00',
        ];

        foreach ($variants as $jobKey => $at) {
            $result = app(IngestionSchedulerRunner::class)->run(
                at: CarbonImmutable::parse($at, 'Asia/Taipei'),
                execute: true,
                jobKey: $jobKey,
            );
            $job = $result['jobs'][0];

            $this->assertSame('executed:local-polling', $job['action'], json_encode($job));
            $this->assertTrue($job['executed']);
            $this->assertFalse($job['failed']);
            $this->assertSame(IngestionCommandLock::name($jobKey), $job['lock']['name']);
            $this->assertStringNotContainsString('command_lock_mapping_unavailable', $job['output']);
            $this->assertStringNotContainsString('command_locked', $job['output']);
        }

        Http::assertNothingSent();
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

    public function test_youtube_channels_videos_execute_rotates_missing_uploads_playlist_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        $this->createTables();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 10,
                'ctime' => '2026-05-20 00:00:00',
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-missing-uploads',
                'title' => 'Missing Uploads Channel',
                'uploads' => '',
                'videoCount' => 10,
            ],
            [
                'u_id' => 11,
                'ctime' => '2026-05-20 00:00:00',
                'vtime' => null,
                'flag_del' => null,
                'youtube_id' => 'UC-ready',
                'title' => 'Ready Channel',
                'uploads' => 'UU-ready',
                'videoCount' => 10,
            ],
        ]);
        Http::fake([
            'www.googleapis.com/youtube/v3/playlistItems*' => Http::response([
                'items' => [
                    $this->playlistItem('ready-item', 'ready-video', '2026-05-25T03:00:00Z', 'Ready upload'),
                ],
            ]),
        ]);

        $firstExit = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--limit' => 1,
            '--max-results' => 1,
            '--json' => true,
        ]);
        $first = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $firstExit);
        $this->assertSame(1, $first['failed_channels']);
        $this->assertSame(0, $first['api_requested_channels']);
        $this->assertSame('missing_uploads_playlist', $first['skipped'][0]['reason']);
        $this->assertSame('2026-05-25 13:00:00', (string) DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        Http::assertNothingSent();

        $secondExit = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--limit' => 1,
            '--max-results' => 1,
            '--json' => true,
        ]);
        $second = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $secondExit);
        $this->assertSame(1, $second['updated_channels']);
        $this->assertSame(11, $second['applied'][0]['u_id']);
        $this->assertSame('Ready upload', DB::table('urt_video')->where('videoId', 'ready-video')->value('title'));
        Http::assertSentCount(1);
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

    public function test_youtube_channels_videos_execute_fails_closed_on_a_malformed_playlist_item(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'vtime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-malformed',
            'title' => 'Malformed Uploads Channel',
            'uploads' => 'UU-malformed',
            'videoCount' => 100,
        ]);
        DB::table('urt_video')->insert([
            'ctime' => '2026-05-24 00:00:00',
            'u_id' => 10,
            'id' => 'existing-playlist-item',
            'videoId' => 'video-50',
            'publishedAt' => '2026-05-24 11:00:00',
            'channelId' => 'UC-existing',
            'title' => 'Existing Valid Title',
            'thumbnails' => 'https://img.youtube.test/existing.jpg',
            'channelTitle' => 'Existing Valid Channel',
            'playlistId' => 'UU-existing',
            'position' => 49,
            'description' => 'Existing valid description',
        ]);
        $items = collect(range(1, 50))
            ->map(fn (int $index): array => $this->playlistItem(
                'item-'.$index,
                'video-'.$index,
                '2026-05-25T03:00:00Z',
                'Upload '.$index,
            ))
            ->all();
        $items[49]['snippet']['publishedAt'] = '2026-02-30T03:00:00Z';
        Http::fake([
            'www.googleapis.com/youtube/v3/playlistItems*' => Http::response([
                'nextPageToken' => 'MORE-UPLOADS',
                'items' => $items,
            ]),
        ]);

        $exitCode = Artisan::call('youtube:channels:videos', [
            '--execute' => true,
            '--channel' => 10,
            '--limit' => 1,
            '--max-results' => 50,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_channels']);
        $this->assertSame(0, $payload['updated_channels']);
        $this->assertSame('playlist_api_error', $payload['skipped'][0]['reason']);
        $this->assertSame('2026-05-25 13:00:00', DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        $this->assertSame(1, DB::table('urt_video')->count());
        $this->assertSame('Existing Valid Title', DB::table('urt_video')->where('videoId', 'video-50')->value('title'));
        $this->assertSame('https://img.youtube.test/existing.jpg', DB::table('urt_video')->where('videoId', 'video-50')->value('thumbnails'));
        $this->assertSame('Existing valid description', DB::table('urt_video')->where('videoId', 'video-50')->value('description'));
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
        $this->assertSame(0, DB::table('urt_video_live')->count());
        Http::assertSentCount(1);
    }

    public function test_youtube_channels_videos_execute_isolates_bad_playlist_and_fails_batch_summary(): void
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

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_channels']);
        $this->assertSame(1, $payload['updated_channels']);
        $this->assertSame(1, $payload['skipped_channels']);
        $this->assertSame(10, $payload['skipped'][0]['u_id']);
        $this->assertSame('playlist_api_error', $payload['skipped'][0]['reason']);
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

    public function test_channel_video_discovery_rotates_database_failure_and_idempotently_completes_partial_writes(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();
        Log::spy();

        DB::table('urt_channel')->insert([
            [
                'u_id' => 10,
                'ctime' => '2026-05-20 00:00:00',
                'youtube_id' => 'UC-fail',
                'title' => 'Failing Channel',
                'uploads' => 'UU-fail',
                'videoCount' => 10,
            ],
            [
                'u_id' => 11,
                'ctime' => '2026-05-20 00:00:00',
                'youtube_id' => 'UC-success',
                'title' => 'Successful Channel',
                'uploads' => 'UU-success',
                'videoCount' => 10,
            ],
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_channel_schedule
BEFORE INSERT ON urt_video_schedule
WHEN NEW.videoId = 'a-retry'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);

        Http::fakeSequence()
            ->push([
                'items' => [$this->playlistItem('item-retry', 'a-retry', '2026-05-25T03:00:00Z', 'Partially written video')],
            ])
            ->push([
                'items' => [$this->playlistItem('item-success', 'b-success', '2026-05-25T03:00:00Z', 'Successful video')],
            ])
            ->push([
                'items' => [$this->playlistItem('item-retry', 'a-retry', '2026-05-25T03:00:00Z', 'Recovered retry video')],
            ]);

        $ingestion = app(ChannelVideosDiscoveryIngestion::class);
        $failed = $ingestion->execute(limit: 1, maxResults: 1);

        $this->assertSame(1, $failed['exit_code']);
        $this->assertSame(1, $failed['failed_channels']);
        $this->assertSame(0, $failed['updated_channels']);
        $this->assertSame('item_processing_failed', $failed['skipped'][0]['reason']);
        $this->assertSame('database_failure_cooldown', $failed['skipped'][0]['retry_state']);
        $this->assertSame('2026-05-25 12:05:00', $failed['skipped'][0]['retry_vtime']);
        $this->assertSame(5, $failed['skipped'][0]['retry_cooldown_minutes']);
        $this->assertSame('2026-05-25 12:05:00', (string) DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        $this->assertStringNotContainsString('super-secret', json_encode($failed, JSON_THROW_ON_ERROR));
        $this->assertTrue(DB::table('urt_video')->where('videoId', 'a-retry')->exists());
        $this->assertFalse(DB::table('urt_video_schedule')->where('videoId', 'a-retry')->exists());

        $laterChannel = $ingestion->execute(limit: 1, maxResults: 1);

        $this->assertSame(0, $laterChannel['exit_code']);
        $this->assertSame(11, $laterChannel['applied'][0]['u_id']);
        $this->assertTrue(DB::table('urt_video')->where('videoId', 'b-success')->exists());

        DB::statement('DROP TRIGGER fail_first_channel_schedule');
        $retried = $ingestion->execute(
            limit: 1,
            maxResults: 1,
            now: CarbonImmutable::parse('2026-05-25 12:05:00', 'Asia/Taipei'),
        );

        $this->assertSame(0, $retried['exit_code']);
        $this->assertSame(10, $retried['applied'][0]['u_id']);
        $this->assertSame('2026-05-27 20:05:00', $retried['applied'][0]['final_vtime']);
        $this->assertSame(1, DB::table('urt_video')->where('videoId', 'a-retry')->count());
        $this->assertSame('Recovered retry video', DB::table('urt_video')->where('videoId', 'a-retry')->value('title'));
        $this->assertSame(1, DB::table('urt_video_schedule')->where('videoId', 'a-retry')->count());
        $this->assertSame('2026-05-27 20:05:00', (string) DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        Http::assertSentCount(3);
        Log::shouldHaveReceived('warning')->withArgs(
            fn (string $message, array $context): bool => $message === 'Channel video discovery item processing failed.'
                && $context['u_id'] === 10
                && $context['retry_state'] === 'database_failure_cooldown'
                && $context['retry_vtime'] === '2026-05-25 12:05:00'
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret'),
        );
    }

    public function test_channel_video_discovery_stops_after_quota_reset_and_preserves_retry_state(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        Log::spy();

        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'ctime' => '2026-05-20 00:00:00', 'vtime' => null, 'youtube_id' => 'UC-first', 'uploads' => 'UU-first', 'videoCount' => 10],
            ['u_id' => 11, 'ctime' => '2026-05-20 00:00:00', 'vtime' => null, 'youtube_id' => 'UC-reset', 'uploads' => 'UU-reset', 'videoCount' => 10],
            ['u_id' => 12, 'ctime' => '2026-05-20 00:00:00', 'vtime' => null, 'youtube_id' => 'UC-never', 'uploads' => 'UU-never', 'videoCount' => 10],
        ]);

        $apiCalls = 0;
        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('playlistItems')
            ->twice()
            ->andReturnUsing(function (string $uploads) use (&$apiCalls): array {
                $apiCalls++;

                if ($uploads === 'UU-reset') {
                    throw new YoutubeQuotaWindowException('youtube_quota_window_reset_guard');
                }

                return [[
                    'id' => 'item-first',
                    'publishedAt' => '2026-05-25T03:00:00Z',
                    'channelId' => 'UC-first',
                    'title' => 'Committed before reset',
                    'description' => 'first',
                    'thumbnails' => 'https://img.youtube.test/first.jpg',
                    'channelTitle' => 'First Channel',
                    'playlistId' => 'UU-first',
                    'position' => 0,
                    'videoId' => 'video-before-reset',
                    'liveBroadcastContent' => 'none',
                ]];
            });
        $ingestion = new ChannelVideosDiscoveryIngestion(
            app(ChannelVideosDiscoveryPreview::class),
            $youtube,
        );

        $payload = $ingestion->execute(limit: 3, maxResults: 1);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertTrue($payload['quota_window_reset']);
        $this->assertSame(2, $payload['remaining_retry_rows']);
        $this->assertSame(1, $payload['updated_channels']);
        $this->assertSame(1, $payload['failed_channels']);
        $this->assertSame('quota_window_reset', $payload['skipped'][0]['reason']);
        $this->assertSame(2, $apiCalls);
        $this->assertTrue(DB::table('urt_video')->where('videoId', 'video-before-reset')->exists());
        $this->assertNotNull(DB::table('urt_channel')->where('u_id', 10)->value('vtime'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 11)->value('vtime'));
        $this->assertNull(DB::table('urt_channel')->where('u_id', 12)->value('vtime'));
        $this->assertStringNotContainsString('youtube_quota_window_reset_guard', json_encode($payload, JSON_THROW_ON_ERROR));
        Log::shouldHaveReceived('warning')->once()->withArgs(
            fn (string $message, array $context): bool => $message === 'Channel video discovery paused at quota window reset.'
                && $context['u_id'] === 11
                && $context['reason'] === 'quota_window_reset'
                && $context['exception_class'] === YoutubeQuotaWindowException::class
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'youtube_quota_window_reset_guard'),
        );
    }

    public function test_youtube_tag_videos_backfill_paginates_uploads_and_rebuilds_tag_date_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
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
        $this->assertSame([10], $payload['selected_channel_ids']);
        $this->assertSame([10], $payload['completed_channel_ids']);
        $this->assertSame([], $payload['failed_channel_ids']);
        $this->assertSame(2, $payload['api_pages']);
        $this->assertSame(4, $payload['api_items']);
        $this->assertSame(2, $payload['videos_in_range']);
        $this->assertSame(2, DB::table('urt_video')->count());
        $this->assertSame(2, DB::table('urt_video_schedule')->count());
        $this->assertSame(1, DB::table('urt_video_live')->count());
        $this->assertSame(1, DB::table('urt_show_tag_date')->where('tagid', '102')->count());
        $this->assertSame(2, (int) DB::table('urt_show_tag_date')->where('tagid', '102')->value('count_videos'));
        $this->assertSame('direct_command', $payload['youtube_quota_budget']['accounting_owner']);
        $this->assertSame('2026-05-26', $payload['youtube_quota_budget']['quota_date']);
        $this->assertSame(50, $payload['youtube_quota_budget']['planned_units']);
        $this->assertSame(2, $payload['youtube_quota_budget']['actual_units']);
        $this->assertSame(2, $payload['youtube_quota_budget']['request_attempts']);
        $this->assertSame(2, $payload['youtube_quota_budget']['consumed_units']);
        $this->assertSame(0, $payload['youtube_quota_budget']['reserved_units']);
        $this->assertFalse($payload['youtube_quota_budget']['reservation_active']);
        Http::assertSentCount(2);
    }

    public function test_youtube_tag_videos_backfill_rejects_invalid_explicit_dates_before_quota_or_writes(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        $this->createTables();
        Http::preventStrayRequests();

        foreach ([
            ['--from' => '2026-02-31', '--to' => '2026-03-01'],
            ['--from' => '2026-04-01', '--to' => '2026-04-31'],
        ] as $dates) {
            $exitCode = Artisan::call('youtube:tag-videos:backfill', [
                '--tagid' => 102,
                ...$dates,
                '--execute' => true,
                '--limit' => 1,
                '--max-pages' => 1,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('execute', $payload['mode']);
            $this->assertFalse($payload['available']);
            $this->assertSame('invalid_date', $payload['blocked_reason']);
            $this->assertSame('date_options_must_be_valid_calendar_dates', $payload['error']);
            $this->assertSame(0, $payload['writes']);
        }

        $this->assertSame(0, DB::table('ingestion_youtube_quota_daily')->count());
        $this->assertSame(0, DB::table('urt_video')->count());
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
        $this->assertSame(0, DB::table('urt_video_live')->count());
        Http::assertNothingSent();
    }

    public function test_youtube_tag_videos_backfill_and_scheduler_fail_when_no_channels_are_selected(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 00:15:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:15:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        $this->createTables();
        Http::preventStrayRequests();

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-25',
            '--to' => '2026-05-25',
            '--execute' => true,
            '--limit' => 10,
            '--max-pages' => 1,
            '--max-results' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('failed', $payload['status']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertFalse($payload['crawl_complete']);
        $this->assertSame(0, $payload['selected_channels']);
        $this->assertSame('no_channels_selected', $payload['tag_date_rebuild_skipped_reason']);
        $this->assertSame(0, $payload['tag_date_writes']);
        $this->assertSame(0, $payload['youtube_quota_budget']['actual_units']);
        Http::assertNothingSent();

        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-26 03:17:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );
        $job = $result['jobs'][0];

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 0, 'failed' => 1], $result['summary']);
        $this->assertSame('failed', $job['action']);
        $this->assertFalse($job['executed']);
        $this->assertTrue($job['failed']);
        $this->assertSame(1, $job['exit_code']);
        $this->assertStringContainsString('crawl_complete=no', $job['output']);
        $this->assertStringContainsString('tag_date_skip=no_channels_selected', $job['output']);
        Http::assertNothingSent();
    }

    public function test_youtube_tag_videos_backfill_marks_a_complete_zero_video_crawl_as_covered(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 00:15:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:15:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => null,
            'vtime' => null,
            'flag_del' => null,
            'youtube_id' => 'UC-news',
            'title' => 'Low Volume News Channel',
            'uploads' => 'UU-news',
            'videoCount' => 1000,
        ]);
        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '[102]']);

        Http::fakeSequence()->push([
            'items' => [
                $this->playlistItem('item-old', 'video-old', '2026-05-24T15:59:00Z', 'Older upload'),
            ],
        ]);

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-25',
            '--to' => '2026-05-25',
            '--execute' => true,
            '--limit' => 10,
            '--max-pages' => 5,
            '--max-results' => 50,
            '--no-rebuild' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertTrue($payload['crawl_complete']);
        $this->assertSame([10], $payload['selected_channel_ids']);
        $this->assertSame([10], $payload['completed_channel_ids']);
        $this->assertSame([], $payload['failed_channel_ids']);
        $this->assertSame(0, $payload['videos_in_range']);
        $this->assertTrue($payload['applied'][0]['stopped_before_from']);
        $this->assertSame(0, DB::table('urt_video')->count());
        Http::assertSentCount(1);
    }

    public function test_youtube_tag_videos_backfill_rejects_a_malformed_full_playlist_page_without_publishing_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();
        $this->createTagDateTables();
        $this->seedTagChannel();
        $items = collect(range(1, 50))
            ->map(fn (int $index): array => $this->playlistItem(
                'daily-item-'.$index,
                'daily-video-'.$index,
                '2026-05-26T09:00:00Z',
                '每日 upload '.$index,
            ))
            ->all();
        unset($items[49]['snippet']['resourceId']['videoId']);
        Http::fake([
            'www.googleapis.com/youtube/v3/playlistItems*' => Http::response([
                'nextPageToken' => 'MORE-DAILY-UPLOADS',
                'items' => $items,
            ]),
        ]);

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-26',
            '--to' => '2026-05-26',
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 5,
            '--max-results' => 50,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['crawl_complete']);
        $this->assertSame([10], $payload['selected_channel_ids']);
        $this->assertSame([], $payload['completed_channel_ids']);
        $this->assertSame([10], $payload['failed_channel_ids']);
        $this->assertSame(1, $payload['failed_channels']);
        $this->assertSame(0, $payload['updated_channels']);
        $this->assertSame('incomplete_channel_crawl', $payload['tag_date_rebuild_skipped_reason']);
        $this->assertSame(0, $payload['tag_date_writes']);
        $this->assertSame(0, DB::table('urt_video')->count());
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
        Http::assertSentCount(1);
    }

    public function test_youtube_tag_videos_backfill_returns_nonzero_when_tag_date_cache_rebuild_fails(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();
        $this->createTagDateTables();
        $this->seedTagChannel();

        $builder = Mockery::mock(TagDateCacheBuilder::class);
        $builder->shouldReceive('build')->once()->andReturn([
            'date' => '2026-05-26',
            'status' => 'failed',
            'channels_matched' => 1,
            'videos_scanned' => 1,
            'tags_count' => 0,
            'writes' => 0,
            'failed_rows' => 1,
            'failure_reason' => 'cache_row_processing_failed',
            'exit_code' => 1,
        ]);
        $this->app->instance(TagDateCacheBuilder::class, $builder);

        Http::fake([
            '*' => Http::response([
                'items' => [$this->playlistItem('item-a', 'video-a', '2026-05-26T09:00:00Z', '每日 upload')],
            ]),
        ]);

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-26',
            '--to' => '2026-05-26',
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 1,
            '--max-results' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertTrue($payload['crawl_complete']);
        $this->assertSame(1, $payload['tag_date_failed_rows']);
        $this->assertSame('tag_date_cache_rebuild_failed', $payload['tag_date_rebuild_skipped_reason']);
        $this->assertSame(1, $payload['tag_date_rows'][0]['exit_code']);
        $this->assertTrue(DB::table('urt_video')->where('videoId', 'video-a')->exists());
    }

    public function test_youtube_tag_videos_backfill_does_not_publish_partial_cache_after_channel_failure(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        $this->createTagDateTables();

        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'ctime' => '2026-05-20 00:00:00', 'flag_del' => null, 'youtube_id' => 'UC-fail', 'title' => 'Failing channel', 'uploads' => 'UU-fail'],
            ['u_id' => 11, 'ctime' => '2026-05-20 00:00:00', 'flag_del' => null, 'youtube_id' => 'UC-good', 'title' => 'Good channel', 'uploads' => 'UU-good'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[102]'],
            ['u_id' => 11, 'tags' => '[102]'],
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
                'nextPageToken' => 'FAIL-PAGE-2',
                'items' => [$this->playlistItem('item-partial', 'video-partial', '2026-05-26T09:00:00Z', '每日 partial')],
            ])
            ->push(['error' => ['message' => 'api_key=must-not-leak']], 500)
            ->push(['error' => ['message' => 'api_key=must-not-leak']], 500)
            ->push([
                'items' => [$this->playlistItem('item-good', 'video-good', '2026-05-26T08:00:00Z', '每日 complete')],
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
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['crawl_complete']);
        $this->assertSame(1, $payload['failed_channels']);
        $this->assertSame(1, $payload['updated_channels']);
        $this->assertSame([10, 11], $payload['selected_channel_ids']);
        $this->assertSame([11], $payload['completed_channel_ids']);
        $this->assertSame([10], $payload['failed_channel_ids']);
        $this->assertSame('incomplete_channel_crawl', $payload['tag_date_rebuild_skipped_reason']);
        $this->assertSame(0, $payload['tag_date_writes']);
        $this->assertFalse(DB::table('urt_video')->where('videoId', 'video-partial')->exists());
        $this->assertTrue(DB::table('urt_video')->where('videoId', 'video-good')->exists());
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
        $this->assertStringNotContainsString('must-not-leak', $output);
        Http::assertSentCount(4);
    }

    public function test_youtube_tag_videos_backfill_refuses_page_cap_partial_crawls_and_command_overlap(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        $this->createTagDateTables();
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'flag_del' => null,
            'youtube_id' => 'UC-cap',
            'title' => 'Capped channel',
            'uploads' => 'UU-cap',
        ]);
        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '[102]']);
        DB::table('tags')->insert([
            'tag' => '每日',
            'max_count' => 10,
            'hours_count' => 20,
            'max_hours' => '2026-05-26 12:00:00',
            'no_tag' => null,
        ]);
        Http::fakeSequence()->push([
            'nextPageToken' => 'STILL-MORE',
            'items' => [$this->playlistItem('item-partial', 'video-partial', '2026-05-26T09:00:00Z', '每日 partial')],
        ]);

        $arguments = [
            '--tagid' => 102,
            '--from' => '2026-05-26',
            '--to' => '2026-05-26',
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 1,
            '--max-results' => 1,
            '--json' => true,
        ];
        $partialExit = Artisan::call('youtube:tag-videos:backfill', $arguments);
        $partial = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $partialExit);
        $this->assertSame(1, $partial['failed_channels']);
        $this->assertFalse($partial['crawl_complete']);
        $this->assertSame([10], $partial['selected_channel_ids']);
        $this->assertSame([], $partial['completed_channel_ids']);
        $this->assertSame([10], $partial['failed_channel_ids']);
        $this->assertSame('incomplete_channel_crawl', $partial['tag_date_rebuild_skipped_reason']);
        $this->assertFalse(DB::table('urt_video')->where('videoId', 'video-partial')->exists());
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());

        $lock = Cache::lock('ingestion:job:'.sha1('youtube.tag_videos.backfill'), 60);
        $this->assertTrue($lock->get());

        try {
            $lockedExit = Artisan::call('youtube:tag-videos:backfill', $arguments);
            $locked = json_decode(trim(Artisan::output()), true);
            $this->assertSame(1, $lockedExit);
            $this->assertFalse($locked['available']);
            $this->assertSame('command_locked', $locked['blocked_reason']);
        } finally {
            $lock->release();
        }

        Http::assertSentCount(1);
    }

    public function test_youtube_tag_videos_backfill_does_not_publish_cache_when_channel_selection_is_capped(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        $this->createTagDateTables();
        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'ctime' => '2026-05-20 00:00:00', 'flag_del' => null, 'youtube_id' => 'UC-first', 'title' => 'First', 'uploads' => 'UU-first'],
            ['u_id' => 11, 'ctime' => '2026-05-20 00:00:00', 'flag_del' => null, 'youtube_id' => 'UC-second', 'title' => 'Second', 'uploads' => 'UU-second'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[102]'],
            ['u_id' => 11, 'tags' => '[102]'],
        ]);
        DB::table('tags')->insert([
            'tag' => '每日',
            'max_count' => 10,
            'hours_count' => 20,
            'max_hours' => '2026-05-26 12:00:00',
            'no_tag' => null,
        ]);
        Http::fakeSequence()->push([
            'items' => [$this->playlistItem('item-first', 'video-first', '2026-05-26T09:00:00Z', '每日 first')],
        ]);

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-26',
            '--to' => '2026-05-26',
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertTrue($payload['channel_selection_truncated']);
        $this->assertFalse($payload['crawl_complete']);
        $this->assertSame(1, $payload['selected_channels']);
        $this->assertSame(1, $payload['updated_channels']);
        $this->assertSame(0, $payload['failed_channels']);
        $this->assertSame('channel_selection_cap_reached', $payload['tag_date_rebuild_skipped_reason']);
        $this->assertTrue(DB::table('urt_video')->where('videoId', 'video-first')->exists());
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
        Http::assertSentCount(1);
    }

    public function test_direct_tag_backfill_fails_closed_when_quota_budget_is_not_configured(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 12:00:00', 'America/Los_Angeles'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.youtube_daily_quota_budget', 0);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['available']);
        $this->assertSame('youtube_quota_accounting_unavailable', $payload['blocked_reason']);
        $this->assertSame('quota_budget_not_configured', $payload['youtube_quota_budget']['reason']);
        $this->assertSame('2026-07-13', $payload['youtube_quota_budget']['quota_date']);
        $this->assertSame(0, DB::table('ingestion_youtube_quota_daily')->count());
        Http::assertNothingSent();
    }

    public function test_direct_tag_backfill_fails_closed_when_quota_ledger_is_missing(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 12:00:00', 'America/Los_Angeles'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        Schema::drop('ingestion_youtube_quota_daily');
        Http::preventStrayRequests();

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['available']);
        $this->assertSame('youtube_quota_accounting_unavailable', $payload['blocked_reason']);
        $this->assertSame('quota_ledger_schema_missing', $payload['youtube_quota_budget']['reason']);
        $this->assertFalse($payload['youtube_quota_budget']['available']);
        Http::assertNothingSent();
    }

    public function test_direct_tag_backfill_reserves_worst_case_and_blocks_budget_overrun(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 12:00:00', 'America/Los_Angeles'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        DB::table('ingestion_youtube_quota_daily')->insert([
            'provider' => 'youtube_data_api_v3',
            'quota_date' => '2026-07-13',
            'consumed_units' => 8999,
            'reserved_units' => 0,
            'created_at' => '2026-07-13 00:00:00',
            'updated_at' => '2026-07-13 00:00:00',
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('youtube_quota_budget_exceeded', $payload['blocked_reason']);
        $this->assertSame('quota_budget_exceeded', $payload['youtube_quota_budget']['reason']);
        $this->assertSame(2, $payload['youtube_quota_budget']['planned_units']);
        $this->assertSame(8999, $payload['youtube_quota_budget']['consumed_units']);
        $this->assertSame(0, $payload['youtube_quota_budget']['reserved_units']);
        Http::assertNothingSent();
    }

    public function test_direct_tag_backfill_returns_nonzero_when_quota_settlement_fails(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'settlement-secret-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        $this->createTables();
        $this->createTagDateTables();
        $this->seedTagChannel();

        Http::fake(function () {
            Schema::drop('ingestion_youtube_quota_daily');

            return Http::response([
                'items' => [$this->playlistItem('item-a', 'video-a', '2026-05-26T09:00:00Z', '每日 upload')],
            ]);
        });

        $exitCode = Artisan::call('youtube:tag-videos:backfill', [
            '--tagid' => 102,
            '--from' => '2026-05-26',
            '--to' => '2026-05-26',
            '--execute' => true,
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertTrue($payload['quota_accounting_failed']);
        $this->assertSame(1, $payload['youtube_quota_budget']['actual_units']);
        $this->assertSame(1, $payload['youtube_quota_budget']['request_attempts']);
        $this->assertSame('quota_ledger_settlement_failed', $payload['youtube_quota_budget']['settlement_reason']);
        $this->assertTrue($payload['youtube_quota_budget']['reservation_active']);
        $this->assertStringNotContainsString('settlement-secret-key', $output);
        Http::assertSentCount(1);
    }

    public function test_scheduled_tag_backfill_uses_scoped_reservation_without_double_charging(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-26 00:17:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:17:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        config()->set('ingestion.jobs', [[
            'key' => 'youtube.tag_videos.backfill',
            'group' => 'Testing',
            'priority' => 1,
            'modern_command' => 'youtube:tag-videos:backfill',
            'scheduled_execute_command' => 'youtube:tag-videos:backfill --tagid=102 --days=2 --execute --limit=1 --max-pages=2 --max-results=1 --json',
            'legacy_command' => 'test only',
            'schedule' => '* * * * *',
            'cadence' => 'test only',
            'status' => 'active',
            'external_dependency' => 'YouTube Data API',
            'writes' => ['test only'],
            'notes' => 'test only',
        ]]);
        $this->createTables();
        $this->createTagDateTables();
        $this->seedTagChannel();
        Http::fake([
            '*' => Http::response([
                'items' => [$this->playlistItem('item-a', 'video-a', '2026-05-25T09:00:00Z', '每日 upload')],
            ]),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );
        $ledger = DB::table('ingestion_youtube_quota_daily')->first();

        $this->assertSame(1, $result['summary']['executed']);
        $this->assertSame(1, $result['jobs'][0]['youtube_quota_budget']['actual_units']);
        $this->assertSame(1, (int) $ledger->consumed_units);
        $this->assertSame(0, (int) $ledger->reserved_units);
        $this->assertStringContainsString('"accounting_owner":"scheduler"', $result['jobs'][0]['output']);
        Http::assertSentCount(1);
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
            $table->increments('pk');
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
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->integer('u_id');
        });

        Schema::create('urt_video_schedule', function ($table): void {
            $table->increments('pk');
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

    private function seedTagChannel(): void
    {
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-20 00:00:00',
            'flag_del' => null,
            'youtube_id' => 'UC-news',
            'title' => 'Daily News Channel',
            'uploads' => 'UU-news',
        ]);
        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '[102]']);
        DB::table('tags')->insert([
            'tag' => '每日',
            'max_count' => 10,
            'hours_count' => 20,
            'max_hours' => '2026-05-26 12:00:00',
            'no_tag' => null,
        ]);
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
        $item = [
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
            ],
        ];

        if ($broadcast !== 'none') {
            $item['snippet']['liveBroadcastContent'] = $broadcast;
        }

        return $item;
    }
}
