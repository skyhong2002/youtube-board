<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\VideoDurationsIngestion;
use App\Services\Ingestion\VideoDurationsPreview;
use App\Services\Ingestion\YoutubeDataApiClient;
use App\Services\Ingestion\YoutubeQuotaWindowException;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Tests\TestCase;

class IngestionVideoDurationCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_videos_duration_previews_legacy_queue_in_preview_mode(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        Http::preventStrayRequests();
        $this->createTables();

        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 10,
                'id' => 'upload-a',
                'publishedAt' => '2026-05-23 12:00:00',
                'channelId' => 'channel-a',
                'title' => 'Queued Video A',
                'thumbnails' => 'https://example.test/a.jpg',
                'channelTitle' => 'Channel A',
                'playlistId' => 'playlist-a',
                'position' => 1,
                'videoId' => 'video-a',
                'viewCount' => 100,
                'likeCount' => 1,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
                'description' => '',
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 20,
                'id' => 'upload-missing',
                'publishedAt' => '2026-05-23 13:00:00',
                'channelId' => 'channel-missing',
                'title' => 'Unqueued Missing Video',
                'thumbnails' => 'https://example.test/missing.jpg',
                'channelTitle' => 'Channel Missing',
                'playlistId' => 'playlist-missing',
                'position' => 2,
                'videoId' => 'video-missing-duration-row',
                'viewCount' => 200,
                'likeCount' => 2,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
                'description' => '',
            ],
        ]);

        DB::table('urt_video_duration')->insert([
            [
                'pk_video' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'publishedAt' => '2026-05-23 12:00:00',
                'u_id' => 10,
                'videoId' => 'video-a',
                'duration' => null,
                'caption' => null,
            ],
            [
                'pk_video' => 2,
                'ctime' => '2026-05-24 00:01:00',
                'mtime' => null,
                'stime' => null,
                'publishedAt' => '2026-05-23 12:05:00',
                'u_id' => 11,
                'videoId' => 'video-b',
                'duration' => null,
                'caption' => null,
            ],
            [
                'pk_video' => 3,
                'ctime' => '2026-05-24 00:02:00',
                'mtime' => null,
                'stime' => '2026-06-23 18:00:00',
                'publishedAt' => '2026-05-23 12:10:00',
                'u_id' => 12,
                'videoId' => 'reserved-video',
                'duration' => null,
                'caption' => null,
            ],
            [
                'pk_video' => 4,
                'ctime' => '2026-05-24 00:03:00',
                'mtime' => '2026-05-24 01:00:00',
                'stime' => '2026-05-24 01:00:00',
                'publishedAt' => '2026-05-23 12:15:00',
                'u_id' => 13,
                'videoId' => 'done-video',
                'duration' => 123,
                'caption' => 'false',
            ],
            [
                'pk_video' => 5,
                'ctime' => '2026-05-24 00:04:00',
                'mtime' => '2026-05-24 01:10:00',
                'stime' => null,
                'publishedAt' => '2026-05-23 12:20:00',
                'u_id' => 14,
                'videoId' => 'missing-content-details',
                'duration' => null,
                'caption' => null,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:duration', [
            '--batch-size' => 5,
            '--loops' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(5, $payload['queue_total']);
        $this->assertSame(2, $payload['ready_queue_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(1, $payload['completed_rows']);
        $this->assertSame(1, $payload['reserved_rows']);
        $this->assertSame(1, $payload['failed_or_missing_rows']);
        $this->assertSame(1, $payload['unqueued_missing_videos']);
        $this->assertSame(1, $payload['legacy_threshold']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('2026-06-23 18:00:00', $payload['would_reserve_until']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('video-a', $payload['rows'][0]['video_id']);
        $this->assertSame('Queued Video A', $payload['rows'][0]['title']);
        $this->assertSame('Channel A', $payload['rows'][0]['channel_title']);

        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'video-a')->value('stime'));
        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'video-a')->value('duration'));
    }

    public function test_youtube_videos_duration_execute_requires_api_key_before_upsert(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        Http::preventStrayRequests();
        $this->createTables();

        DB::table('urt_video_duration')->insert([
            'pk_video' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'publishedAt' => '2026-05-23 12:00:00',
            'u_id' => 10,
            'videoId' => 'missing-key-duration',
            'duration' => null,
            'caption' => null,
        ]);

        $exitCode = Artisan::call('youtube:videos:duration', [
            '--execute' => true,
            '--videoId' => 'missing-key-duration',
            '--limit' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not_printed', $output, $output);
        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'missing-key-duration')->value('mtime'));
        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'missing-key-duration')->value('stime'));
        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'missing-key-duration')->value('duration'));
    }

    public function test_youtube_videos_duration_execute_parses_content_details_and_updates_idempotently(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_video_duration')->insert([
            'pk_video' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'publishedAt' => '2026-05-23 12:00:00',
            'u_id' => 10,
            'videoId' => 'duration-video',
            'duration' => null,
            'caption' => null,
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'duration-video',
                        'contentDetails' => [
                            'duration' => 'PT1H2M3S',
                            'caption' => 'true',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $firstExitCode = Artisan::call('youtube:videos:duration', [
            '--execute' => true,
            '--videoId' => 'duration-video',
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['updated_videos']);
        $this->assertContains('urt_video_duration.duration', $firstPayload['write_targets']);
        $this->assertSame(3723, DB::table('urt_video_duration')->where('videoId', 'duration-video')->value('duration'));
        $this->assertSame('true', DB::table('urt_video_duration')->where('videoId', 'duration-video')->value('caption'));
        $this->assertSame('2026-05-24 18:00:00', DB::table('urt_video_duration')->where('videoId', 'duration-video')->value('mtime'));
        $this->assertSame('2026-05-24 18:00:00', DB::table('urt_video_duration')->where('videoId', 'duration-video')->value('stime'));

        $secondExitCode = Artisan::call('youtube:videos:duration', [
            '--execute' => true,
            '--videoId' => 'duration-video',
            '--limit' => 1,
            '--json' => true,
        ]);
        $secondPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(0, $secondPayload['selected_rows']);
        $this->assertSame(0, $secondPayload['updated_videos']);
        $this->assertSame(1, DB::table('urt_video_duration')->where('videoId', 'duration-video')->count());
        $this->assertSame(3723, DB::table('urt_video_duration')->where('videoId', 'duration-video')->value('duration'));
        Http::assertSentCount(1);
    }

    public function test_video_duration_execute_isolates_a_failed_video_and_sanitizes_the_warning(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        Log::spy();

        DB::table('urt_video_duration')->insert([
            [
                'pk_video' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'publishedAt' => '2026-05-23 12:00:00',
                'u_id' => 1,
                'videoId' => 'a-fail',
                'duration' => null,
                'caption' => null,
            ],
            [
                'pk_video' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'publishedAt' => '2026-05-23 12:00:00',
                'u_id' => 2,
                'videoId' => 'b-success',
                'duration' => null,
                'caption' => null,
            ],
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_video_duration
BEFORE UPDATE ON urt_video_duration
WHEN OLD.videoId = 'a-fail'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'a-fail',
                        'contentDetails' => ['duration' => 'PT1M11S', 'caption' => 'false'],
                    ],
                    [
                        'id' => 'b-success',
                        'contentDetails' => ['duration' => 'PT2M22S', 'caption' => 'true'],
                    ],
                ],
            ], 200),
        ]);

        $payload = app(VideoDurationsIngestion::class)->execute(batchSize: 2);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_videos']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertSame(['videoId' => 'a-fail', 'reason' => 'item_processing_failed'], $payload['skipped'][0]);
        $this->assertStringNotContainsString('super-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'a-fail')->value('duration'));
        $this->assertNull(DB::table('urt_video_duration')->where('videoId', 'a-fail')->value('mtime'));
        $this->assertSame(142, DB::table('urt_video_duration')->where('videoId', 'b-success')->value('duration'));
        $this->assertSame('2026-05-24 18:00:00', DB::table('urt_video_duration')->where('videoId', 'b-success')->value('mtime'));
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Video duration item processing failed.'
                    && $context['video_id'] === 'a-fail'
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            });
    }

    public function test_youtube_videos_duration_execute_can_explicitly_enqueue_existing_local_video(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_video')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'u_id' => 10,
            'id' => 'upload-enqueue',
            'publishedAt' => '2026-05-23 12:00:00',
            'channelId' => 'channel-enqueue',
            'title' => 'Enqueue Video',
            'thumbnails' => 'https://example.test/enqueue.jpg',
            'channelTitle' => 'Channel Enqueue',
            'playlistId' => 'playlist-enqueue',
            'position' => 1,
            'videoId' => 'enqueue-video',
            'viewCount' => 100,
            'likeCount' => 1,
            'dislikeCount' => 0,
            'favoriteCount' => 0,
            'commentCount' => 0,
            'description' => '',
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'enqueue-video',
                        'contentDetails' => [
                            'duration' => 'PT5M4S',
                            'caption' => 'false',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $exitCode = Artisan::call('youtube:videos:duration', [
            '--execute' => true,
            '--videoId' => 'enqueue-video',
            '--limit' => 1,
            '--enqueue-missing' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['queued_videos']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertContains('urt_video_duration.videoId', $payload['write_targets']);
        $this->assertSame(304, DB::table('urt_video_duration')->where('videoId', 'enqueue-video')->value('duration'));
        $this->assertSame('false', DB::table('urt_video_duration')->where('videoId', 'enqueue-video')->value('caption'));
        $this->assertSame(10, DB::table('urt_video_duration')->where('videoId', 'enqueue-video')->value('u_id'));
        Http::assertSentCount(1);
    }

    public function test_youtube_videos_duration_execute_can_enqueue_recent_missing_local_videos(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_video')->insert([
            $this->videoRow(1, 'older-missing-duration', '2026-05-23 12:00:00'),
            $this->videoRow(2, 'newer-missing-duration', '2026-05-24 12:00:00'),
            $this->videoRow(3, 'already-queued-duration', '2026-05-24 13:00:00'),
        ]);
        DB::table('urt_video_duration')->insert([
            'pk_video' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'publishedAt' => '2026-05-24 13:00:00',
            'u_id' => 3,
            'videoId' => 'already-queued-duration',
            'duration' => null,
            'caption' => null,
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'already-queued-duration',
                        'contentDetails' => [
                            'duration' => 'PT1M1S',
                            'caption' => 'false',
                        ],
                    ],
                    [
                        'id' => 'newer-missing-duration',
                        'contentDetails' => [
                            'duration' => 'PT2M2S',
                            'caption' => 'true',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $exitCode = Artisan::call('youtube:videos:duration', [
            '--execute' => true,
            '--limit' => 2,
            '--enqueue-missing' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['queued_videos']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(2, $payload['updated_videos']);
        $this->assertSame('newer-missing-duration', $payload['queued'][0]['videoId']);
        $this->assertSame(61, DB::table('urt_video_duration')->where('videoId', 'already-queued-duration')->value('duration'));
        $this->assertSame(0, DB::table('urt_video_duration')->where('videoId', 'older-missing-duration')->count());
        $this->assertSame(1, DB::table('urt_video_duration')->where('videoId', 'newer-missing-duration')->count());
        $this->assertSame(122, DB::table('urt_video_duration')->where('videoId', 'newer-missing-duration')->value('duration'));
        Http::assertSentCount(1);
    }

    public function test_video_duration_quota_reset_preserves_new_queue_row_for_retry(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTables();
        Log::spy();
        DB::table('urt_video')->insert($this->videoRow(10, 'retry-duration', '2026-05-24 12:00:00'));

        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('videoContentDetails')
            ->once()
            ->andThrow(new YoutubeQuotaWindowException('token=super-secret'));
        $ingestion = new VideoDurationsIngestion(
            app(VideoDurationsPreview::class),
            $youtube,
        );

        $payload = $ingestion->execute(
            videoId: 'retry-duration',
            batchSize: 1,
            enqueueMissing: true,
        );
        $queueRow = DB::table('urt_video_duration')->where('videoId', 'retry-duration')->first();

        $this->assertSame(1, $payload['exit_code']);
        $this->assertTrue($payload['quota_window_reset']);
        $this->assertSame(1, $payload['remaining_retry_rows']);
        $this->assertSame(1, $payload['queued_videos']);
        $this->assertSame('quota_window_reset', $payload['skipped'][0]['reason']);
        $this->assertNotNull($queueRow);
        $this->assertNull($queueRow->mtime);
        $this->assertNull($queueRow->stime);
        $this->assertNull($queueRow->duration);
        $this->assertStringNotContainsString('super-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        Log::shouldHaveReceived('warning')->once()->withArgs(
            fn (string $message, array $context): bool => $message === 'Video duration polling paused at quota window reset.'
                && $context['reason'] === 'quota_window_reset'
                && $context['selected_rows'] === 1
                && $context['exception_class'] === YoutubeQuotaWindowException::class
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret'),
        );
    }

    public function test_youtube_videos_duration_supports_single_queued_video_preview(): void
    {
        $this->createTables();
        DB::table('urt_video_duration')->insert([
            [
                'pk_video' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'publishedAt' => '2026-05-23 12:00:00',
                'u_id' => 10,
                'videoId' => 'target-video',
                'duration' => null,
                'caption' => null,
            ],
            [
                'pk_video' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'publishedAt' => '2026-05-23 12:00:00',
                'u_id' => 10,
                'videoId' => 'other-video',
                'duration' => null,
                'caption' => null,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:duration', [
            '--videoId' => 'target-video',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('target-video', $payload['target_video_id']);
        $this->assertSame(1, $payload['ready_queue_rows']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('target-video', $payload['rows'][0]['video_id']);
    }

    public function test_ingestion_scheduler_respects_scheduled_write_off_gate_for_duration(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:23:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.videos.duration',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_video_duration', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('u_id');
            $table->string('id');
            $table->dateTime('publishedAt');
            $table->string('channelId');
            $table->string('title');
            $table->string('thumbnails');
            $table->string('channelTitle');
            $table->string('playlistId');
            $table->integer('position');
            $table->string('videoId');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('dislikeCount')->nullable();
            $table->integer('favoriteCount')->nullable();
            $table->integer('commentCount')->nullable();
            $table->text('description');
        });

        Schema::create('urt_video_duration', function ($table): void {
            $table->integer('pk_video');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->integer('u_id')->nullable();
            $table->string('videoId');
            $table->integer('duration')->nullable();
            $table->string('caption')->nullable();
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
            'mtime' => null,
            'stime' => null,
            'u_id' => $uId,
            'id' => 'upload-'.$videoId,
            'publishedAt' => $publishedAt,
            'channelId' => 'channel-'.$uId,
            'title' => 'Video '.$videoId,
            'thumbnails' => 'https://example.test/'.$videoId.'.jpg',
            'channelTitle' => 'Channel '.$uId,
            'playlistId' => 'playlist-'.$uId,
            'position' => 1,
            'videoId' => $videoId,
            'viewCount' => 100,
            'likeCount' => 1,
            'dislikeCount' => 0,
            'favoriteCount' => 0,
            'commentCount' => 0,
            'description' => '',
        ];
    }
}
