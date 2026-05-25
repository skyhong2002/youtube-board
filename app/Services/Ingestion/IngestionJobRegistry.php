<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Cron\CronExpression;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Artisan;
use Throwable;

class IngestionJobRegistry
{
    /**
     * @return Collection<int, array<string, mixed>>
     */
    public function jobs(): Collection
    {
        return collect(config('ingestion.jobs', []))
            ->map(fn (array $job): array => $this->withCommandAvailability($job))
            ->sortBy([
                ['priority', 'asc'],
                ['group', 'asc'],
                ['key', 'asc'],
            ])
            ->values();
    }

    /**
     * @return Collection<string, Collection<int, array<string, mixed>>>
     */
    public function grouped(): Collection
    {
        return $this->jobs()->groupBy('group');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $key): ?array
    {
        return $this->jobs()->firstWhere('key', $key);
    }

    /**
     * @return array{
     *     job: array<string, mixed>,
     *     at: string,
     *     is_due_now: bool,
     *     schedule_previews: list<array{expression: string, valid: bool, next_runs: list<string>, error?: string}>,
     *     execution: array{read_only: bool, can_execute_when_due: bool, external_calls: bool, risk_label: string, blocks: list<string>}
     * }|null
     */
    public function describe(string $key, ?CarbonInterface $at = null, int $nextRunLimit = 5): ?array
    {
        $job = $this->find($key);

        if ($job === null) {
            return null;
        }

        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $at = $at === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($at->toDateTimeImmutable())->setTimezone($timezone);

        return [
            'job' => $job,
            'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
            'is_due_now' => $this->isDue($job, $at),
            'schedule_previews' => $this->schedulePreviews($job, $at, $nextRunLimit),
            'execution' => $this->executionProfile($job),
        ];
    }

    /**
     * @param  array<string, mixed>  $job
     * @return list<string>
     */
    public function scheduleExpressions(array $job): array
    {
        return collect(explode(' / ', (string) ($job['schedule'] ?? '')))
            ->map(fn (string $expression) => trim($expression))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $job
     */
    public function isDue(array $job, CarbonInterface $at): bool
    {
        foreach ($this->scheduleExpressions($job) as $expression) {
            try {
                if (CronExpression::factory($expression)->isDue($at->toDateTimeImmutable(), $at->getTimezone()->getName())) {
                    return true;
                }
            } catch (Throwable) {
                continue;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $job
     */
    public function commandName(array $job): string
    {
        $parts = preg_split('/\s+/', trim((string) ($job['modern_command'] ?? '')));

        return $parts[0] ?? '';
    }

    /**
     * @param  array<string, mixed>  $job
     */
    public function commandExists(array $job): bool
    {
        $commandName = $this->commandName($job);

        return $commandName !== '' && array_key_exists($commandName, Artisan::all());
    }

    /**
     * @param  array<string, mixed>  $job
     * @return array{read_only: bool, can_execute_when_due: bool, external_calls: bool, risk_label: string, blocks: list<string>}
     */
    public function executionProfile(array $job): array
    {
        $status = (string) ($job['status'] ?? 'planned');
        $commandExists = (bool) ($job['command_exists'] ?? $this->commandExists($job));
        $readOnly = $this->isReadOnlyJob($job);
        $externalCalls = $this->hasExternalDependency($job);
        $blocks = [];

        if ($status !== 'active') {
            $blocks[] = 'Registry status is '.$status.', not active.';
        }

        if (! $commandExists) {
            $blocks[] = 'Laravel command is not implemented yet.';
        }

        if (! $readOnly) {
            $blocks[] = 'Job declares write targets, so it is not allowed under the current read-only guardrail.';
        }

        if ($externalCalls) {
            $blocks[] = 'Job declares an external API dependency.';
        }

        return [
            'read_only' => $readOnly,
            'can_execute_when_due' => $blocks === [],
            'external_calls' => $externalCalls,
            'risk_label' => $readOnly ? 'read-only' : ($externalCalls ? 'external polling/write' : 'local write'),
            'blocks' => $blocks,
        ];
    }

    /**
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    private function withCommandAvailability(array $job): array
    {
        $commandName = $this->commandName($job);

        return $job + [
            'command_name' => $commandName,
            'command_exists' => $commandName !== '' && array_key_exists($commandName, Artisan::all()),
        ];
    }

    /**
     * @param  array<string, mixed>  $job
     * @return list<array{expression: string, valid: bool, next_runs: list<string>, error?: string}>
     */
    private function schedulePreviews(array $job, CarbonInterface $at, int $limit): array
    {
        $timezone = $at->getTimezone()->getName();
        $limit = max(1, min(12, $limit));

        return collect($this->scheduleExpressions($job))
            ->map(function (string $expression) use ($at, $limit, $timezone): array {
                try {
                    $cron = CronExpression::factory($expression);
                    $runs = [];

                    for ($nth = 0; $nth < $limit; $nth++) {
                        $next = $cron->getNextRunDate(
                            $at->toDateTimeImmutable(),
                            $nth,
                            false,
                            $timezone,
                        );

                        $runs[] = CarbonImmutable::instance($next)
                            ->setTimezone($timezone)
                            ->format('Y-m-d H:i:s T');
                    }

                    return [
                        'expression' => $expression,
                        'valid' => true,
                        'next_runs' => $runs,
                    ];
                } catch (Throwable $exception) {
                    return [
                        'expression' => $expression,
                        'valid' => false,
                        'next_runs' => [],
                        'error' => $exception->getMessage(),
                    ];
                }
            })
            ->values()
            ->all();
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function isReadOnlyJob(array $job): bool
    {
        $writes = collect($job['writes'] ?? [])
            ->map(fn (mixed $write): string => strtolower((string) $write))
            ->filter();

        return $writes->isEmpty()
            || $writes->every(fn (string $write): bool => str_contains($write, 'none') || str_contains($write, 'read-only'));
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function hasExternalDependency(array $job): bool
    {
        $dependency = strtolower((string) ($job['external_dependency'] ?? ''));

        return str_contains($dependency, 'api')
            || str_contains($dependency, 'youtube')
            || str_contains($dependency, 'opencode')
            || str_contains($dependency, 'openai');
    }

    /**
     * @return array{total: int, planned: int, active: int, blocked: int, command_ready: int, command_missing: int, scheduler_enabled: bool}
     */
    public function summary(): array
    {
        $jobs = $this->jobs();

        return [
            'total' => $jobs->count(),
            'planned' => $jobs->where('status', 'planned')->count(),
            'active' => $jobs->where('status', 'active')->count(),
            'blocked' => $jobs->where('status', 'blocked')->count(),
            'command_ready' => $jobs->where('command_exists', true)->count(),
            'command_missing' => $jobs->where('command_exists', false)->count(),
            'scheduler_enabled' => (bool) config('ingestion.scheduler_enabled', false),
        ];
    }
}
