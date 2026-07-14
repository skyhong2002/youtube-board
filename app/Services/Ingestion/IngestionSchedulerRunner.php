<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class IngestionSchedulerRunner
{
    public function __construct(
        private readonly IngestionJobRegistry $registry,
        private readonly YoutubeQuotaEstimator $quotaEstimator,
        private readonly IngestionTelemetry $telemetry,
        private readonly YoutubeQuotaBudgetLedger $quotaLedger,
        private readonly YoutubeQuotaReservationContext $quotaContext,
        private readonly IngestionCommandLockContext $commandLockContext,
    ) {}

    /**
     * @var array<string, mixed>
     */
    private array $youtubeQuotaBudget = [];

    private ?CarbonImmutable $quotaAt = null;

    /**
     * @return array{
     *     at: string,
     *     mode: string,
     *     scheduler_enabled: bool,
     *     jobs: list<array<string, mixed>>,
     *     summary: array{evaluated: int, due: int, executed: int, skipped: int, failed: int},
     *     youtube_quota_estimate: array<string, mixed>
     * }
     */
    public function run(CarbonInterface $at, bool $execute = false, ?string $jobKey = null, bool $showAll = false): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $startedAt = CarbonImmutable::now($timezone);
        $startedNs = hrtime(true);
        $this->telemetry->reset();
        $this->quotaContext->resetDirectGuardOutcomes();
        $jobs = $jobKey === null
            ? $this->registry->jobs()
            : collect($this->registry->find($jobKey) ? [$this->registry->find($jobKey)] : []);

        $schedulerEnabled = (bool) config('ingestion.scheduler_enabled', false);
        $this->quotaAt = CarbonImmutable::now('America/Los_Angeles');
        $this->youtubeQuotaBudget = $this->quotaBudgetState($execute);
        $results = [];
        $summary = [
            'evaluated' => 0,
            'due' => 0,
            'executed' => 0,
            'skipped' => 0,
            'failed' => 0,
        ];

        foreach ($jobs as $job) {
            $summary['evaluated']++;
            $due = $this->registry->isDue($job, $at);

            if ($due) {
                $summary['due']++;
            }

            if (! $showAll && ! $due && $jobKey === null) {
                continue;
            }

            $result = $this->evaluateJob($job, $due, $schedulerEnabled, $execute);

            if ($result['failed']) {
                $summary['failed']++;
            } elseif ($result['executed']) {
                $summary['executed']++;
            } else {
                $summary['skipped']++;
            }

            $results[] = $result;
        }

        if ($jobKey !== null && $results === []) {
            $summary['skipped']++;
            $results[] = $this->withQuotaEstimate([
                'key' => $jobKey,
                'status' => 'missing',
                'command' => '',
                'schedule' => '',
                'due' => false,
                'action' => 'skip:job-missing',
                'executed' => false,
                'failed' => false,
                'exit_code' => null,
            ]);
        }

        $finishedAt = CarbonImmutable::now($timezone);

        return [
            'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
            'mode' => $execute ? 'execute' : 'dry-run',
            'scheduler_enabled' => $schedulerEnabled,
            'started_at' => $startedAt->toDateTimeString().' '.$startedAt->getTimezone()->getName(),
            'finished_at' => $finishedAt->toDateTimeString().' '.$finishedAt->getTimezone()->getName(),
            'runtime_ms' => $this->elapsedMs($startedNs),
            'jobs' => $results,
            'summary' => $summary,
            'youtube_quota_estimate' => $this->quotaEstimator->summarizeRun($results),
            'youtube_quota_budget' => $this->youtubeQuotaBudget,
            'telemetry' => $this->telemetry->summary(),
        ];
    }

    /**
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    private function evaluateJob(array $job, bool $due, bool $schedulerEnabled, bool $execute): array
    {
        $command = (string) ($job['modern_command'] ?? '');
        $status = (string) ($job['status'] ?? 'planned');
        $base = [
            'key' => (string) ($job['key'] ?? ''),
            'status' => $status,
            'command' => $command,
            'effective_command' => $command,
            'schedule' => (string) ($job['schedule'] ?? ''),
            'due' => $due,
            'executed' => false,
            'failed' => false,
            'exit_code' => null,
        ];

        if (! $due) {
            return $this->withQuotaEstimate(array_merge($base, ['action' => 'skip:not-due']));
        }

        if (! $schedulerEnabled) {
            return $this->withQuotaEstimate(array_merge($base, ['action' => 'skip:scheduler-disabled']));
        }

        if ($status !== 'active') {
            return $this->withQuotaEstimate(array_merge($base, ['action' => 'skip:status-'.$status]));
        }

        if (! $this->registry->commandExists($job)) {
            return $this->withQuotaEstimate(array_merge($base, ['action' => 'skip:command-missing']));
        }

        $scheduledWrite = $this->registry->scheduledWriteProfile($job);
        $executionProfile = $this->registry->executionProfile($job);

        if (! $executionProfile['can_execute_when_due'] && ! ($execute && $scheduledWrite['allowed'])) {
            return $this->withQuotaEstimate(array_merge($base, [
                'action' => 'skip:controlled-execution-guardrail',
                'scheduled_write' => $scheduledWrite,
                'execution' => $executionProfile,
            ]));
        }

        if (! $execute) {
            return $this->withQuotaEstimate(array_merge($base, ['action' => 'would-run']));
        }

        $effectiveCommand = $scheduledWrite['allowed']
            ? $this->registry->scheduledExecutionCommand($job)
            : $command;
        $lockName = 'ingestion:job:'.sha1((string) $base['key']);
        $lockSeconds = max(60, min(86400, (int) config('ingestion.job_lock_seconds', 14400)));
        $lock = null;
        $lockAcquired = false;
        $quotaPreflight = null;
        $directGuardOutcomes = [];

        try {
            $lock = IngestionLockStore::lock($lockName, $lockSeconds);
            $lockAcquired = $lock->get();

            if (! $lockAcquired) {
                return $this->withQuotaEstimate(array_merge($base, [
                    'action' => 'skip:job-locked',
                    'effective_command' => $effectiveCommand,
                    'skip_reason' => 'another runner currently holds the per-job execution lock',
                    'lock' => [
                        'name' => $lockName,
                        'ttl_seconds' => $lockSeconds,
                        'acquired' => false,
                    ],
                    'scheduled_write' => $scheduledWrite,
                ]));
            }

            $quotaPreflight = $this->quotaPreflight($job, $effectiveCommand);

            if (! $quotaPreflight['allowed']) {
                $operationalFailure = (bool) ($quotaPreflight['operational_failure'] ?? false);

                return $this->withQuotaEstimate(array_merge($base, [
                    'action' => $quotaPreflight['action'],
                    'failed' => $operationalFailure,
                    'exit_code' => $operationalFailure ? 1 : null,
                    'effective_command' => $effectiveCommand,
                    'skip_reason' => $quotaPreflight['skip_reason'],
                    'lock' => [
                        'name' => $lockName,
                        'ttl_seconds' => $lockSeconds,
                        'acquired' => true,
                    ],
                    'youtube_quota_budget' => $quotaPreflight,
                    'scheduled_write' => $scheduledWrite,
                ]));
            }

            $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
            $startedAt = CarbonImmutable::now($timezone);
            $startedNs = hrtime(true);
            $this->telemetry->startJob((string) $base['key']);
            $callCommand = fn (): int => $this->commandLockContext->withOwnership(
                (string) $base['key'],
                fn (): int => Artisan::call($effectiveCommand),
            );
            $exitCode = (bool) ($quotaPreflight['reservation_active'] ?? false)
                ? $this->quotaContext->withSchedulerReservation(
                    (string) $base['key'],
                    $quotaPreflight,
                    $callCommand,
                )
                : $callCommand();
            $directGuardOutcomes = $this->quotaContext->takeDirectGuardOutcomes();
            $output = trim(Artisan::output());
            $finishedAt = CarbonImmutable::now($timezone);
            $jobTelemetry = $this->telemetry->finishJob((string) $base['key']);

            $result = $this->withQuotaEstimate(array_merge($base, [
                'action' => $exitCode === 0
                    ? ($effectiveCommand !== $command ? 'executed:local-polling' : 'executed')
                    : 'failed',
                'executed' => $exitCode === 0,
                'failed' => $exitCode !== 0,
                'exit_code' => $exitCode,
                'started_at' => $startedAt->toDateTimeString().' '.$startedAt->getTimezone()->getName(),
                'finished_at' => $finishedAt->toDateTimeString().' '.$finishedAt->getTimezone()->getName(),
                'runtime_ms' => $this->elapsedMs($startedNs),
                'effective_command' => $effectiveCommand,
                'output' => $this->sanitizedMessage($output, 2000),
                'lock' => [
                    'name' => $lockName,
                    'ttl_seconds' => $lockSeconds,
                    'acquired' => true,
                ],
                'youtube_quota_budget' => $quotaPreflight,
                'scheduled_write' => $scheduledWrite,
                'telemetry' => $jobTelemetry,
            ]));

            return $this->settleQuota($result, $quotaPreflight, $directGuardOutcomes);
        } catch (Throwable $exception) {
            $directGuardOutcomes = [
                ...$directGuardOutcomes,
                ...$this->quotaContext->takeDirectGuardOutcomes(),
            ];
            $finishedAt = isset($timezone)
                ? CarbonImmutable::now($timezone)
                : CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei')));
            $jobTelemetry = isset($startedAt)
                ? $this->telemetry->finishJob((string) $base['key'])
                : ['youtube_requests' => [], 'ai_requests' => [], 'summary' => []];

            $result = $this->withQuotaEstimate(array_merge($base, [
                'action' => 'failed:exception',
                'failed' => true,
                'started_at' => isset($startedAt) ? $startedAt->toDateTimeString().' '.$startedAt->getTimezone()->getName() : null,
                'finished_at' => $finishedAt->toDateTimeString().' '.$finishedAt->getTimezone()->getName(),
                'runtime_ms' => isset($startedNs) ? $this->elapsedMs($startedNs) : null,
                'error' => $this->sanitizedMessage($exception->getMessage(), 1000),
                'lock' => [
                    'name' => $lockName,
                    'ttl_seconds' => $lockSeconds,
                    'acquired' => $lockAcquired,
                ],
                'youtube_quota_budget' => $quotaPreflight,
                'telemetry' => $jobTelemetry,
            ]));

            return $this->settleQuota($result, $quotaPreflight, $directGuardOutcomes);
        } finally {
            if ($lockAcquired && $lock !== null) {
                try {
                    $lock->release();
                } catch (Throwable) {
                    // An expired lock must not hide the completed job result.
                }
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function quotaBudgetState(bool $execute): array
    {
        $budget = max(0, (int) config('ingestion.youtube_daily_quota_budget', 9000));
        $state = [
            'enabled' => $execute,
            'available' => true,
            'budget_units' => $budget,
            'history_estimated_units' => 0,
            'reserved_units' => 0,
            'projected_units' => 0,
            'remaining_units' => $budget,
            'window_timezone' => 'America/Los_Angeles',
        ];

        if (! $execute) {
            return $state;
        }

        return ['enabled' => true] + $this->quotaLedger->state($budget, $this->quotaAt);
    }

    /**
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    private function quotaPreflight(array $job, string $effectiveCommand): array
    {
        $estimate = $this->quotaEstimator->estimateScheduledJob($job, $effectiveCommand);
        $plannedUnits = max(0, (int) ($estimate['estimated_units'] ?? 0));
        $enabled = (bool) ($this->youtubeQuotaBudget['enabled'] ?? false);
        $available = (bool) ($this->youtubeQuotaBudget['available'] ?? true);
        $budget = max(0, (int) ($this->youtubeQuotaBudget['budget_units'] ?? 0));
        $current = max(0, (int) ($this->youtubeQuotaBudget['projected_units'] ?? 0));
        $projected = $current + $plannedUnits;

        if ($plannedUnits === 0 || ! $enabled) {
            return [
                'allowed' => true,
                'action' => 'allow',
                'skip_reason' => null,
                'planned_units' => $plannedUnits,
                'projected_units' => $projected,
                'budget_units' => $budget,
                'remaining_units' => max(0, $budget - $projected),
                'estimate' => $estimate,
            ];
        }

        if (! $available) {
            return [
                'allowed' => false,
                'action' => 'failed:youtube-quota-ledger-unavailable',
                'skip_reason' => 'durable YouTube quota ledger is unavailable; scheduled API job was not started',
                'operational_failure' => true,
                'planned_units' => $plannedUnits,
                'projected_units' => $projected,
                'budget_units' => $budget,
                'remaining_units' => max(0, $budget - $current),
                'reason' => $this->youtubeQuotaBudget['reason'] ?? 'quota_ledger_unavailable',
                'estimate' => $estimate,
            ];
        }

        $reservation = $this->quotaLedger->reserve($plannedUnits, $budget, $this->quotaAt);
        $reservedState = $reservation['state'];
        $this->youtubeQuotaBudget = ['enabled' => true] + $reservedState;
        $allowed = (bool) $reservation['allowed'];
        $budgetExceeded = $reservation['reason'] === 'quota_budget_exceeded';

        return [
            'allowed' => $allowed,
            'action' => $allowed
                ? 'allow'
                : ($budgetExceeded ? 'skip:youtube-quota-budget' : 'failed:youtube-quota-ledger-unavailable'),
            'skip_reason' => $allowed
                ? null
                : ($budgetExceeded
                    ? 'scheduled YouTube request upper bound would exceed the configured daily budget'
                    : 'durable YouTube quota reservation failed; scheduled API job was not started'),
            'planned_units' => $plannedUnits,
            'history_estimated_units' => $current,
            'consumed_units' => (int) ($reservedState['consumed_units'] ?? 0),
            'reserved_units' => (int) ($reservedState['reserved_units'] ?? 0),
            'projected_units' => $allowed ? (int) ($reservedState['projected_units'] ?? $projected) : $projected,
            'budget_units' => $budget,
            'remaining_units' => (int) ($reservedState['remaining_units'] ?? max(0, $budget - $current)),
            'reservation_active' => $allowed,
            'operational_failure' => ! $allowed && ! $budgetExceeded,
            'quota_date' => $reservedState['quota_date'] ?? null,
            'window_timezone' => $reservedState['window_timezone'] ?? 'America/Los_Angeles',
            'ledger_source' => $reservedState['source'] ?? null,
            'estimate' => $estimate,
        ];
    }

    /**
     * @param  array<string, mixed>  $result
     * @param  array<string, mixed>|null  $preflight
     * @return array<string, mixed>
     */
    private function settleQuota(array $result, ?array $preflight, array $directGuardOutcomes = []): array
    {
        $reservationActive = (bool) ($preflight['reservation_active'] ?? false);
        $actualUnits = max(0, (int) data_get($result, 'youtube_quota_estimate.estimated_units', 0));
        $directOutcome = $directGuardOutcomes[array_key_last($directGuardOutcomes)] ?? null;
        $directAccountingFailed = is_array($directOutcome)
            && (bool) data_get($directOutcome, 'state.accounting_failed', false);

        if (! $reservationActive && is_array($directOutcome) && ($actualUnits === 0 || $directAccountingFailed)) {
            $quotaState = is_array($directOutcome['state'] ?? null) ? $directOutcome['state'] : [];

            if ($quotaState !== []) {
                $this->youtubeQuotaBudget = ['enabled' => true] + $quotaState;
            }

            $reason = is_string($directOutcome['reason'] ?? null) ? $directOutcome['reason'] : null;

            if ($quotaState !== [] && $reason !== null) {
                $this->youtubeQuotaBudget['reason'] = $reason;
            }

            $result['youtube_quota_budget'] = array_merge($preflight ?? [], $quotaState, [
                'direct_job_key' => is_string($directOutcome['job_key'] ?? null) ? $directOutcome['job_key'] : null,
                'accounting_owner' => is_string($directOutcome['accounting_owner'] ?? null) ? $directOutcome['accounting_owner'] : null,
                'allowed' => (bool) ($directOutcome['allowed'] ?? false),
                'reason' => $reason,
                'reservation_active' => (bool) ($quotaState['reservation_active'] ?? false),
                'actual_units' => $actualUnits,
            ]);

            if ((bool) ($quotaState['accounting_failed'] ?? false)) {
                $result['action'] = 'executed:quota-accounting-failed';
                $result['failed'] = true;
                $result['quota_accounting_failed'] = true;
            }

            return $result;
        }

        if (! $reservationActive && $actualUnits === 0) {
            return $result;
        }

        $plannedUnits = max(0, (int) ($preflight['planned_units'] ?? 0));
        $budget = max(0, (int) ($preflight['budget_units'] ?? config('ingestion.youtube_daily_quota_budget', 9000)));
        $quotaState = $reservationActive
            ? $this->quotaLedger->settle(
                plannedUnits: $plannedUnits,
                actualUnits: $actualUnits,
                budget: $budget,
                at: $this->quotaAt,
            )
            : $this->quotaLedger->state($budget, $this->quotaAt);
        $this->youtubeQuotaBudget = ['enabled' => true] + $quotaState;
        $accounting = [
            'reservation_active' => false,
            'actual_units' => $actualUnits,
        ];

        if ($reservationActive) {
            $accounting['settlement'] = $quotaState;
        }

        $result['youtube_quota_budget'] = array_merge($preflight ?? [], $quotaState, $accounting);

        if (! (bool) ($quotaState['available'] ?? false)) {
            $result['action'] = 'executed:quota-accounting-failed';
            $result['failed'] = true;
            $result['quota_accounting_failed'] = true;
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    private function withQuotaEstimate(array $result): array
    {
        $estimate = $this->quotaEstimator->estimateJob($result);

        return $result + [
            'estimated_youtube_quota_units' => (int) ($estimate['estimated_units'] ?? 0),
            'youtube_quota_estimate' => $estimate,
        ];
    }

    private function elapsedMs(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }

    private function sanitizedMessage(string $message, int $width): string
    {
        return SensitiveTextRedactor::redact($message, $width);
    }
}
