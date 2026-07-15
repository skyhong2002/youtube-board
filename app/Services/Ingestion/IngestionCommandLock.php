<?php

namespace App\Services\Ingestion;

use Closure;
use Illuminate\Support\Facades\Log;
use Throwable;

class IngestionCommandLock
{
    public function __construct(
        private readonly IngestionJobRegistry $registry,
        private readonly IngestionCommandLockContext $context,
    ) {}

    public static function name(string $jobKey): string
    {
        return 'ingestion:job:'.sha1($jobKey);
    }

    /**
     * @param  array<string, mixed>  $options
     */
    public function jobKeyForCommand(string $commandName, array $options = []): ?string
    {
        $matches = $this->registry->jobs()
            ->filter(fn (array $job): bool => in_array($commandName, [
                $this->registry->commandName($job),
                $this->commandName((string) ($job['scheduled_execute_command'] ?? '')),
            ], true))
            ->filter(fn (array $job): bool => is_string($job['key'] ?? null) && $job['key'] !== '')
            ->unique('key')
            ->values();

        if ($matches->count() === 1) {
            return (string) $matches->first()['key'];
        }

        if ($matches->isEmpty()) {
            return null;
        }

        $ownedJob = $this->context->uniquelyOwnedJob($matches->pluck('key')->all());
        $discriminatorMatches = $matches
            ->filter(fn (array $job): bool => $this->matchesDiscriminator($job, $options))
            ->values();

        if ($options !== []) {
            if ($discriminatorMatches->count() !== 1) {
                return null;
            }

            $discriminatorJob = (string) $discriminatorMatches->first()['key'];

            return $ownedJob === null || $ownedJob === $discriminatorJob
                ? $discriminatorJob
                : null;
        }

        if ($ownedJob !== null) {
            return $ownedJob;
        }

        return $discriminatorMatches->count() === 1
            ? (string) $discriminatorMatches->first()['key']
            : null;
    }

    private function commandName(string $command): string
    {
        $parts = preg_split('/\s+/', trim($command));

        return $parts[0] ?? '';
    }

    /**
     * @param  array<string, mixed>  $job
     * @param  array<string, mixed>  $options
     */
    private function matchesDiscriminator(array $job, array $options): bool
    {
        $discriminator = $job['command_lock_discriminator'] ?? null;

        if (! is_array($discriminator) || $discriminator === []) {
            return false;
        }

        foreach ($discriminator as $option => $expected) {
            $actual = $options[(string) $option] ?? null;

            if ($expected === null) {
                if ($actual !== null && $actual !== '') {
                    return false;
                }

                continue;
            }

            if (! is_scalar($actual) || (string) $actual !== (string) $expected) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  Closure(): int  $callback
     * @param  array<string, mixed>  $options
     * @return array{executed: bool, exit_code: int, blocked_reason: string|null, job_key: string|null, lock: array{name: string, ttl_seconds: int, acquired: bool}|null}
     */
    public function run(string $commandName, Closure $callback, array $options = []): array
    {
        $jobKey = $this->jobKeyForCommand($commandName, $options);

        if ($jobKey === null) {
            Log::warning('Ingestion command execution blocked.', [
                'command' => $commandName,
                'job_key' => null,
                'status' => 'lock_mapping_unavailable',
                'exit_code' => 1,
                'runtime_ms' => 0,
            ]);

            return [
                'executed' => false,
                'exit_code' => 1,
                'blocked_reason' => 'command_lock_mapping_unavailable',
                'job_key' => null,
                'lock' => null,
            ];
        }

        if ($this->context->owns($jobKey)) {
            $exitCode = $this->executeAndLog($commandName, $jobKey, $callback);

            return [
                'executed' => true,
                'exit_code' => $exitCode,
                'blocked_reason' => null,
                'job_key' => $jobKey,
                'lock' => [
                    'name' => self::name($jobKey),
                    'ttl_seconds' => max(60, min(86400, (int) config('ingestion.job_lock_seconds', 14400))),
                    'acquired' => true,
                ],
            ];
        }

        $lockSeconds = max(60, min(86400, (int) config('ingestion.job_lock_seconds', 14400)));
        $lock = IngestionLockStore::lock(self::name($jobKey), $lockSeconds);

        if (! $lock->get()) {
            Log::warning('Ingestion command execution blocked.', [
                'command' => $commandName,
                'job_key' => $jobKey,
                'status' => 'locked',
                'exit_code' => 1,
                'runtime_ms' => 0,
            ]);

            return [
                'executed' => false,
                'exit_code' => 1,
                'blocked_reason' => 'command_locked',
                'job_key' => $jobKey,
                'lock' => [
                    'name' => self::name($jobKey),
                    'ttl_seconds' => $lockSeconds,
                    'acquired' => false,
                ],
            ];
        }

        try {
            $exitCode = $this->context->withOwnership(
                $jobKey,
                fn (): int => $this->executeAndLog($commandName, $jobKey, $callback),
            );

            return [
                'executed' => true,
                'exit_code' => $exitCode,
                'blocked_reason' => null,
                'job_key' => $jobKey,
                'lock' => [
                    'name' => self::name($jobKey),
                    'ttl_seconds' => $lockSeconds,
                    'acquired' => true,
                ],
            ];
        } finally {
            try {
                $lock->release();
            } catch (Throwable) {
                // An expired lock must not hide the completed command result.
            }
        }
    }

    /**
     * @param  Closure(): int  $callback
     */
    private function executeAndLog(string $commandName, string $jobKey, Closure $callback): int
    {
        $startedNs = hrtime(true);

        try {
            $exitCode = $callback();
            Log::info('Ingestion command execution completed.', [
                'command' => $commandName,
                'job_key' => $jobKey,
                'status' => $exitCode === 0 ? 'completed' : 'failed',
                'exit_code' => $exitCode,
                'runtime_ms' => (int) round((hrtime(true) - $startedNs) / 1_000_000),
            ]);

            return $exitCode;
        } catch (Throwable $exception) {
            Log::warning('Ingestion command execution failed.', [
                'command' => $commandName,
                'job_key' => $jobKey,
                'status' => 'failed_exception',
                'exit_code' => 1,
                'runtime_ms' => (int) round((hrtime(true) - $startedNs) / 1_000_000),
                'exception_class' => $exception::class,
            ]);

            throw $exception;
        }
    }
}
