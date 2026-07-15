<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\VideoStatisticsIngestion;
use App\Services\Ingestion\VideoStatisticsPreview;
use App\Services\Ingestion\YoutubeApiKeyPoolExhaustedException;
use App\Services\Ingestion\YoutubeDataApiClient;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Mockery;
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
        $this->assertNull($payload['would_reserve_until']);
        $this->assertTrue($payload['would_recalculate_stime']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('due-video-1', $payload['rows'][0]['video_id']);
        $this->assertSame(101, $payload['rows'][0]['current_view_count']);
        $this->assertSame('dynamic_after_api_statistics', $payload['rows'][0]['would_set_stime']);
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
        $this->assertSame('2026-05-28 04:39:30', DB::table('urt_video_schedule')->where('videoId', 'stats-video')->value('stime'));
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
                    'statistics' => ['viewCount' => '1234', 'likeCount' => '56', 'favoriteCount' => '0', 'commentCount' => '7'],
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

    public function test_video_statistics_keeps_source_due_and_records_each_cross_time_retry_observation(): void
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
            'u_id' => 1,
            'videoId' => 'final-source-failure',
            'title' => 'Final source failure',
            'channelTitle' => 'Channel 1',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => 100,
            'likeCount' => 10,
            'commentCount' => 1,
        ]);
        DB::table('urt_video_schedule')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'videoId' => 'final-source-failure',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => 100,
            'likeCount' => 10,
            'commentCount' => 1,
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_final_video_schedule_write
BEFORE UPDATE ON urt_video_schedule
WHEN OLD.videoId = 'final-source-failure'
BEGIN
    SELECT RAISE(FAIL, 'final schedule failure');
END
SQL);
        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [[
                    'id' => 'final-source-failure',
                    'statistics' => [
                        'viewCount' => '999',
                        'likeCount' => '99',
                        'favoriteCount' => '0',
                        'commentCount' => '9',
                    ],
                ]],
            ], 200),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 1, loops: 1);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_videos']);
        $this->assertSame(0, $payload['updated_videos']);
        $this->assertSame('item_processing_failed', $payload['skipped'][0]['reason']);
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'final-source-failure')->value('stime'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'final-source-failure')->value('stime'));
        $this->assertSame(100, DB::table('urt_video_schedule')->where('videoId', 'final-source-failure')->value('viewCount'));
        $this->assertSame(999, DB::table('urt_video')->where('videoId', 'final-source-failure')->value('viewCount'));
        $this->assertSame(1, DB::table('urt_video_log_history')->where('videoId', 'final-source-failure')->count());
        $this->assertSame(1, DB::table('urt_video_log')->where('videoId', 'final-source-failure')->count());

        DB::statement('DROP TRIGGER fail_final_video_schedule_write');
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:01:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:01:00', 'Asia/Taipei'));

        $retry = app(VideoStatisticsIngestion::class)->execute(batchSize: 1, loops: 1);
        $observationTimes = DB::table('urt_video_log_history')
            ->where('videoId', 'final-source-failure')
            ->orderBy('ctime')
            ->pluck('ctime')
            ->all();
        $monthly = json_decode(
            (string) DB::table('urt_video_log')->where('videoId', 'final-source-failure')->value('thedata'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $this->assertSame(0, $retry['exit_code']);
        $this->assertSame(1, $retry['updated_videos']);
        $this->assertSame(['2026-05-24 18:00:00', '2026-05-24 18:01:00'], $observationTimes);
        $this->assertSame(1, DB::table('urt_video_log')->where('videoId', 'final-source-failure')->count());
        $this->assertSame(['2026-05-24'], array_keys($monthly));
        $this->assertSame('2026-05-29 00:08:09', DB::table('urt_video_schedule')->where('videoId', 'final-source-failure')->value('stime'));
    }

    public function test_video_statistics_api_key_pool_exhaustion_preserves_current_and_remaining_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));

        foreach ([
            YoutubeApiKeyPoolExhaustedException::AUTHENTICATION_FAILURE,
            YoutubeApiKeyPoolExhaustedException::QUOTA_FAILURE,
        ] as $reason) {
            $this->createTables();
            DB::table('urt_video_schedule')->insert([
                [
                    'pk' => 1,
                    'ctime' => '2026-05-24 00:00:00',
                    'videoId' => 'stats-key-pool-a',
                    'publishedAt' => '2026-05-20 12:00:00',
                    'viewCount' => 100,
                ],
                [
                    'pk' => 2,
                    'ctime' => '2026-05-24 00:00:00',
                    'videoId' => 'stats-key-pool-b',
                    'publishedAt' => '2026-05-20 12:00:00',
                    'viewCount' => 200,
                ],
            ]);
            $youtube = Mockery::mock(YoutubeDataApiClient::class);
            $youtube->shouldReceive('videoStatistics')
                ->once()
                ->andThrow(new YoutubeApiKeyPoolExhaustedException($reason));
            $ingestion = new VideoStatisticsIngestion(app(VideoStatisticsPreview::class), $youtube);

            $payload = $ingestion->execute(batchSize: 1, loops: 2);

            $this->assertSame(1, $payload['exit_code']);
            $this->assertFalse($payload['quota_window_reset']);
            $this->assertSame(1, $payload['api_batches_attempted']);
            $this->assertSame(1, $payload['api_requested_videos']);
            $this->assertSame(2, $payload['remaining_retry_rows']);
            $this->assertSame(2, $payload['failed_videos']);
            $this->assertSame([$reason, $reason], array_column($payload['skipped'], 'reason'));
            $this->assertSame(0, DB::table('urt_video_schedule')->whereNotNull('stime')->count());
            $this->assertSame(0, DB::table('urt_video_schedule')->whereNotNull('mtime')->count());
            $this->assertSame(0, DB::table('urt_video_log_history')->count());
            $this->assertSame(0, DB::table('urt_video_log')->count());
        }
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

    public function test_today_statistics_cooldown_rotates_rejected_rows_and_retries_after_expiry(): void
    {
        $now = CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei');
        Carbon::setTestNow($now);
        CarbonImmutable::setTestNow($now);
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        foreach (['a-rejected-today', 'b-valid-today'] as $index => $videoId) {
            DB::table('urt_video')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index + 1,
                'videoId' => $videoId,
                'title' => $videoId,
                'channelTitle' => 'Channel '.($index + 1),
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => null,
            ]);
        }

        $requested = [];
        Http::fake(function ($request) use (&$requested) {
            $videoId = (string) $request['id'];
            $requested[] = $videoId;

            if ($videoId === 'a-rejected-today' && count($requested) === 1) {
                return Http::response([
                    'items' => [[
                        'id' => $videoId,
                        'statistics' => ['viewCount' => 'not-a-count'],
                    ]],
                ]);
            }

            return Http::response([
                'items' => [[
                    'id' => $videoId,
                    'statistics' => [
                        'viewCount' => $videoId === 'a-rejected-today' ? '111' : '222',
                        'likeCount' => '10',
                        'favoriteCount' => '0',
                        'commentCount' => '1',
                    ],
                ]],
            ]);
        });

        $first = app(VideoStatisticsIngestion::class)->execute(today: true, batchSize: 1, now: $now);
        $firstRetryAt = DB::table('urt_video')->where('videoId', 'a-rejected-today')->value('stime');
        $previewAfterFirst = app(VideoStatisticsPreview::class)->preview(today: true, batchSize: 1, now: $now);
        $second = app(VideoStatisticsIngestion::class)->execute(today: true, batchSize: 1, now: $now);
        $third = app(VideoStatisticsIngestion::class)->execute(
            today: true,
            batchSize: 1,
            now: $now->addMinutes(6),
        );

        $this->assertSame(1, $first['exit_code']);
        $this->assertSame('api_item_missing', $first['skipped'][0]['reason']);
        $this->assertSame('2026-05-24 18:05:00', $firstRetryAt);
        $this->assertSame(1, $previewAfterFirst['today_missing_rows']);
        $this->assertSame('b-valid-today', $second['applied'][0]['videoId']);
        $this->assertSame('a-rejected-today', $third['applied'][0]['videoId']);
        $this->assertSame(['a-rejected-today', 'b-valid-today', 'a-rejected-today'], $requested);
        $this->assertSame(111, DB::table('urt_video')->where('videoId', 'a-rejected-today')->value('viewCount'));
        $this->assertSame(222, DB::table('urt_video')->where('videoId', 'b-valid-today')->value('viewCount'));
    }

    public function test_youtube_videos_stats_supports_single_video_preview_and_scheduler_execution(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 10,
                'videoId' => 'target_video',
                'title' => 'Target Video',
                'channelTitle' => 'Channel A',
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => 500,
                'likeCount' => 50,
                'commentCount' => 5,
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 11,
                'videoId' => 'targetXvideo',
                'title' => 'Similar Video',
                'channelTitle' => 'Channel B',
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => 600,
                'likeCount' => 60,
                'commentCount' => 6,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--videoId' => 'target_video',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('target_video', $payload['target_video_id']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('target_video', $payload['rows'][0]['video_id']);

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

    public function test_video_statistics_accepts_omitted_optional_counts_and_preserves_known_values(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        foreach (['known-optional', 'unknown-optional'] as $index => $videoId) {
            $known = $videoId === 'known-optional';
            DB::table('urt_video')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index + 1,
                'videoId' => $videoId,
                'title' => $videoId,
                'channelTitle' => 'Channel '.($index + 1),
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => $known ? 100 : null,
                'likeCount' => $known ? 42 : null,
                'favoriteCount' => $known ? 6 : null,
                'commentCount' => $known ? 8 : null,
            ]);
            DB::table('urt_video_schedule')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => $known ? 100 : null,
                'likeCount' => $known ? 40 : null,
                'commentCount' => $known ? 7 : null,
            ]);
        }
        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    ['id' => 'known-optional', 'statistics' => ['viewCount' => '1000']],
                    ['id' => 'unknown-optional', 'statistics' => ['viewCount' => '2000']],
                ],
            ], 200),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 2, loops: 1);
        $unknownMonthly = json_decode(
            (string) DB::table('urt_video_log')->where('videoId', 'unknown-optional')->value('thedata'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $this->assertSame(0, $payload['exit_code']);
        $this->assertSame(2, $payload['updated_videos']);
        $this->assertSame(0, $payload['failed_videos']);
        $this->assertNull($payload['applied'][0]['likeCount']);
        $this->assertNull($payload['applied'][0]['commentCount']);
        $this->assertSame(1000, DB::table('urt_video')->where('videoId', 'known-optional')->value('viewCount'));
        $this->assertSame(42, DB::table('urt_video')->where('videoId', 'known-optional')->value('likeCount'));
        $this->assertSame(6, DB::table('urt_video')->where('videoId', 'known-optional')->value('favoriteCount'));
        $this->assertSame(8, DB::table('urt_video')->where('videoId', 'known-optional')->value('commentCount'));
        $this->assertSame(40, DB::table('urt_video_schedule')->where('videoId', 'known-optional')->value('likeCount'));
        $this->assertSame(7, DB::table('urt_video_schedule')->where('videoId', 'known-optional')->value('commentCount'));
        $knownHistory = DB::table('urt_video_log_history')->where('videoId', 'known-optional')->first();
        $this->assertSame(42, $knownHistory->likeCount);
        $this->assertSame(6, $knownHistory->favoriteCount);
        $this->assertSame(8, $knownHistory->commentCount);
        $this->assertSame(2000, DB::table('urt_video')->where('videoId', 'unknown-optional')->value('viewCount'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'unknown-optional')->value('likeCount'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'unknown-optional')->value('favoriteCount'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'unknown-optional')->value('commentCount'));
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'unknown-optional')->value('likeCount'));
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'unknown-optional')->value('commentCount'));
        $this->assertFalse(DB::table('urt_video_log_history')->where('videoId', 'unknown-optional')->exists());
        $this->assertSame(2000, $unknownMonthly['2026-05-24']['view']);
        $this->assertArrayNotHasKey('like', $unknownMonthly['2026-05-24']);
        $this->assertArrayNotHasKey('comment', $unknownMonthly['2026-05-24']);
        $this->assertSame('2026-05-26 21:00:01', DB::table('urt_video_schedule')->where('videoId', 'unknown-optional')->value('stime'));
    }

    public function test_video_statistics_uses_dynamic_cadence_when_favorite_count_is_omitted(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        DB::table('urt_video')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'u_id' => 1,
            'videoId' => 'favorite-omitted',
            'title' => 'Favorite omitted',
            'channelTitle' => 'Channel 1',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => 100,
            'likeCount' => 10,
            'favoriteCount' => null,
            'commentCount' => 1,
        ]);
        DB::table('urt_video_schedule')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 16:00:00',
            'videoId' => 'favorite-omitted',
            'publishedAt' => '2026-05-20 12:00:00',
            'viewCount' => 100,
            'likeCount' => 10,
            'commentCount' => 1,
        ]);
        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [[
                    'id' => 'favorite-omitted',
                    'statistics' => [
                        'viewCount' => '1100',
                        'likeCount' => '20',
                        'commentCount' => '2',
                    ],
                ]],
            ]),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 1, loops: 1);
        $monthly = json_decode(
            (string) DB::table('urt_video_log')->where('videoId', 'favorite-omitted')->value('thedata'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $this->assertSame(0, $payload['exit_code']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertSame(1100, DB::table('urt_video')->where('videoId', 'favorite-omitted')->value('viewCount'));
        $this->assertSame(20, DB::table('urt_video')->where('videoId', 'favorite-omitted')->value('likeCount'));
        $this->assertNull(DB::table('urt_video')->where('videoId', 'favorite-omitted')->value('favoriteCount'));
        $this->assertSame(2, DB::table('urt_video')->where('videoId', 'favorite-omitted')->value('commentCount'));
        $this->assertFalse(DB::table('urt_video_log_history')->where('videoId', 'favorite-omitted')->exists());
        $this->assertSame(1100, $monthly['2026-05-24']['view']);
        $this->assertSame(20, $monthly['2026-05-24']['like']);
        $this->assertSame(2, $monthly['2026-05-24']['comment']);
        $this->assertSame('2026-05-24 20:00:01', DB::table('urt_video_schedule')->where('videoId', 'favorite-omitted')->value('stime'));
    }

    public function test_video_statistics_cools_down_malformed_items_and_rotates_to_later_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        foreach (['a-malformed-count', 'b-valid-count'] as $index => $videoId) {
            DB::table('urt_video')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index + 1,
                'videoId' => $videoId,
                'title' => $videoId,
                'channelTitle' => 'Channel '.($index + 1),
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $index,
                'likeCount' => 10 + $index,
                'commentCount' => 1 + $index,
            ]);
            DB::table('urt_video_schedule')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $index,
                'likeCount' => 10 + $index,
                'commentCount' => 1 + $index,
            ]);
        }
        $requested = [];
        Http::fake(function ($request) use (&$requested) {
            $videoId = (string) $request['id'];
            $requested[] = $videoId;

            return Http::response([
                'items' => [[
                    'id' => $videoId,
                    'statistics' => $videoId === 'a-malformed-count'
                        ? ['viewCount' => '999', 'likeCount' => 'not-a-count']
                        : ['viewCount' => '222', 'likeCount' => '22', 'favoriteCount' => '0', 'commentCount' => '2'],
                ]],
            ]);
        });

        $first = app(VideoStatisticsIngestion::class)->execute(batchSize: 1, loops: 1);

        $this->assertSame(1, $first['exit_code']);
        $this->assertSame(['videoId' => 'a-malformed-count', 'reason' => 'api_item_missing'], $first['skipped'][0]);
        $this->assertSame(100, DB::table('urt_video_schedule')->where('videoId', 'a-malformed-count')->value('viewCount'));
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'a-malformed-count')->value('mtime'));
        $this->assertSame('2026-05-24 18:05:00', DB::table('urt_video_schedule')->where('videoId', 'a-malformed-count')->value('stime'));
        $this->assertFalse(DB::table('urt_video_log_history')->where('videoId', 'a-malformed-count')->exists());

        $second = app(VideoStatisticsIngestion::class)->execute(batchSize: 1, loops: 1);

        $this->assertSame(0, $second['exit_code']);
        $this->assertSame(1, $second['updated_videos']);
        $this->assertSame(222, DB::table('urt_video')->where('videoId', 'b-valid-count')->value('viewCount'));
        $this->assertSame(['a-malformed-count', 'b-valid-count'], $requested);
        Http::assertSentCount(2);
    }

    public function test_video_statistics_isolates_and_sanitizes_rejected_item_cooldown_failures(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        Log::spy();

        foreach (['a-cooldown-failure', 'b-after-cooldown-failure'] as $index => $videoId) {
            DB::table('urt_video')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index + 1,
                'videoId' => $videoId,
                'title' => $videoId,
                'channelTitle' => 'Channel '.($index + 1),
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $index,
                'likeCount' => 10 + $index,
                'commentCount' => 1 + $index,
            ]);
            DB::table('urt_video_schedule')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $index,
                'likeCount' => 10 + $index,
                'commentCount' => 1 + $index,
            ]);
        }
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_rejected_video_cooldown
BEFORE UPDATE ON urt_video_schedule
WHEN OLD.videoId = 'a-cooldown-failure'
BEGIN
    SELECT RAISE(FAIL, 'token=cooldown-secret');
END
SQL);
        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'a-cooldown-failure',
                        'statistics' => ['viewCount' => 'not-a-count'],
                    ],
                    [
                        'id' => 'b-after-cooldown-failure',
                        'statistics' => ['viewCount' => '222', 'likeCount' => '22', 'favoriteCount' => '0', 'commentCount' => '2'],
                    ],
                ],
            ]),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 2, loops: 1);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_videos']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertSame(['videoId' => 'a-cooldown-failure', 'reason' => 'item_processing_failed'], $payload['skipped'][0]);
        $this->assertStringNotContainsString('cooldown-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'a-cooldown-failure')->value('stime'));
        $this->assertSame(100, DB::table('urt_video')->where('videoId', 'a-cooldown-failure')->value('viewCount'));
        $this->assertFalse(DB::table('urt_video_log_history')->where('videoId', 'a-cooldown-failure')->exists());
        $this->assertSame(222, DB::table('urt_video')->where('videoId', 'b-after-cooldown-failure')->value('viewCount'));
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Video statistics item processing failed.'
                    && $context['video_id'] === 'a-cooldown-failure'
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'cooldown-secret');
            });
    }

    public function test_video_statistics_rejects_missing_required_or_malformed_counts_and_preserves_existing_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        $this->createTables();

        foreach (['a-missing-view', 'b-malformed-like', 'c-valid'] as $index => $videoId) {
            DB::table('urt_video')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'u_id' => $index + 1,
                'videoId' => $videoId,
                'title' => $videoId,
                'channelTitle' => 'Channel '.($index + 1),
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $index,
                'likeCount' => 10 + $index,
                'commentCount' => 1 + $index,
            ]);
            DB::table('urt_video_schedule')->insert([
                'pk' => $index + 1,
                'ctime' => '2026-05-24 00:00:00',
                'videoId' => $videoId,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $index,
                'likeCount' => 10 + $index,
                'commentCount' => 1 + $index,
            ]);
        }

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'a-missing-view',
                        'statistics' => ['likeCount' => '999', 'commentCount' => '99'],
                    ],
                    [
                        'id' => 'b-malformed-like',
                        'statistics' => ['viewCount' => '9999', 'likeCount' => 'not-a-count', 'commentCount' => '99'],
                    ],
                    [
                        'id' => 'c-valid',
                        'statistics' => ['viewCount' => '3333', 'likeCount' => '33', 'favoriteCount' => '0', 'commentCount' => '3'],
                    ],
                ],
            ], 200),
        ]);

        $payload = app(VideoStatisticsIngestion::class)->execute(batchSize: 3, loops: 1);

        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(2, $payload['failed_videos']);
        $this->assertSame(1, $payload['updated_videos']);
        $this->assertSame([
            ['videoId' => 'a-missing-view', 'reason' => 'api_item_missing'],
            ['videoId' => 'b-malformed-like', 'reason' => 'api_item_missing'],
        ], $payload['skipped']);
        $this->assertSame(100, DB::table('urt_video')->where('videoId', 'a-missing-view')->value('viewCount'));
        $this->assertSame(11, DB::table('urt_video')->where('videoId', 'b-malformed-like')->value('likeCount'));
        $this->assertSame(3333, DB::table('urt_video')->where('videoId', 'c-valid')->value('viewCount'));
        $this->assertSame('2026-05-24 18:05:00', DB::table('urt_video_schedule')->where('videoId', 'a-missing-view')->value('stime'));
        $this->assertSame('2026-05-24 18:05:00', DB::table('urt_video_schedule')->where('videoId', 'b-malformed-like')->value('stime'));
        $this->assertSame(0, DB::table('urt_video_log_history')->whereIn('videoId', ['a-missing-view', 'b-malformed-like'])->count());
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
            $table->integer('dislikeCount')->nullable();
            $table->integer('favoriteCount')->nullable();
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
