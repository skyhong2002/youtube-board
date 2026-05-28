<?php

namespace App\Services\Ingestion;

use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class IngestionSchedulerRunner
{
    public function __construct(private readonly IngestionJobRegistry $registry)
    {
    }

    /**
     * @return array{
     *     at: string,
     *     mode: string,
     *     scheduler_enabled: bool,
     *     jobs: list<array<string, mixed>>,
     *     summary: array{evaluated: int, due: int, executed: int, skipped: int, failed: int}
     * }
     */
    public function run(CarbonInterface $at, bool $execute = false, ?string $jobKey = null, bool $showAll = false): array
    {
        $jobs = $jobKey === null
            ? $this->registry->jobs()
            : collect($this->registry->find($jobKey) ? [$this->registry->find($jobKey)] : []);

        $schedulerEnabled = (bool) config('ingestion.scheduler_enabled', false);
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

            if ($result['executed']) {
                $summary['executed']++;
            } elseif ($result['failed']) {
                $summary['failed']++;
            } else {
                $summary['skipped']++;
            }

            $results[] = $result;
        }

        if ($jobKey !== null && $results === []) {
            $summary['skipped']++;
            $results[] = [
                'key' => $jobKey,
                'status' => 'missing',
                'command' => '',
                'schedule' => '',
                'due' => false,
                'action' => 'skip:job-missing',
                'executed' => false,
                'failed' => false,
                'exit_code' => null,
            ];
        }

        return [
            'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
            'mode' => $execute ? 'execute' : 'dry-run',
            'scheduler_enabled' => $schedulerEnabled,
            'jobs' => $results,
            'summary' => $summary,
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
            return array_merge($base, ['action' => 'skip:not-due']);
        }

        if (! $schedulerEnabled) {
            return array_merge($base, ['action' => 'skip:scheduler-disabled']);
        }

        if ($status !== 'active') {
            return array_merge($base, ['action' => 'skip:status-'.$status]);
        }

        if (! $this->registry->commandExists($job)) {
            return array_merge($base, ['action' => 'skip:command-missing']);
        }

        $scheduledWrite = $this->registry->scheduledWriteProfile($job);
        $executionProfile = $this->registry->executionProfile($job);

        if (! $executionProfile['can_execute_when_due'] && ! ($execute && $scheduledWrite['allowed'])) {
            return array_merge($base, [
                'action' => 'skip:controlled-execution-guardrail',
                'scheduled_write' => $scheduledWrite,
                'execution' => $executionProfile,
            ]);
        }

        if (! $execute) {
            return array_merge($base, ['action' => 'would-run']);
        }

        try {
            $effectiveCommand = $scheduledWrite['allowed']
                ? $this->registry->scheduledExecutionCommand($job)
                : $command;
            $exitCode = Artisan::call($effectiveCommand);
            $output = trim(Artisan::output());

            return array_merge($base, [
                'action' => $exitCode === 0
                    ? ($effectiveCommand !== $command ? 'executed:local-polling' : 'executed')
                    : 'failed',
                'executed' => $exitCode === 0,
                'failed' => $exitCode !== 0,
                'exit_code' => $exitCode,
                'effective_command' => $effectiveCommand,
                'output' => mb_strimwidth($output, 0, 2000, '...', 'UTF-8'),
                'scheduled_write' => $scheduledWrite,
            ]);
        } catch (Throwable $exception) {
            return array_merge($base, [
                'action' => 'failed:exception',
                'failed' => true,
                'error' => mb_strimwidth($exception->getMessage(), 0, 1000, '...', 'UTF-8'),
            ]);
        }
    }

}
