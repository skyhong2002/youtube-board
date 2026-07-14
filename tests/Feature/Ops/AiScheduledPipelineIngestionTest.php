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
use Closure;
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

        $quotaGuard->shouldReceive('run')->once()->andReturn([
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
    private function dailyPreviewPipeline(array $sourcePayload): AiScheduledPipelineIngestion
    {
        $tagBackfill = Mockery::mock(TagVideoBackfillIngestion::class);
        $tagBackfill->shouldReceive('run')->once()->andReturn($sourcePayload);
        $channelVideos = Mockery::mock(ChannelVideosDiscoveryIngestion::class);
        $quotaGuard = Mockery::mock(DirectYoutubeQuotaGuard::class);
        $dailyPreview = Mockery::mock(AiDailyPreview::class);
        $dailyPreview->shouldReceive('preview')->once()->andReturn(['writes' => []]);
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
