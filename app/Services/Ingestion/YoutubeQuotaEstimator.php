<?php

namespace App\Services\Ingestion;

class YoutubeQuotaEstimator
{
    public function __construct(private readonly YoutubeApiCredentials $credentials) {}

    /**
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    public function estimateJob(array $job): array
    {
        $key = (string) ($job['key'] ?? '');
        $command = (string) ($job['effective_command'] ?? $job['command'] ?? '');
        $output = (string) ($job['output'] ?? '');
        $error = (string) ($job['error'] ?? '');
        $text = trim($output.' '.$error);
        $counters = $this->counters($text);

        if (! $this->isYoutubeDataApiJob($key)) {
            return $this->estimate(0, 'not a YouTube Data API job', null);
        }

        if (! (bool) ($job['executed'] ?? false) && ! (bool) ($job['failed'] ?? false)) {
            return $this->estimate(0, 'job did not execute', $this->methodForJob($key));
        }

        if (str_contains($text, 'YOUTUBE_API_KEY is not configured')) {
            return $this->estimate(0, 'no YouTube API request attempted because API key is missing', $this->methodForJob($key));
        }

        $telemetryRequests = data_get($job, 'telemetry.youtube_requests');
        $telemetryUnits = collect(is_array($telemetryRequests) ? $telemetryRequests : [])
            ->filter(fn (mixed $request): bool => is_array($request))
            ->sum(fn (array $request): int => max(0, (int) ($request['estimated_quota_units'] ?? 1)));

        if (is_array($telemetryRequests)) {
            return $this->estimate(
                $telemetryUnits,
                'exact request-attempt estimate from sanitized YouTube telemetry',
                $this->methodForJob($key),
            );
        }

        if ((bool) ($job['failed'] ?? false) && $counters === [] && $this->looksLikeQuotaOrApiFailure($text)) {
            return $this->estimate(1, 'failed before counters were emitted; estimated one attempted YouTube API request', $this->methodForJob($key));
        }

        return match (true) {
            $key === 'youtube.channels.stats' => $this->batchedListEstimate($counters, 'api_requested_rows', 'channels.list'),
            in_array($key, ['youtube.live.poll', 'youtube.tvbs.live.poll'], true) => $this->batchedListEstimate($counters, 'api_requested_videos', 'videos.list(liveStreamingDetails)'),
            in_array($key, ['youtube.videos.stats', 'youtube.videos.duration'], true) => $this->batchedListEstimate($counters, 'api_requested_videos', 'videos.list'),
            str_starts_with($key, 'youtube.channels.videos.') => $this->playlistDiscoveryEstimate($counters),
            $key === 'youtube.tvbs.videos' => $this->playlistDiscoveryEstimate($counters),
            $key === 'youtube.tag_videos.backfill' => $this->directCounterEstimate($counters, 'api_pages', 'playlistItems.list paginated pages'),
            $key === 'youtube.comments.fetch' => $this->commentFetchEstimate($counters, $command),
            default => $this->fallbackEstimate($job, $text),
        };
    }

    /**
     * Estimate the maximum request attempts allowed by a reviewed scheduled command.
     *
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    public function estimateScheduledJob(array $job, ?string $effectiveCommand = null): array
    {
        $key = (string) ($job['key'] ?? '');
        $command = trim($effectiveCommand ?? (string) ($job['scheduled_execute_command'] ?? $job['modern_command'] ?? ''));

        if (! $this->isYoutubeDataApiJob($key)) {
            return $this->estimate(0, 'not a YouTube Data API job', null);
        }

        $baseUnits = match (true) {
            $key === 'youtube.channels.stats' => (int) ceil($this->intOption($command, 'limit', 20) / 50),
            in_array($key, ['youtube.live.poll', 'youtube.tvbs.live.poll'], true) => (int) ceil($this->intOption($command, 'limit', 20) / 50),
            in_array($key, ['youtube.videos.stats', 'youtube.videos.duration'], true) => (int) ceil($this->intOption($command, 'limit', 50) / 50)
                * $this->intOption($command, 'loops', 1),
            str_starts_with($key, 'youtube.channels.videos.'), $key === 'youtube.tvbs.videos' => $this->intOption($command, 'limit', 20),
            $key === 'youtube.tag_videos.backfill' => $this->intOption($command, 'limit', 100) * $this->intOption($command, 'max-pages', 20),
            $key === 'youtube.comments.fetch' => $this->intOption($command, 'limit', 20)
                * ($this->intOption($command, 'max-pages', 1) + $this->intOption($command, 'max-reply-pages', 20)),
            default => 0,
        };
        $keyAttempts = $this->configuredKeyAttempts();
        $transientAttempts = $this->configuredTransientAttempts();
        $units = $baseUnits * $keyAttempts * $transientAttempts;

        return $this->estimate(
            $units,
            sprintf(
                'scheduled command upper bound: base_requests=%d, configured_key_attempts=%d, transient_attempts=%d',
                $baseUnits,
                $keyAttempts,
                $transientAttempts,
            ),
            $this->methodForJob($key),
        );
    }

    /**
     * @param  list<array<string, mixed>>  $jobs
     * @return array<string, mixed>
     */
    public function summarizeRun(array $jobs): array
    {
        $total = 0;
        $byJob = [];

        foreach ($jobs as $job) {
            $estimate = is_array($job['youtube_quota_estimate'] ?? null)
                ? $job['youtube_quota_estimate']
                : $this->estimateJob($job);
            $units = (int) ($estimate['estimated_units'] ?? 0);
            $key = (string) ($job['key'] ?? 'unknown');
            $total += $units;

            if ($units > 0) {
                $byJob[$key] = ($byJob[$key] ?? 0) + $units;
            }
        }

        return [
            'estimated_units' => $total,
            'by_job' => collect($byJob)
                ->map(fn (int $units, string $key): array => ['job' => $key, 'units' => $units])
                ->values()
                ->all(),
            'basis' => 'local scheduler run history estimates from executed job output',
        ];
    }

    /**
     * @return array<string, int>
     */
    private function counters(string $text): array
    {
        preg_match_all('/\b([A-Za-z_][A-Za-z0-9_]*)=(\d+)\b/', $text, $matches, PREG_SET_ORDER);

        return collect($matches)
            ->mapWithKeys(fn (array $match): array => [(string) $match[1] => (int) $match[2]])
            ->all();
    }

    /**
     * @param  array<string, int>  $counters
     */
    private function batchedListEstimate(array $counters, string $counter, string $method): array
    {
        $requested = (int) ($counters[$counter] ?? 0);
        $units = $requested > 0 ? (int) ceil($requested / 50) : 0;

        return $this->estimate(
            $units,
            $requested > 0
                ? "{$method}: {$counter}={$requested}, batched up to 50 resources per request"
                : "{$method}: no requested resources in command output",
            $method,
        );
    }

    /**
     * @param  array<string, int>  $counters
     */
    private function playlistDiscoveryEstimate(array $counters): array
    {
        $requested = (int) ($counters['api_requested_channels'] ?? 0);
        $skipped = (int) ($counters['skipped_channels'] ?? 0);
        $units = $requested + $skipped;

        return $this->estimate(
            $units,
            $units > 0
                ? "playlistItems.list: api_requested_channels={$requested}, skipped_channels={$skipped}; estimate one playlist request per attempted channel"
                : 'playlistItems.list: no attempted channels in command output',
            'playlistItems.list',
        );
    }

    /**
     * @param  array<string, int>  $counters
     */
    private function directCounterEstimate(array $counters, string $counter, string $method): array
    {
        $units = (int) ($counters[$counter] ?? 0);

        return $this->estimate(
            $units,
            $units > 0 ? "{$method}: {$counter}={$units}" : "{$method}: no {$counter} in command output",
            $method,
        );
    }

    /**
     * @param  array<string, int>  $counters
     */
    private function commentFetchEstimate(array $counters, string $command): array
    {
        $videos = (int) ($counters['api_called_videos'] ?? 0);
        $maxPages = $this->intOption($command, 'max-pages', 1);
        $units = $videos * $maxPages;

        return $this->estimate(
            $units,
            $units > 0
                ? "commentThreads.list: api_called_videos={$videos}, max-pages={$maxPages}; actual pages are not emitted, so this is an upper-bound estimate"
                : 'commentThreads.list: no API-called videos in command output',
            'commentThreads.list',
        );
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function fallbackEstimate(array $job, string $text): array
    {
        if ((bool) ($job['failed'] ?? false) && $this->looksLikeQuotaOrApiFailure($text)) {
            return $this->estimate(1, 'failed before counters were emitted; estimated one attempted YouTube API request', $this->methodForJob((string) ($job['key'] ?? '')));
        }

        return $this->estimate(0, 'no YouTube quota counters found in command output', $this->methodForJob((string) ($job['key'] ?? '')));
    }

    private function intOption(string $command, string $option, int $default): int
    {
        if (preg_match('/--'.preg_quote($option, '/').'(?:=|\s+)(\d+)/', $command, $matches)) {
            return max(1, (int) $matches[1]);
        }

        return $default;
    }

    private function configuredKeyAttempts(): int
    {
        return max(1, count($this->credentials->keys()));
    }

    private function configuredTransientAttempts(): int
    {
        $retries = max(0, min(3, (int) config('services.youtube.transient_retries', 1)));

        return $retries + 1;
    }

    private function isYoutubeDataApiJob(string $key): bool
    {
        return in_array($key, [
            'youtube.channels.stats',
            'youtube.live.poll',
            'youtube.tvbs.live.poll',
            'youtube.channels.videos.live_group',
            'youtube.channels.videos.live',
            'youtube.channels.videos.general',
            'youtube.tvbs.videos',
            'youtube.tag_videos.backfill',
            'youtube.videos.stats',
            'youtube.videos.duration',
            'youtube.comments.fetch',
        ], true);
    }

    private function methodForJob(string $key): ?string
    {
        return match (true) {
            $key === 'youtube.channels.stats' => 'channels.list',
            in_array($key, ['youtube.live.poll', 'youtube.tvbs.live.poll'], true) => 'videos.list(liveStreamingDetails)',
            str_starts_with($key, 'youtube.channels.videos.') || $key === 'youtube.tvbs.videos' || $key === 'youtube.tag_videos.backfill' => 'playlistItems.list',
            in_array($key, ['youtube.videos.stats', 'youtube.videos.duration'], true) => 'videos.list',
            $key === 'youtube.comments.fetch' => 'commentThreads.list',
            default => null,
        };
    }

    private function looksLikeQuotaOrApiFailure(string $text): bool
    {
        $text = strtolower($text);

        return str_contains($text, 'youtube api')
            || str_contains($text, 'quota')
            || str_contains($text, 'rate');
    }

    /**
     * @return array<string, mixed>
     */
    private function estimate(int $units, string $basis, ?string $method): array
    {
        return [
            'api' => 'youtube_data_api_v3',
            'estimated_units' => max(0, $units),
            'method' => $method,
            'basis' => $basis,
        ];
    }
}
