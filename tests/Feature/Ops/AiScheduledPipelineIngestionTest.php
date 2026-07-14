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
        $this->assertSame('success', $result['ai']['status']);
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
