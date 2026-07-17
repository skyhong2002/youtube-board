<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiDailyIngestion;
use App\Services\Ingestion\AiDailyPreview;
use App\Services\Ingestion\AiHourlyIngestion;
use App\Services\Ingestion\AiHourlyPreview;
use App\Services\Ingestion\AiScheduledPipelineIngestion;
use App\Services\Ingestion\ChannelVideosDiscoveryIngestion;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\TagVideoBackfillIngestion;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

class AiScheduledPipelineIngestionTest extends TestCase
{
    public function test_daily_preview_reports_required_channels_missing_from_tag_selection(): void
    {
        $requiredChannelIds = AiDailyPreview::channelAiUids();
        $missingChannelId = array_pop($requiredChannelIds);
        $pipeline = $this->dailyPreviewPipeline([
            'mode' => 'dry-run',
            'selected_channels' => count($requiredChannelIds),
            'selected_channel_ids' => $requiredChannelIds,
            'writes' => [],
        ]);

        $result = $pipeline->previewDaily(date: '2026-07-14');

        $this->assertSame('ingestion-preview', $result['mode']);
        $this->assertSame(39, $result['source_refresh']['required_channels']);
        $this->assertSame(38, $result['source_refresh']['selected_required_channels']);
        $this->assertSame([$missingChannelId], $result['source_refresh']['missing_required_channel_ids']);
        $this->assertFalse($result['source_refresh']['required_channel_selection_complete']);
        $this->assertFalse($result['source_refresh']['required_channel_coverage_proven']);
        $this->assertSame([], $result['writes']);
    }

    public function test_daily_preview_uses_and_reports_the_execute_caps_without_external_calls_or_writes(): void
    {
        Http::preventStrayRequests();
        $pipeline = $this->dailyPreviewPipeline([
            'mode' => 'dry-run',
            'selected_channels' => 39,
            'selected_channel_ids' => AiDailyPreview::channelAiUids(),
            'writes' => [],
        ], expectedLimit: 321, expectedChannelLimit: 7, expectedChannelBatchSize: 3, expectedAiCallLimit: 11, expectedChannelVideoLimit: 88);

        $result = $pipeline->previewDaily(
            date: '2026-07-14',
            channelLimit: 7,
            channelBatchSize: 3,
            aiCallLimit: 11,
            channelVideoLimit: 88,
            limit: 321,
        );

        $this->assertSame([
            'limit' => 321,
            'channel_limit' => 7,
            'channel_batch_size' => 3,
            'ai_call_limit' => 11,
            'channel_video_limit' => 88,
            'channel_video_limit_requested' => 88,
            'channel_video_limit_clamped' => false,
            'channel_video_limit_max' => 500,
        ], $result['execution_caps']);
        $this->assertSame([], $result['source_refresh']['writes']);
        $this->assertSame(TagVideoBackfillIngestion::TAG_DATE_KEYWORD_LIMIT, $result['source_refresh']['keyword_limit']);
        $this->assertSame([], $result['ai']['writes']);
        $this->assertSame([], $result['writes']);
        Http::assertNothingSent();
    }

    public function test_daily_preview_applies_all_execute_caps_to_nested_ai_calculations(): void
    {
        Http::preventStrayRequests();
        $this->createDailyPreviewTables();
        $this->seedCappedDailyPreviewFixtures();
        $pipeline = $this->dailyPreviewPipelineUsing(
            sourcePayload: $this->completeDailySourcePreview(),
            dailyPreview: $this->app->make(AiDailyPreview::class),
        );

        $result = $pipeline->previewDaily(
            date: '2026-07-14',
            channelLimit: 7,
            channelBatchSize: 3,
            aiCallLimit: 11,
            channelVideoLimit: 8,
            limit: 4,
        );
        $ai = $result['ai'];
        $refresh = $ai['channel_ai_refresh'];

        $this->assertSame(7, $refresh['would_attempt_channel_ai_refresh']);
        $this->assertSame(array_slice(AiDailyPreview::channelAiUids(), 1, 7), $refresh['selected_channel_ids']);
        $this->assertSame(3, $refresh['batch_size']);
        $this->assertSame(3, $refresh['batches']);
        $this->assertSame(7, $refresh['would_call_channel_ai_requests']);
        $this->assertSame(7, $refresh['would_insert_channel_ai_candidates']);
        $this->assertSame(8, $refresh['video_limit']);
        $this->assertSame(7, $refresh['prompt_truncated_channels']);
        $this->assertSame(28, $refresh['prompt_omitted_video_rows']);
        $this->assertSame(8, $refresh['sample_channels'][0]['prompt_video_rows']);
        $this->assertSame(5, collect($ai['condition_rows'])->firstWhere('condition', 'all')['source_rows']);
        $this->assertSame(4, collect($ai['condition_rows'])->firstWhere('condition', 'all')['media_rows']);
        $this->assertSame(['all', 'green', 'blue', 'neutral'], collect($ai['condition_rows'])
            ->where('would_call_ai', true)
            ->pluck('condition')
            ->all());
        $this->assertSame(['finance', 'world'], collect($ai['condition_rows'])
            ->where('eligible_for_ai', true)
            ->where('would_call_ai', false)
            ->pluck('condition')
            ->all());
        $this->assertSame(7, $ai['would_call_channel_ai_requests']);
        $this->assertSame(4, $ai['would_call_ai_requests']);
        $this->assertSame(11, $ai['would_call_total_ai_requests']);
        $this->assertSame([
            'limit' => 11,
            'would_use' => 11,
            'remaining' => 0,
            'maximum_post_refresh_would_use' => 11,
            'maximum_post_refresh_remaining' => 0,
            'channel_ai_would_use' => 7,
            'daily_ai_would_use' => 4,
            'maximum_post_refresh_daily_ai_would_use' => 4,
            'unit' => 'logical_completion_chain',
        ], $ai['ai_call_guard']);
        Http::assertNothingSent();
    }

    public function test_daily_preview_full_limit_walks_all_configured_channels_but_calls_only_eligible_channels(): void
    {
        $this->createDailyPreviewTables();
        $this->seedCappedDailyPreviewFixtures();
        $pipeline = $this->dailyPreviewPipelineUsing(
            sourcePayload: $this->completeDailySourcePreview(),
            dailyPreview: $this->app->make(AiDailyPreview::class),
        );

        $result = $pipeline->previewDaily(date: '2026-07-14', channelLimit: 39, aiCallLimit: 45);
        $refresh = $result['ai']['channel_ai_refresh'];

        $this->assertSame(AiDailyPreview::channelAiUids(), $refresh['selected_channel_ids']);
        $this->assertSame(39, $refresh['would_attempt_channel_ai_refresh']);
        $this->assertSame(8, $refresh['eligible_channel_ai_candidates']);
        $this->assertSame(8, $refresh['would_call_channel_ai_requests']);
        $this->assertSame(31, $refresh['would_skip_fewer_than_10_videos']);
    }

    public function test_daily_preview_exposes_post_refresh_call_capacity_when_current_channel_ai_cache_is_empty(): void
    {
        $this->createDailyPreviewTables();
        $this->seedCappedDailyPreviewFixtures();
        DB::table('urt_channel_ai')->delete();
        $pipeline = $this->dailyPreviewPipelineUsing(
            sourcePayload: $this->completeDailySourcePreview(),
            dailyPreview: $this->app->make(AiDailyPreview::class),
        );

        $result = $pipeline->previewDaily(
            date: '2026-07-14',
            channelLimit: 7,
            channelBatchSize: 3,
            aiCallLimit: 11,
            channelVideoLimit: 8,
        );
        $ai = $result['ai'];

        $this->assertSame(7, $ai['would_call_channel_ai_requests']);
        $this->assertSame(0, $ai['would_call_ai_requests']);
        $this->assertSame(7, $ai['would_call_total_ai_requests']);
        $this->assertSame(0, $ai['confirmed_current_daily_ai_requests']);
        $this->assertSame(7, $ai['confirmed_current_total_ai_requests']);
        $this->assertSame(4, $ai['maximum_post_refresh_daily_ai_requests']);
        $this->assertSame(11, $ai['maximum_post_refresh_total_ai_requests']);
        $this->assertSame(11, $ai['ai_call_guard']['maximum_post_refresh_would_use']);
    }

    public function test_daily_pipeline_command_json_preserves_nested_preview_caps(): void
    {
        Http::preventStrayRequests();
        $this->createDailyPreviewTables();
        $this->seedCappedDailyPreviewFixtures();
        $this->app->instance(AiScheduledPipelineIngestion::class, $this->dailyPreviewPipelineUsing(
            sourcePayload: $this->completeDailySourcePreview(),
            dailyPreview: $this->app->make(AiDailyPreview::class),
        ));

        $exitCode = Artisan::call('ai:daily:pipeline', [
            '--date' => '2026-07-14',
            '--limit' => 4,
            '--channel-limit' => 7,
            '--channel-batch-size' => 3,
            '--ai-call-limit' => 11,
            '--channel-video-limit' => 8,
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame(7, $payload['ai']['channel_ai_refresh']['would_attempt_channel_ai_refresh']);
        $this->assertSame(3, $payload['ai']['channel_ai_refresh']['batches']);
        $this->assertSame(7, $payload['ai']['would_call_channel_ai_requests']);
        $this->assertSame(4, $payload['ai']['would_call_ai_requests']);
        $this->assertSame(11, $payload['ai']['would_call_total_ai_requests']);
        $this->assertLessThanOrEqual(
            $payload['execution_caps']['ai_call_limit'],
            $payload['ai']['ai_call_guard']['would_use'],
        );
        Http::assertNothingSent();
    }

    public function test_daily_pipeline_command_propagates_blocked_source_preflight(): void
    {
        Http::preventStrayRequests();
        $dailyPreview = Mockery::mock(AiDailyPreview::class);
        $dailyPreview->shouldNotReceive('preview');
        $this->app->instance(AiScheduledPipelineIngestion::class, $this->dailyPreviewPipelineUsing(
            sourcePayload: [
                'mode' => 'dry-run',
                'status' => 'blocked',
                'exit_code' => 1,
                'selected_channels' => count(AiDailyPreview::channelAiUids()),
                'selected_channel_ids' => AiDailyPreview::channelAiUids(),
                'keyword_source_complete' => false,
                'blocked_reason' => 'keyword_scan_limit_exceeded',
                'writes' => [],
            ],
            dailyPreview: $dailyPreview,
        ));

        $exitCode = Artisan::call('ai:daily:pipeline', [
            '--date' => '2026-07-14',
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('blocked', $payload['status']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame('keyword_scan_limit_exceeded', $payload['source_refresh']['blocked_reason']);
        $this->assertFalse($payload['source_refresh']['keyword_source_complete']);
        $this->assertSame('skipped', $payload['ai']['status']);
        $this->assertTrue($payload['ai']['skipped']);
        $this->assertSame('keyword_scan_limit_exceeded', $payload['ai']['skip_reason']);
        $this->assertFalse($payload['ai']['ai_call_attempted']);
        $this->assertSame([], $payload['writes']);
        Http::assertNothingSent();
    }

    public function test_daily_pipeline_command_passes_and_renders_all_preview_caps(): void
    {
        Http::preventStrayRequests();
        $pipeline = Mockery::mock(AiScheduledPipelineIngestion::class);
        $pipeline->shouldReceive('previewDaily')
            ->once()
            ->with('2026-07-14', 7, 3, 11, 88, 321)
            ->andReturn([
                'mode' => 'ingestion-preview',
                'date' => '2026-07-14',
                'execution_caps' => [
                    'limit' => 321,
                    'channel_limit' => 7,
                    'channel_batch_size' => 3,
                    'ai_call_limit' => 11,
                    'channel_video_limit' => 88,
                ],
                'source_refresh' => [
                    'succeeded' => false,
                    'completed_channels' => 0,
                    'failed_channels' => 0,
                ],
                'ai' => ['status' => 'preview'],
                'writes' => [],
            ]);
        $this->app->instance(AiScheduledPipelineIngestion::class, $pipeline);

        $exitCode = Artisan::call('ai:daily:pipeline', [
            '--date' => '2026-07-14',
            '--limit' => 321,
            '--channel-limit' => 7,
            '--channel-batch-size' => 3,
            '--ai-call-limit' => 11,
            '--channel-video-limit' => 88,
            '--dry-run' => true,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('limit=321', $output);
        $this->assertStringContainsString('channel_limit=7', $output);
        $this->assertStringContainsString('channel_batch_size=3', $output);
        $this->assertStringContainsString('ai_call_limit=11', $output);
        $this->assertStringContainsString('channel_video_limit=88', $output);
        Http::assertNothingSent();
    }

    public function test_daily_pipeline_does_not_run_ai_when_complete_source_crawl_is_not_proven(): void
    {
        $pipeline = $this->pipeline(
            quotaPayload: [
                'exit_code' => 0,
                'crawl_complete' => false,
                'selected_channels' => 39,
                'updated_channels' => 38,
                'failed_channels' => 1,
                'write_targets' => ['urt_video'],
            ],
            daily: function (MockInterface $mock): void {
                $mock->shouldNotReceive('execute');
            },
        );

        $result = $pipeline->executeDaily(date: '2026-07-14');

        $this->assertSame('blocked', $result['status']);
        $this->assertSame(1, $result['exit_code']);
        $this->assertFalse($result['source_refresh']['succeeded']);
        $this->assertSame('incomplete_channel_crawl', $result['source_refresh']['failure_reason']);
        $this->assertTrue($result['ai']['skipped']);
        $this->assertFalse($result['ai']['ai_call_attempted']);
        $this->assertSame(['urt_video'], $result['write_targets']);
    }

    public function test_daily_pipeline_runs_ai_only_after_complete_source_crawl(): void
    {
        $pipeline = $this->pipeline(
            quotaPayload: [
                'exit_code' => 0,
                'crawl_complete' => true,
                'selected_channels' => 39,
                'updated_channels' => 39,
                'failed_channels' => 0,
                'completed_channel_ids' => AiDailyPreview::channelAiUids(),
                'videos_in_range' => 0,
            ],
            daily: function (MockInterface $mock): void {
                $mock->shouldReceive('execute')->once()->andReturn([
                    'status' => 'success',
                    'exit_code' => 0,
                    'failed_rows' => 0,
                    'write_targets' => ['urt_channel_ai', 'urt_ai_date'],
                ]);
            },
        );

        $result = $pipeline->executeDaily(date: '2026-07-14');

        $this->assertSame('success', $result['status']);
        $this->assertSame(0, $result['exit_code']);
        $this->assertTrue($result['source_refresh']['succeeded']);
        $this->assertTrue($result['source_refresh']['required_channel_coverage_complete']);
        $this->assertSame(39, $result['source_refresh']['completed_required_channels']);
        $this->assertSame([], $result['source_refresh']['missing_required_channel_ids']);
        $this->assertSame(0, $result['source_refresh']['videos_in_range']);
        $this->assertSame('success', $result['ai']['status']);
    }

    public function test_daily_pipeline_propagates_required_daily_source_failure(): void
    {
        $pipeline = $this->pipeline(
            quotaPayload: [
                'exit_code' => 0,
                'crawl_complete' => true,
                'selected_channels' => 39,
                'updated_channels' => 39,
                'failed_channels' => 0,
                'completed_channel_ids' => AiDailyPreview::channelAiUids(),
            ],
            daily: function (MockInterface $mock): void {
                $mock->shouldReceive('execute')->once()->andReturn([
                    'status' => 'partial_failure',
                    'exit_code' => 1,
                    'failed_rows' => 1,
                    'daily_ai' => [
                        'failed' => 1,
                        'rows' => [[
                            'condition' => 'all',
                            'skip_reason' => 'no_source_events',
                            'failed' => true,
                        ]],
                    ],
                    'write_targets' => ['urt_channel_ai', 'urt_ai_date'],
                ]);
            },
        );

        $result = $pipeline->executeDaily(date: '2026-07-14');

        $this->assertSame('partial_failure', $result['status']);
        $this->assertSame(1, $result['exit_code']);
        $this->assertSame(1, $result['failed_rows']);
        $this->assertSame('no_source_events', $result['ai']['daily_ai']['rows'][0]['skip_reason']);
    }

    public function test_daily_pipeline_does_not_trust_complete_counts_when_a_required_channel_was_not_crawled(): void
    {
        $requiredChannelIds = AiDailyPreview::channelAiUids();
        $missingChannelId = array_pop($requiredChannelIds);
        $coveredChannelIds = [...$requiredChannelIds, 999999];
        $pipeline = $this->pipeline(
            quotaPayload: [
                'exit_code' => 0,
                'crawl_complete' => true,
                'selected_channels' => 39,
                'updated_channels' => 39,
                'failed_channels' => 0,
                'completed_channel_ids' => $coveredChannelIds,
            ],
            daily: function (MockInterface $mock): void {
                $mock->shouldNotReceive('execute');
            },
        );

        $result = $pipeline->executeDaily(date: '2026-07-14');

        $this->assertSame('blocked', $result['status']);
        $this->assertSame(1, $result['exit_code']);
        $this->assertFalse($result['source_refresh']['succeeded']);
        $this->assertTrue($result['source_refresh']['crawl_complete']);
        $this->assertSame('required_channel_crawl_incomplete', $result['source_refresh']['failure_reason']);
        $this->assertSame(39, $result['source_refresh']['required_channels']);
        $this->assertSame(38, $result['source_refresh']['completed_required_channels']);
        $this->assertSame([$missingChannelId], $result['source_refresh']['missing_required_channel_ids']);
        $this->assertFalse($result['source_refresh']['required_channel_coverage_complete']);
        $this->assertFalse($result['ai']['ai_call_attempted']);
    }

    public function test_daily_pipeline_requires_the_explicit_completed_channel_id_contract(): void
    {
        $pipeline = $this->pipeline(
            quotaPayload: [
                'exit_code' => 0,
                'crawl_complete' => true,
                'selected_channels' => 39,
                'updated_channels' => 39,
                'failed_channels' => 0,
                'applied' => array_map(
                    fn (int $uId): array => ['u_id' => $uId],
                    AiDailyPreview::channelAiUids(),
                ),
            ],
            daily: function (MockInterface $mock): void {
                $mock->shouldNotReceive('execute');
            },
        );

        $result = $pipeline->executeDaily(date: '2026-07-14');

        $this->assertSame('blocked', $result['status']);
        $this->assertSame('required_channel_crawl_incomplete', $result['source_refresh']['failure_reason']);
        $this->assertSame(0, $result['source_refresh']['completed_required_channels']);
        $this->assertSame(AiDailyPreview::channelAiUids(), $result['source_refresh']['missing_required_channel_ids']);
        $this->assertFalse($result['ai']['ai_call_attempted']);
    }

    public function test_hourly_pipeline_does_not_run_ai_when_any_channel_window_is_incomplete(): void
    {
        $pipeline = $this->hourlyPipeline(
            channelResult: [
                'exit_code' => 1,
                'applied' => [],
            ],
            hourly: function (MockInterface $mock): void {
                $mock->shouldNotReceive('execute');
            },
        );

        $result = $pipeline->executeHourly(
            now: CarbonImmutable::parse('2026-07-15 10:10:00', 'Asia/Taipei'),
        );

        $this->assertSame('blocked', $result['status']);
        $this->assertSame(1, $result['exit_code']);
        $this->assertFalse($result['source_refresh']['succeeded']);
        $this->assertSame(39, $result['source_refresh']['failed_channels']);
        $this->assertTrue($result['ai']['skipped']);
        $this->assertFalse($result['ai']['ai_call_attempted']);
    }

    public function test_hourly_pipeline_runs_ai_after_all_channel_windows_are_refreshed(): void
    {
        $pipeline = $this->hourlyPipeline(
            channelResult: [
                'exit_code' => 0,
                'applied' => [[
                    'api_items' => 1,
                    'oldest_published_at' => '2026-07-15 08:59:59',
                ]],
            ],
            hourly: function (MockInterface $mock): void {
                $mock->shouldReceive('execute')->once()->andReturn([
                    'status' => 'success',
                    'exit_code' => 0,
                    'failed_rows' => 0,
                    'write_targets' => ['urt_ai_hour'],
                ]);
            },
        );

        $result = $pipeline->executeHourly(
            now: CarbonImmutable::parse('2026-07-15 10:10:00', 'Asia/Taipei'),
        );

        $this->assertSame('success', $result['status']);
        $this->assertSame(0, $result['exit_code']);
        $this->assertTrue($result['source_refresh']['succeeded']);
        $this->assertSame(39, $result['source_refresh']['completed_channels']);
        $this->assertSame('success', $result['ai']['status']);
    }

    /**
     * @param  array<string, mixed>  $quotaPayload
     */
    private function pipeline(array $quotaPayload, Closure $daily): AiScheduledPipelineIngestion
    {
        $tagBackfill = Mockery::mock(TagVideoBackfillIngestion::class);
        $channelVideos = Mockery::mock(ChannelVideosDiscoveryIngestion::class);
        $quotaGuard = Mockery::mock(DirectYoutubeQuotaGuard::class);
        $dailyPreview = Mockery::mock(AiDailyPreview::class);
        $dailyIngestion = Mockery::mock(AiDailyIngestion::class);
        $daily($dailyIngestion);
        $hourlyPreview = Mockery::mock(AiHourlyPreview::class);
        $hourlyIngestion = Mockery::mock(AiHourlyIngestion::class);
        $quotaGuard->shouldReceive('publicState')->once()->with([])->andReturn([]);

        $quotaGuard->shouldReceive('run')->once()->withArgs(
            fn (string $jobKey, string $effectiveCommand): bool => $jobKey === 'youtube.tag_videos.backfill'
                && str_contains($effectiveCommand, '--keyword-limit='.TagVideoBackfillIngestion::TAG_DATE_KEYWORD_LIMIT),
        )->andReturn([
            'allowed' => true,
            'guard' => [],
            'payload' => $quotaPayload,
        ]);

        return new AiScheduledPipelineIngestion(
            $tagBackfill,
            $channelVideos,
            $quotaGuard,
            $dailyPreview,
            $dailyIngestion,
            $hourlyPreview,
            $hourlyIngestion,
        );
    }

    /**
     * @param  array<string, mixed>  $sourcePayload
     */
    private function dailyPreviewPipeline(
        array $sourcePayload,
        int $expectedLimit = 1000,
        int $expectedChannelLimit = 39,
        int $expectedChannelBatchSize = 12,
        int $expectedAiCallLimit = 45,
        int $expectedChannelVideoLimit = 120,
    ): AiScheduledPipelineIngestion {
        $dailyPreview = Mockery::mock(AiDailyPreview::class);
        $dailyPreview->shouldReceive('preview')
            ->once()
            ->withArgs(fn (...$arguments): bool => ($arguments[0] ?? null) === '2026-07-14'
                && ($arguments[1] ?? null) === null
                && ($arguments[2] ?? null) === 'oneday'
                && ($arguments[3] ?? null) === $expectedLimit
                && ($arguments[4] ?? null) instanceof CarbonInterface
                && ($arguments[5] ?? null) === false
                && ($arguments[6] ?? null) === $expectedChannelLimit
                && ($arguments[7] ?? null) === $expectedChannelBatchSize
                && ($arguments[8] ?? null) === $expectedAiCallLimit
                && ($arguments[9] ?? null) === $expectedChannelVideoLimit)
            ->andReturn(['writes' => []]);

        return $this->dailyPreviewPipelineUsing($sourcePayload, $dailyPreview);
    }

    /**
     * @param  array<string, mixed>  $sourcePayload
     */
    private function dailyPreviewPipelineUsing(array $sourcePayload, AiDailyPreview $dailyPreview): AiScheduledPipelineIngestion
    {
        $tagBackfill = Mockery::mock(TagVideoBackfillIngestion::class);
        $tagBackfill->shouldReceive('run')
            ->once()
            ->withArgs(fn (...$arguments): bool => ($arguments[0] ?? null) === [102]
                && ($arguments[3] ?? null) === '2026-07-14'
                && ($arguments[4] ?? null) === '2026-07-14'
                && ($arguments[9] ?? null) === TagVideoBackfillIngestion::TAG_DATE_KEYWORD_LIMIT
                && ($arguments[11] ?? null) === false
                && ($arguments[12] ?? null) instanceof CarbonInterface)
            ->andReturn($sourcePayload + [
                'keyword_limit' => TagVideoBackfillIngestion::TAG_DATE_KEYWORD_LIMIT,
            ]);
        $channelVideos = Mockery::mock(ChannelVideosDiscoveryIngestion::class);
        $quotaGuard = Mockery::mock(DirectYoutubeQuotaGuard::class);
        $dailyIngestion = Mockery::mock(AiDailyIngestion::class);
        $hourlyPreview = Mockery::mock(AiHourlyPreview::class);
        $hourlyIngestion = Mockery::mock(AiHourlyIngestion::class);

        return new AiScheduledPipelineIngestion(
            $tagBackfill,
            $channelVideos,
            $quotaGuard,
            $dailyPreview,
            $dailyIngestion,
            $hourlyPreview,
            $hourlyIngestion,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function completeDailySourcePreview(): array
    {
        return [
            'mode' => 'dry-run',
            'selected_channels' => count(AiDailyPreview::channelAiUids()),
            'selected_channel_ids' => AiDailyPreview::channelAiUids(),
            'writes' => [],
        ];
    }

    private function createDailyPreviewTables(): void
    {
        Schema::create('urt_channel', function (Blueprint $table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
        });
        Schema::create('urt_count', function (Blueprint $table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });
        Schema::create('urt_channel_ai', function (Blueprint $table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('data_type');
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });
        Schema::create('urt_ai_date', function (Blueprint $table): void {
            $table->increments('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('data_type');
            $table->string('condition_type');
            $table->integer('del_flag')->nullable();
        });
        Schema::create('urt_video', function (Blueprint $table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
        });
    }

    private function seedCappedDailyPreviewFixtures(): void
    {
        $channelIds = array_slice(AiDailyPreview::channelAiUids(), 0, 9);
        DB::table('urt_channel')->insert(collect($channelIds)
            ->map(fn (int $uId): array => ['u_id' => $uId, 'title' => 'Channel '.$uId])
            ->all());

        foreach ($channelIds as $channelIndex => $uId) {
            $videoCount = $channelIndex === 0 ? 9 : 12;
            DB::table('urt_video')->insert(collect(range(1, $videoCount))
                ->map(fn (int $index): array => [
                    'u_id' => $uId,
                    'videoId' => $uId.'-video-'.$index,
                    'publishedAt' => '2026-07-14 12:00:00',
                    'title' => 'Video '.$uId.'-'.$index,
                    'channelTitle' => 'Channel '.$uId,
                ])
                ->all());
        }

        $dailyChannels = array_slice($channelIds, 1, 5);
        DB::table('urt_count')->insert([
            ['u_id' => $dailyChannels[0], 'tags' => '[4]'],
            ['u_id' => $dailyChannels[1], 'tags' => '[3]'],
            ['u_id' => $dailyChannels[2], 'tags' => '[31]'],
            ['u_id' => $dailyChannels[3], 'tags' => '[41]'],
            ['u_id' => $dailyChannels[4], 'tags' => ''],
        ]);
        DB::table('urt_channel_ai')->insert(collect($dailyChannels)
            ->map(fn (int $uId): array => [
                'u_id' => $uId,
                'date_from' => '2026-07-14 00:00:00',
                'date_to' => '2026-07-14 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([[
                    '事件' => 'Event '.$uId,
                    'videoId' => [$uId.'-video-1', $uId.'-video-2'],
                ]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            ])
            ->all());
    }

    /**
     * @param  array<string, mixed>  $channelResult
     */
    private function hourlyPipeline(array $channelResult, Closure $hourly): AiScheduledPipelineIngestion
    {
        $tagBackfill = Mockery::mock(TagVideoBackfillIngestion::class);
        $channelVideos = Mockery::mock(ChannelVideosDiscoveryIngestion::class);
        $quotaGuard = Mockery::mock(DirectYoutubeQuotaGuard::class);
        $dailyPreview = Mockery::mock(AiDailyPreview::class);
        $dailyIngestion = Mockery::mock(AiDailyIngestion::class);
        $hourlyPreview = Mockery::mock(AiHourlyPreview::class);
        $hourlyIngestion = Mockery::mock(AiHourlyIngestion::class);
        $hourly($hourlyIngestion);
        $quotaGuard->shouldReceive('publicState')->once()->with([])->andReturn([]);

        $hourlyPreview->shouldReceive('preview')->once()->andReturn([
            'date_from' => '2026-07-15 09:00:00',
            'date_to' => '2026-07-15 09:59:59',
        ]);
        $channelVideos->shouldReceive('execute')
            ->times(count(AiDailyPreview::channelAiUids()))
            ->andReturn($channelResult);
        $quotaGuard->shouldReceive('run')
            ->once()
            ->andReturnUsing(function (string $jobKey, string $effectiveCommand, Closure $callback): array {
                return [
                    'allowed' => true,
                    'guard' => [],
                    'payload' => $callback(),
                ];
            });

        return new AiScheduledPipelineIngestion(
            $tagBackfill,
            $channelVideos,
            $quotaGuard,
            $dailyPreview,
            $dailyIngestion,
            $hourlyPreview,
            $hourlyIngestion,
        );
    }
}
