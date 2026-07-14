<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Closure;

class YoutubeQuotaReservationContext
{
    /**
     * @var list<array{job_key: string, reservation: array<string, mixed>}>
     */
    private array $schedulerReservations = [];

    /**
     * @var list<array<string, mixed>>
     */
    private array $directGuardOutcomes = [];

    /**
     * @template T
     *
     * @param  array<string, mixed>  $reservation
     * @param  Closure(): T  $callback
     * @return T
     */
    public function withSchedulerReservation(string $jobKey, array $reservation, Closure $callback): mixed
    {
        $this->schedulerReservations[] = [
            'job_key' => $jobKey,
            'reservation' => $reservation,
        ];

        try {
            return $callback();
        } finally {
            array_pop($this->schedulerReservations);
        }
    }

    /**
     * @template T
     *
     * @param  array<string, mixed>  $reservation
     * @param  Closure(): T  $callback
     * @return T
     */
    public function withDirectReservation(string $jobKey, array $reservation, Closure $callback): mixed
    {
        return $this->withSchedulerReservation($jobKey, $reservation, $callback);
    }

    public function resetDirectGuardOutcomes(): void
    {
        $this->directGuardOutcomes = [];
    }

    /**
     * @param  array<string, mixed>  $outcome
     */
    public function recordDirectGuardOutcome(array $outcome): void
    {
        $this->directGuardOutcomes[] = $outcome;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function takeDirectGuardOutcomes(): array
    {
        $outcomes = $this->directGuardOutcomes;
        $this->directGuardOutcomes = [];

        return $outcomes;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function schedulerReservation(string $jobKey): ?array
    {
        $reservation = $this->schedulerReservations[array_key_last($this->schedulerReservations)] ?? null;

        if ($reservation === null || $reservation['job_key'] !== $jobKey) {
            return null;
        }

        return $reservation['reservation'];
    }

    public function assertRequestWithinQuotaWindow(int $timeoutSeconds): void
    {
        $active = $this->schedulerReservations[array_key_last($this->schedulerReservations)] ?? null;

        if ($active === null) {
            return;
        }

        $quotaDate = trim((string) ($active['reservation']['quota_date'] ?? ''));

        if ($quotaDate === '') {
            throw new YoutubeQuotaWindowException('youtube_quota_reservation_date_missing');
        }

        $now = CarbonImmutable::now('America/Los_Angeles');
        $latestSafeCompletion = $now->addSeconds(max(1, $timeoutSeconds));

        if ($now->toDateString() !== $quotaDate || $latestSafeCompletion->toDateString() !== $quotaDate) {
            throw new YoutubeQuotaWindowException('youtube_quota_window_reset_guard');
        }
    }
}
