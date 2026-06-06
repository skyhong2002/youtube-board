<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;

class IngestionTelemetry
{
    private ?string $currentJobKey = null;

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
        $this->currentJobKey = null;
        $this->youtubeRequests = [];
        $this->aiRequests = [];
    }

    public function startJob(string $jobKey): void
    {
        $this->currentJobKey = $jobKey;
        $this->clearJob($jobKey);
    }

    public function finishJob(string $jobKey): array
    {
        $snapshot = $this->snapshotForJob($jobKey);

        if ($this->currentJobKey === $jobKey) {
            $this->currentJobKey = null;
        }

        return $snapshot;
    }

    public function recordYoutubeRequest(array $event): void
    {
        $this->youtubeRequests[] = $this->withCommonFields($event);
    }

    public function recordAiRequest(array $event): void
    {
        $this->aiRequests[] = $this->withCommonFields($event);
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
            fn (array $event): bool => ($event['job_key'] ?? null) === $jobKey,
        ));
        $aiRequests = array_values(array_filter(
            $this->aiRequests,
            fn (array $event): bool => ($event['job_key'] ?? null) === $jobKey,
        ));

        return [
            'youtube_requests' => $youtubeRequests,
            'ai_requests' => $aiRequests,
            'summary' => $this->summaryFor($youtubeRequests, $aiRequests),
        ];
    }

    private function clearJob(string $jobKey): void
    {
        $this->youtubeRequests = array_values(array_filter(
            $this->youtubeRequests,
            fn (array $event): bool => ($event['job_key'] ?? null) !== $jobKey,
        ));
        $this->aiRequests = array_values(array_filter(
            $this->aiRequests,
            fn (array $event): bool => ($event['job_key'] ?? null) !== $jobKey,
        ));
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    private function withCommonFields(array $event): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));

        return [
            'job_key' => $this->currentJobKey,
            'recorded_at' => CarbonImmutable::now($timezone)->toDateTimeString().' '.$timezone,
        ] + $event;
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
