<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\ChannelStatisticsIngestion;
use App\Services\Ingestion\ChannelStatisticsPreview;
use App\Services\Ingestion\LivePollingIngestion;
use App\Services\Ingestion\LivePollingPreview;
use App\Services\Ingestion\TvbsLivePollingIngestion;
use App\Services\Ingestion\TvbsLivePollingPreview;
use App\Services\Ingestion\VideoDurationsIngestion;
use App\Services\Ingestion\VideoDurationsPreview;
use App\Services\Ingestion\VideoStatisticsIngestion;
use App\Services\Ingestion\VideoStatisticsPreview;
use App\Services\Ingestion\YoutubeDataApiClient;
use App\Services\Ingestion\YoutubeQuotaWindowException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class IngestionQuotaResetRecoveryTest extends TestCase
{
    public function test_channel_statistics_returns_retriable_summary_without_writes(): void
    {
        $preview = Mockery::mock(ChannelStatisticsPreview::class);
        $preview->shouldReceive('preview')->once()->andReturn([
            'source' => 'test',
            'selected_rows' => 2,
            'rows' => [
                ['u_id' => 1, 'youtube_id' => 'UC-one'],
                ['u_id' => 2, 'youtube_id' => 'UC-two'],
            ],
        ]);
        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('channelStatistics')->once()->andThrow($this->resetException());

        $this->assertQuotaResetWithoutQueries(
            fn (): array => (new ChannelStatisticsIngestion($preview, $youtube))->execute(limit: 2),
            2,
            'Channel statistics polling paused at quota window reset.',
        );
    }

    public function test_live_polling_returns_retriable_summary_without_writes(): void
    {
        $preview = Mockery::mock(LivePollingPreview::class);
        $preview->shouldReceive('preview')->once()->andReturn($this->videoPreview());
        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('videoLiveStreamingDetails')->once()->andThrow($this->resetException());

        $this->assertQuotaResetWithoutQueries(
            fn (): array => (new LivePollingIngestion($preview, $youtube))->execute(limit: 2),
            2,
            'Live polling paused at quota window reset.',
        );
    }

    public function test_tvbs_live_polling_returns_retriable_summary_without_writes(): void
    {
        $preview = Mockery::mock(TvbsLivePollingPreview::class);
        $preview->shouldReceive('preview')->once()->andReturn($this->videoPreview());
        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('videoLiveStreamingDetails')->once()->andThrow($this->resetException());

        $this->assertQuotaResetWithoutQueries(
            fn (): array => (new TvbsLivePollingIngestion($preview, $youtube))->execute(limit: 2),
            2,
            'TVBS live polling paused at quota window reset.',
        );
    }

    public function test_video_statistics_returns_retriable_summary_without_writes(): void
    {
        $preview = Mockery::mock(VideoStatisticsPreview::class);
        $preview->shouldReceive('preview')->once()->andReturn($this->videoPreview());
        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('videoStatistics')->once()->andThrow($this->resetException());

        $this->assertQuotaResetWithoutQueries(
            fn (): array => (new VideoStatisticsIngestion($preview, $youtube))->execute(batchSize: 2),
            2,
            'Video statistics polling paused at quota window reset.',
        );
    }

    public function test_video_duration_returns_retriable_summary_without_writes(): void
    {
        $preview = Mockery::mock(VideoDurationsPreview::class);
        $preview->shouldReceive('preview')->once()->andReturn($this->videoPreview());
        $youtube = Mockery::mock(YoutubeDataApiClient::class);
        $youtube->shouldReceive('videoContentDetails')->once()->andThrow($this->resetException());

        $this->assertQuotaResetWithoutQueries(
            fn (): array => (new VideoDurationsIngestion($preview, $youtube))->execute(batchSize: 2),
            2,
            'Video duration polling paused at quota window reset.',
        );
    }

    /**
     * @param  callable(): array<string, mixed>  $execute
     */
    private function assertQuotaResetWithoutQueries(callable $execute, int $retryRows, string $logMessage): void
    {
        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = $query->sql;
        });
        Log::spy();

        $payload = $execute();

        $this->assertSame(1, $payload['exit_code']);
        $this->assertTrue($payload['quota_window_reset']);
        $this->assertSame($retryRows, $payload['remaining_retry_rows']);
        $this->assertSame($retryRows, $payload['failed_rows'] ?? $payload['failed_videos']);
        $this->assertSame([], $queries);
        $this->assertStringNotContainsString('token=super-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        Log::shouldHaveReceived('warning')->once()->withArgs(
            fn (string $message, array $context): bool => $message === $logMessage
                && $context['reason'] === 'quota_window_reset'
                && $context['selected_rows'] === $retryRows
                && $context['exception_class'] === YoutubeQuotaWindowException::class
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'token=super-secret'),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function videoPreview(): array
    {
        return [
            'selected_rows' => 2,
            'would_call_api' => true,
            'rows' => [
                ['video_id' => 'video-one'],
                ['video_id' => 'video-two'],
            ],
        ];
    }

    private function resetException(): YoutubeQuotaWindowException
    {
        return new YoutubeQuotaWindowException('token=super-secret');
    }
}
