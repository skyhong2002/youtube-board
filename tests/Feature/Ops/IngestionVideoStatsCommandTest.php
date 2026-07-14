<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\VideoStatisticsIngestion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionVideoStatsCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_videos_stats_previews_legacy_schedule_queue_in_preview_mode(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        Http::preventStrayRequests();
        $this->createTables();

        for ($i = 1; $i <= 5; $i++) {
            DB::table('urt_video_schedule')->insert([
                'pk' => $i,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => 'due-video-'.$i,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $i,
                'likeCount' => 10 + $i,
                'commentCount' => $i,
            ]);
        }

        DB::table('urt_video_schedule')->insert([
            [
                'pk' => 20,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => '2026-05-25 00:00:00',
                'videoId' => 'future-reserved',
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 200,
                'likeCount' => 20,
                'commentCount' => 2,
            ],
            [
                'pk' => 21,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => 'too-new',
                'publishedAt' => '2026-05-24 17:00:00',
                'viewCount' => 300,
                'likeCount' => 30,
                'commentCount' => 3,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--batch-size' => 5,
            '--loops' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('urt_video_schedule', $payload['source']);
        $this->assertSame(7, $payload['schedule_total']);
        $this->assertSame(5, $payload['due_schedule_rows']);
        $this->assertSame(5, $payload['eligible_rows']);
        $this->assertSame(5, $payload['selected_rows']);
        $this->assertSame(5, $payload['first_batch_rows']);
        $this->assertSame(4, $payload['legacy_threshold']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('2026-06-23 18:00:00', $payload['would_reserve_until']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('due-video-1', $payload['rows'][0]['video_id']);
        $this->assertSame(101, $payload['rows'][0]['current_view_count']);
        $this->assertContains('urt_video_log_history insert', $payload['writes_skipped']);

        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'due-video-1')->value('stime'));
        $this->assertSame(101, DB::table('urt_video_schedule')->where('videoId', 'due-video-1')->value('viewCount'));
        $this->assertSame(0, DB::table('urt_video_log_history')->count());
        $this->assertSame(0, DB::table('urt_video_log')->count());
    }

    public function test_youtube_videos_stats_execute_requires_api_key_before_upsert(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        Http::preventStrayRequests();
        $this->createTables();

        DB::table('urt_video')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'u_id' => 10,
            'videoId' => 'missing-key-video',
            'title' => 'Missing Key Video',
            'channelTitle' => 'Channel A',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => null,
            'likeCount' => null,
            'commentCount' => null,
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--execute' => true,
            '--videoId' => 'missing-key-video',
            '--limit' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not_printed', $output, $output);
        $this->assertNull(DB::table('urt_video')->where('videoId', 'missing-key-video')->value('viewCount'));
        $this->assertSame(0, DB::table('urt_video_schedule')->count());
        $this->assertSame(0, DB::table('urt_video_log_history')->count());
        $this->assertSame(0, DB::table('urt_video_log')->count());
    }

    public function test_youtube_videos_stats_execute_parses_api_and_upserts_idempotently(): void
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
            'videoId' => 'stats-video',
            'title' => 'Stats Video',
            'channelTitle' => 'Channel A',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => null,
            'likeCount' => null,
            'commentCount' => null,
        ]);
        DB::table('urt_video_schedule')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'videoId' => 'stats-video',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => null,
            'likeCount' => null,
            'commentCount' => null,
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'stats-video',
                        'statistics' => [
                            'viewCount' => '1234',
                            'likeCount' => '56',
                            'favoriteCount' => '0',
                            'commentCount' => '7',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $firstExitCode = Artisan::call('youtube:videos:stats', [
            '--execute' => true,
            '--videoId' => 'stats-video',
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['updated_videos']);
        $this->assertContains('urt_video.viewCount', $firstPayload['write_targets']);
        $this->assertSame(1234, DB::table('urt_video')->where('videoId', 'stats-video')->value('viewCount'));
        $this->assertSame(56, DB::table('urt_video')->where('videoId', 'stats-video')->value('likeCount'));
        $this->assertSame(7, DB::table('urt_video')->where('videoId', 'stats-video')->value('commentCount'));
        $this->assertSame(1234, DB::table('urt_video_schedule')->where('videoId', 'stats-video')->value('viewCount'));
        $this->assertSame('2026-06-23 18:00:00', DB::table('urt_video_schedule')->where('videoId', 'stats-video')->value('stime'));
        $this->assertSame(1, DB::table('urt_video_log_history')->where('videoId', 'stats-video')->count());
        $this->assertSame(1, DB::table('urt_video_log')->where('videoId', 'stats-video')->count());

        $log = DB::table('urt_video_log')->where('videoId', 'stats-video')->first();
        $this->assertIsObject($log);
        $logData = json_decode((string) $log->thedata, true);
        $this->assertSame(1234, $logData['2026-05-24']['view']);
        $this->assertSame(56, $logData['2026-05-24']['like']);
        $this->assertSame(7, $logData['2026-05-24']['comment']);

        $secondExitCode = Artisan::call('youtube:videos:stats', [
            '--execute' => true,
            '--videoId' => 'stats-video',
            '--limit' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(1, DB::table('urt_video_log_history')->where('videoId', 'stats-video')->count());
        $this->assertSame(1, DB::table('urt_video_log')->where('videoId', 'stats-video')->count());
        Http::assertSentCount(2);
    }

    public function test_video_statistics_execute_runs_each_loop_batch_and_fails_when_an_api_item_is_missing(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        $videos = [];
        $scheduleRows = [];

        for ($index = 1; $index <= 60; $index++) {
            $videoId = sprintf('stats-loop-%03d', $index);
            $videos[] = [
                'pk' => $index,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => $index,
                'videoId' => $videoId,
                'title' => 'Stats loop '.$index,
                'channelTitle' => 'Channel '.$index,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ];
            $scheduleRows[] = [
                'pk' => $index,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ];
        }

        DB::table('urt_video')->insert($videos);
        DB::table('urt_video_schedule')->insert($scheduleRows);
        $requestedBatches = [];

        Http::fake(function ($request) use (&$requestedBatches) {
            $videoIds = explode(',', (string) $request['id']);
            $requestedBatches[] = $videoIds;
            $items = collect($videoIds)
                ->reject(fn (string $videoId): bool => $videoId === 'stats-loop-060')
                ->map(fn (string $videoId): array => [
                    'id' => $videoId,
                    'statistics' => [
                        'viewCount' => '1234',
                        'likeCount' => '56',
                        'favoriteCount' => '0',
                        'commentCount' => '7',
                    ],
                ])
                ->values()
                ->all();

            return Http::response(['items' => $items], 200);
        });

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 50, loops: 2);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(60, $payload['selected_rows']);
        $this->assertSame(2, $payload['api_batches_attempted']);
        $this->assertSame(2, $payload['api_batches_completed']);
        $this->assertSame(60, $payload['api_requested_videos']);
        $this->assertSame(59, $payload['updated_videos']);
        $this->assertSame(1, $payload['failed_videos']);
        $this->assertSame(['videoId' => 'stats-loop-060', 'reason' => 'api_item_missing'], $payload['skipped'][0]);
        $this->assertSame([50, 10], array_map('count', $requestedBatches));
        $this->assertSame(1234, DB::table('urt_video')->where('videoId', 'stats-loop-051')->value('viewCount'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'stats-loop-060')->value('viewCount'));
        Http::assertSentCount(2);
    }

    public function test_video_statistics_execute_isolates_a_failed_api_batch_and_continues(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        for ($index = 1; $index <= 4; $index++) {
            $videoId = sprintf('stats-batch-%02d', $index);
            DB::table('urt_video')->insert([
                'pk' => $index,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index,
                'videoId' => $videoId,
                'title' => 'Stats batch '.$index,
                'channelTitle' => 'Channel '.$index,
                'publishedAt' => '2026-05-20 12:00:00',
            ]);
            DB::table('urt_video_schedule')->insert([
                'pk' => $index,
                'ctime' => '2026-05-24 00:00:00',
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
            ]);
        }

        Http::fakeSequence()
            ->push(['error' => ['message' => 'temporary batch failure']], 500)
            ->push([
                'items' => collect(['stats-batch-03', 'stats-batch-04'])->map(fn (string $videoId): array => [
                    'id' => $videoId,
                    'statistics' => ['viewCount' => '1234', 'likeCount' => '56', 'commentCount' => '7'],
                ])->all(),
            ], 200);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 2, loops: 2);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(2, $payload['api_batches_attempted']);
        $this->assertSame(1, $payload['api_batches_completed']);
        $this->assertSame(2, $payload['updated_videos']);
        $this->assertSame(2, $payload['failed_videos']);
        $this->assertSame(['api_batch_failed', 'api_batch_failed'], array_column($payload['skipped'], 'reason'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'stats-batch-01')->value('viewCount'));
        $this->assertSame(1234, DB::table('urt_video')->where('videoId', 'stats-batch-03')->value('viewCount'));
        Http::assertSentCount(2);
    }

    public function test_video_statistics_execute_isolates_a_failed_video_and_sanitizes_the_warning(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        Log::spy();

        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 1,
                'videoId' => 'a-fail',
                'title' => 'Failing video',
                'channelTitle' => 'Channel 1',
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 2,
                'videoId' => 'b-success',
                'title' => 'Successful video',
                'channelTitle' => 'Channel 2',
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ],
        ]);
        DB::table('urt_video_schedule')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => 'a-fail',
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => 'b-success',
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ],
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_video_statistics
BEFORE INSERT ON urt_video_log_history
WHEN NEW.videoId = 'a-fail'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'a-fail',
                        'statistics' => [
                            'viewCount' => '111',
                            'likeCount' => '11',
                            'favoriteCount' => '0',
                            'commentCount' => '1',
                        ],
                    ],
                    [
                        'id' => 'b-success',
                        'statistics' => [
                            'viewCount' => '222',
                            'likeCount' => '22',
                            'favoriteCount' => '0',
                            'commentCount' => '2',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 2);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_videos']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertSame(['videoId' => 'a-fail', 'reason' => 'item_processing_failed'], $payload['skipped'][0]);
        $this->assertStringNotContainsString('super-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'a-fail')->value('viewCount'));
        $this->assertSame(222, DB::table('urt_video_schedule')->where('videoId', 'b-success')->value('viewCount'));
        $this->assertSame(0, DB::table('urt_video_log_history')->where('videoId', 'a-fail')->count());
        $this->assertSame(1, DB::table('urt_video_log_history')->where('videoId', 'b-success')->count());
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Video statistics item processing failed.'
                    && $context['video_id'] === 'a-fail'
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            });
    }

    public function test_video_statistics_execute_preserves_malformed_history_and_continues_other_videos(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        foreach (['a-invalid-history', 'b-valid-history'] as $index => $videoId) {
            DB::table('urt_video')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index + 1,
                'videoId' => $videoId,
                'title' => $videoId,
                'channelTitle' => 'Channel '.($index + 1),
                'publishedAt' => '2026-05-20 12:00:00',
            ]);
            DB::table('urt_video_schedule')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
            ]);
        }
        DB::table('urt_video_log')->insert([
            'videoId' => 'a-invalid-history',
            'themonth' => '2026-05-01',
            'thedata' => '{malformed-json',
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => collect(['a-invalid-history', 'b-valid-history'])
                    ->map(fn (string $videoId): array => [
                        'id' => $videoId,
                        'statistics' => [
                            'viewCount' => '1234',
                            'likeCount' => '56',
                            'favoriteCount' => '0',
                            'commentCount' => '7',
                        ],
                    ])
                    ->all(),
            ], 200),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 2, loops: 1);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_videos']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertSame([
            'videoId' => 'a-invalid-history',
            'reason' => 'item_processing_failed',
        ], $payload['skipped'][0]);
        $this->assertSame('{malformed-json', DB::table('urt_video_log')->where('videoId', 'a-invalid-history')->value('thedata'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'a-invalid-history')->value('viewCount'));
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'a-invalid-history')->value('viewCount'));
        $this->assertFalse(DB::table('urt_video_log_history')->where('videoId', 'a-invalid-history')->exists());
        $this->assertSame(1234, DB::table('urt_video')->where('videoId', 'b-valid-history')->value('viewCount'));
        $this->assertTrue(DB::table('urt_video_log_history')->where('videoId', 'b-valid-history')->exists());
    }

    public function test_youtube_videos_stats_supports_today_missing_view_count_branch(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 10,
                'videoId' => 'missing-view-count',
                'title' => 'Missing View Count',
                'channelTitle' => 'Channel A',
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 11,
                'videoId' => 'already-counted',
                'title' => 'Already Counted',
                'channelTitle' => 'Channel B',
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => 100,
                'likeCount' => 10,
                'commentCount' => 1,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--today' => true,
            '--batch-size' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('urt_video', $payload['source']);
        $this->assertTrue($payload['today_mode']);
        $this->assertSame(1, $payload['today_missing_rows']);
        $this->assertSame(1, $payload['eligible_rows']);
        $this->assertSame('missing-view-count', $payload['rows'][0]['video_id']);
        $this->assertSame('Missing View Count', $payload['rows'][0]['title']);

        $this->assertNull(DB::table('urt_video')->where('videoId', 'missing-view-count')->value('viewCount'));
    }

    public function test_youtube_videos_stats_supports_single_video_preview_and_scheduler_execution(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_video')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'u_id' => 10,
            'videoId' => 'target-video',
            'title' => 'Target Video',
            'channelTitle' => 'Channel A',
            'publishedAt' => '2026-05-24 12:00:00',
            'viewCount' => 500,
            'likeCount' => 50,
            'commentCount' => 5,
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--videoId' => 'target-video',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('target-video', $payload['target_video_id']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('target-video', $payload['rows'][0]['video_id']);

        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:07:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.videos.stats',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_video_log_history', 'urt_video_log', 'urt_video_schedule', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video_schedule', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('u_id');
            $table->string('videoId');
            $table->string('title');
            $table->string('channelTitle');
            $table->dateTime('publishedAt');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video_log_history', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->string('videoId')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('dislikeCount')->nullable();
            $table->integer('favoriteCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video_log', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->string('videoId')->nullable();
            $table->string('themonth')->nullable();
            $table->text('thedata')->nullable();
        });
    }
}
