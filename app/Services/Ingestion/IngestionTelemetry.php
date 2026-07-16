<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;

class IngestionTelemetry
{
    /**
     * @var list<array{job_key: string, youtube_start: int, ai_start: int}>
     */
    private array $jobStack = [];

    /**
     * @var list<array<string, mixed>>
     */
    private array $youtubeRequests = [];

    /**
     * @var list<array<string, mixed>>
     */
    private array $aiRequests = [];

    public function reset(): void
    {
        $this->jobStack = [];
        $this->youtubeRequests = [];
        $this->aiRequests = [];
    }

    public function startJob(string $jobKey): void
    {
        $this->jobStack[] = [
            'job_key' => $jobKey,
            'youtube_start' => count($this->youtubeRequests),
            'ai_start' => count($this->aiRequests),
        ];
    }

    public function finishJob(string $jobKey): array
    {
        $frame = $this->currentJobFrame();

        if ($frame === null || $frame['job_key'] !== $jobKey) {
            return $this->snapshotForJob($jobKey);
        }

        array_pop($this->jobStack);

        return $this->snapshotForFrame($frame);
    }

    public function recordYoutubeRequest(array $event): void
    {
        $this->youtubeRequests[] = $this->withCommonFields($event);
    }

    public function recordAiRequest(array $event): void
    {
        $this->aiRequests[] = $this->withCommonFields($event);
    }

    public function aiRequestCount(): int
    {
        return count($this->aiRequests);
    }

    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        return [
            'youtube_requests' => $this->youtubeRequests,
            'ai_requests' => $this->aiRequests,
            'summary' => $this->summaryFor($this->youtubeRequests, $this->aiRequests),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return $this->summaryFor($this->youtubeRequests, $this->aiRequests);
    }

    /**
     * @return array<string, mixed>
     */
    public function snapshotForJob(string $jobKey): array
    {
        $youtubeRequests = array_values(array_filter(
            $this->youtubeRequests,
            fn (array $event): bool => $this->belongsToJob($event, $jobKey),
        ));
        $aiRequests = array_values(array_filter(
            $this->aiRequests,
            fn (array $event): bool => $this->belongsToJob($event, $jobKey),
        ));

        return $this->snapshotFor($youtubeRequests, $aiRequests);
    }

    /**
     * @param  array{job_key: string, youtube_start: int, ai_start: int}  $frame
     * @return array<string, mixed>
     */
    private function snapshotForFrame(array $frame): array
    {
        $youtubeRequests = array_values(array_filter(
            array_slice($this->youtubeRequests, $frame['youtube_start']),
            fn (array $event): bool => $this->belongsToJob($event, $frame['job_key']),
        ));
        $aiRequests = array_values(array_filter(
            array_slice($this->aiRequests, $frame['ai_start']),
            fn (array $event): bool => $this->belongsToJob($event, $frame['job_key']),
        ));

        return $this->snapshotFor($youtubeRequests, $aiRequests);
    }

    /**
     * @param  list<array<string, mixed>>  $youtubeRequests
     * @param  list<array<string, mixed>>  $aiRequests
     * @return array<string, mixed>
     */
    private function snapshotFor(array $youtubeRequests, array $aiRequests): array
    {
        return [
            'youtube_requests' => $youtubeRequests,
            'ai_requests' => $aiRequests,
            'summary' => $this->summaryFor($youtubeRequests, $aiRequests),
        ];
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function withCommonFields(array $event): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));

        return [
            'job_key' => $this->currentJobKey(),
            'job_path' => array_column($this->jobStack, 'job_key'),
            'recorded_at' => CarbonImmutable::now($timezone)->toDateTimeString().' '.$timezone,
        ] + $event;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function belongsToJob(array $event, string $jobKey): bool
    {
        if (($event['job_key'] ?? null) === $jobKey) {
            return true;
        }

        return is_array($event['job_path'] ?? null)
            && in_array($jobKey, $event['job_path'], true);
    }

    private function currentJobKey(): ?string
    {
        return $this->currentJobFrame()['job_key'] ?? null;
    }

    /**
     * @return array{job_key: string, youtube_start: int, ai_start: int}|null
     */
    private function currentJobFrame(): ?array
    {
        return $this->jobStack === [] ? null : $this->jobStack[array_key_last($this->jobStack)];
    }

    /**
     * @param  list<array<string, mixed>>  $youtubeRequests
     * @param  list<array<string, mixed>>  $aiRequests
     * @return array<string, mixed>
     */
    private function summaryFor(array $youtubeRequests, array $aiRequests): array
    {
        return [
            'youtube_requests' => count($youtubeRequests),
            'youtube_failed_requests' => collect($youtubeRequests)
                ->filter(fn (array $event): bool => ($event['ok'] ?? true) !== true)
                ->count(),
            'youtube_runtime_ms' => array_sum(array_map(
                fn (array $event): int => max(0, (int) ($event['latency_ms'] ?? 0)),
                $youtubeRequests,
            )),
            'ai_requests' => count($aiRequests),
            'ai_failed_requests' => collect($aiRequests)
                ->filter(fn (array $event): bool => ($event['ok'] ?? true) !== true)
                ->count(),
            'ai_runtime_ms' => array_sum(array_map(
                fn (array $event): int => max(0, (int) ($event['latency_ms'] ?? 0)),
                $aiRequests,
            )),
        ];
    }
}
