<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class DirectYoutubeQuotaGuard
{
    public function __construct(
        private readonly YoutubeQuotaBudgetLedger $ledger,
        private readonly YoutubeQuotaEstimator $estimator,
        private readonly IngestionTelemetry $telemetry,
        private readonly YoutubeQuotaReservationContext $context,
        private readonly YoutubeApiCredentials $credentials,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function begin(string $jobKey, string $effectiveCommand): array
    {
        if (! $this->credentials->configured()) {
            return [
                'allowed' => false,
                'accounting_owner' => 'direct_command',
                'reservation_active' => false,
                'available' => false,
                'reason' => 'youtube_api_key_not_configured',
                'planned_units' => 0,
                'budget_units' => max(0, (int) config('ingestion.youtube_daily_quota_budget', 0)),
                'quota_date' => CarbonImmutable::now('America/Los_Angeles')->toDateString(),
                'window_timezone' => 'America/Los_Angeles',
                'remaining_units' => 0,
            ];
        }

        $schedulerReservation = $this->context->schedulerReservation($jobKey);

        if ($schedulerReservation !== null) {
            return [
                'allowed' => true,
                'accounting_owner' => 'scheduler',
                'reservation_active' => true,
                'planned_units' => max(0, (int) ($schedulerReservation['planned_units'] ?? 0)),
                'budget_units' => max(0, (int) ($schedulerReservation['budget_units'] ?? 0)),
                'quota_date' => $schedulerReservation['quota_date'] ?? null,
                'window_timezone' => 'America/Los_Angeles',
                'ledger_source' => $schedulerReservation['ledger_source'] ?? null,
            ];
        }

        $estimate = $this->estimator->estimateScheduledJob([
            'key' => $jobKey,
        ], $effectiveCommand);
        $plannedUnits = max(0, (int) ($estimate['estimated_units'] ?? 0));
        $configuredBudget = config('ingestion.youtube_daily_quota_budget');
        $quotaAt = CarbonImmutable::now('America/Los_Angeles');
        $lockSeconds = max(60, min(86400, (int) config('ingestion.job_lock_seconds', 14400)));
        $lockName = 'ingestion:job:'.sha1($jobKey);
        $lock = Cache::lock($lockName, $lockSeconds);

        if (! $lock->get()) {
            return [
                'allowed' => false,
                'accounting_owner' => 'direct_command',
                'reservation_active' => false,
                'available' => false,
                'reason' => 'command_locked',
                'planned_units' => $plannedUnits,
                'budget_units' => max(0, (int) $configuredBudget),
                'quota_date' => $quotaAt->toDateString(),
                'window_timezone' => 'America/Los_Angeles',
                'remaining_units' => 0,
                'lock' => [
                    'name' => $lockName,
                    'ttl_seconds' => $lockSeconds,
                    'acquired' => false,
                ],
            ];
        }

        if (! is_numeric($configuredBudget) || (int) $configuredBudget <= 0) {
            $this->releaseDirectLock($lock);

            return [
                'allowed' => false,
                'accounting_owner' => 'direct_command',
                'reservation_active' => false,
                'available' => false,
                'reason' => 'quota_budget_not_configured',
                'planned_units' => $plannedUnits,
                'budget_units' => 0,
                'quota_date' => $quotaAt->toDateString(),
                'window_timezone' => 'America/Los_Angeles',
                'remaining_units' => 0,
                'estimate' => $estimate,
                'lock' => [
                    'name' => $lockName,
                    'ttl_seconds' => $lockSeconds,
                    'acquired' => false,
                    'released_after_denial' => true,
                ],
            ];
        }

        $budget = (int) $configuredBudget;
        $reservation = $this->ledger->reserve($plannedUnits, $budget, $quotaAt);
        $state = is_array($reservation['state'] ?? null) ? $reservation['state'] : [];
        $allowed = (bool) ($reservation['allowed'] ?? false);

        $guard = [
            'allowed' => $allowed,
            'accounting_owner' => 'direct_command',
            'reservation_active' => $allowed,
            'reason' => $reservation['reason'] ?? null,
            'planned_units' => $plannedUnits,
            'budget_units' => $budget,
            'estimate' => $estimate,
            ...$state,
            '_job_key' => $jobKey,
            '_quota_at' => $quotaAt,
            '_direct_lock' => $allowed ? $lock : null,
            'lock' => [
                'name' => $lockName,
                'ttl_seconds' => $lockSeconds,
                'acquired' => $allowed,
                'released_after_denial' => ! $allowed,
            ],
        ];

        if ($allowed) {
            $this->telemetry->startJob($jobKey);
        } else {
            $this->releaseDirectLock($lock);
        }

        return $guard;
    }

    /**
     * @template T of array<string, mixed>
     *
     * @param  Closure(): T  $callback
     * @return array{allowed: bool, guard: array<string, mixed>, payload: T|null}
     */
    public function run(string $jobKey, string $effectiveCommand, Closure $callback): array
    {
        $startedNs = hrtime(true);
        $guard = $this->begin($jobKey, $effectiveCommand);

        if (! (bool) ($guard['allowed'] ?? false)) {
            Log::warning('Direct YouTube ingestion execution blocked.', $this->logContext(
                jobKey: $jobKey,
                guard: $guard,
                status: 'blocked',
                exitCode: 1,
                runtimeMs: $this->runtimeMs($startedNs),
            ));

            return ['allowed' => false, 'guard' => $guard, 'payload' => null];
        }

        try {
            $payload = ($guard['accounting_owner'] ?? null) === 'direct_command'
                ? $this->context->withDirectReservation($jobKey, $guard, $callback)
                : $callback();
        } catch (Throwable $exception) {
            Log::warning('Direct YouTube ingestion execution failed.', $this->logContext(
                jobKey: $jobKey,
                guard: $guard,
                status: 'failed_exception',
                exitCode: 1,
                runtimeMs: $this->runtimeMs($startedNs),
            ) + [
                'exception_class' => $exception::class,
            ]);

            throw $exception;
        } finally {
            $guard = $this->finish($guard);
        }

        $payload['youtube_quota_budget'] = $this->publicState($guard);

        if ((bool) ($guard['accounting_failed'] ?? false)) {
            $payload['quota_accounting_failed'] = true;
            $payload['exit_code'] = 1;
        }

        $exitCode = (int) ($payload['exit_code'] ?? 0);
        $status = (bool) ($guard['accounting_failed'] ?? false)
            ? 'failed_accounting'
            : ($exitCode === 0 ? 'completed' : 'failed');
        $logContext = $this->logContext(
            jobKey: $jobKey,
            guard: $guard,
            status: $status,
            exitCode: $exitCode,
            runtimeMs: $this->runtimeMs($startedNs),
        );

        if ($exitCode === 0) {
            Log::info('Direct YouTube ingestion execution completed.', $logContext);
        } else {
            Log::warning('Direct YouTube ingestion execution completed.', $logContext);
        }

        return ['allowed' => true, 'guard' => $guard, 'payload' => $payload];
    }

    /**
     * @param  array<string, mixed>  $guard
     * @return array<string, int|string|null>
     */
    private function logContext(
        string $jobKey,
        array $guard,
        string $status,
        int $exitCode,
        int $runtimeMs,
    ): array {
        return [
            'job_key' => $jobKey,
            'status' => $status,
            'reason' => is_string($guard['reason'] ?? null) ? $guard['reason'] : null,
            'accounting_owner' => is_string($guard['accounting_owner'] ?? null) ? $guard['accounting_owner'] : null,
            'exit_code' => $exitCode,
            'planned_units' => max(0, (int) ($guard['planned_units'] ?? 0)),
            'actual_units' => max(0, (int) ($guard['actual_units'] ?? 0)),
            'request_attempts' => max(0, (int) ($guard['request_attempts'] ?? 0)),
            'quota_date' => is_string($guard['quota_date'] ?? null) ? $guard['quota_date'] : null,
            'runtime_ms' => $runtimeMs,
        ];
    }

    private function runtimeMs(int $startedNs): int
    {
        return (int) round((hrtime(true) - $startedNs) / 1_000_000);
    }

    /**
     * @param  array<string, mixed>  $guard
     */
    public function blockedMessage(array $guard): string
    {
        return match ($guard['reason'] ?? null) {
            'youtube_api_key_not_configured' => 'YOUTUBE_API_KEY is not configured.',
            'quota_budget_exceeded' => 'youtube_quota_budget_exceeded',
            'command_locked' => 'command_locked',
            default => 'youtube_quota_accounting_unavailable',
        };
    }

    /**
     * @param  array<string, mixed>  $guard
     * @return array<string, mixed>
     */
    public function blockedPayload(array $guard): array
    {
        return [
            'mode' => 'execute',
            'available' => false,
            'blocked_reason' => $this->blockedMessage($guard),
            'writes' => 0,
            'youtube_quota_budget' => $this->publicState($guard),
            'secrets' => 'not_printed',
            'exit_code' => 1,
        ];
    }

    /**
     * Settle a direct reservation to every recorded request attempt. A process crash
     * cannot reach this method, so its worst-case reservation remains fail-safe.
     *
     * @param  array<string, mixed>  $guard
     * @return array<string, mixed>
     */
    public function finish(array $guard): array
    {
        if (($guard['accounting_owner'] ?? null) !== 'direct_command') {
            return $guard;
        }

        try {
            if (! (bool) ($guard['reservation_active'] ?? false)) {
                return $guard;
            }

            $jobKey = (string) ($guard['_job_key'] ?? '');
            $telemetry = $this->telemetry->finishJob($jobKey);
            $requests = collect($telemetry['youtube_requests'] ?? [])
                ->filter(fn (mixed $request): bool => is_array($request));
            $actualUnits = $requests->sum(
                fn (array $request): int => max(0, (int) ($request['estimated_quota_units'] ?? 1)),
            );
            $quotaAt = $guard['_quota_at'] ?? null;
            $settled = $this->ledger->settle(
                plannedUnits: max(0, (int) ($guard['planned_units'] ?? 0)),
                actualUnits: $actualUnits,
                budget: max(0, (int) ($guard['budget_units'] ?? 0)),
                at: $quotaAt instanceof CarbonInterface ? $quotaAt : null,
            );
            $available = (bool) ($settled['available'] ?? false);

            return [
                ...$guard,
                ...$settled,
                'reservation_active' => ! $available,
                'actual_units' => $actualUnits,
                'request_attempts' => $requests->count(),
                'accounting_failed' => ! $available,
                'settlement_reason' => $available ? null : ($settled['reason'] ?? 'quota_ledger_settlement_failed'),
                'telemetry_summary' => $telemetry['summary'] ?? [],
                'lock' => [
                    ...(is_array($guard['lock'] ?? null) ? $guard['lock'] : []),
                    'acquired' => false,
                    'released' => true,
                ],
            ];
        } finally {
            $this->releaseDirectLock($guard['_direct_lock'] ?? null);
        }
    }

    /**
     * @param  array<string, mixed>  $guard
     * @return array<string, mixed>
     */
    public function publicState(array $guard): array
    {
        return collect($guard)
            ->reject(fn (mixed $value, string $key): bool => str_starts_with($key, '_'))
            ->except(['estimate'])
            ->all();
    }

    public function sanitizedMessage(Throwable $exception): string
    {
        return SensitiveTextRedactor::exception($exception, 500);
    }

    private function releaseDirectLock(mixed $lock): void
    {
        if (! is_object($lock) || ! method_exists($lock, 'release')) {
            return;
        }

        try {
            $lock->release();
        } catch (Throwable) {
            // Expired locks must not hide quota settlement or command results.
        }
    }
}
