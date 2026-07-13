<?php

namespace App\Console\Commands;

use App\Services\LocalDumpImportAudit;
use App\Services\LocalDumpImportRunner;
use App\Services\LocalDumpInspector;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class ImportLocalDumpCommand extends Command
{
    protected $signature = 'db:import-local
        {file : Relative .sql or .sql.gz path under storage/app/db-dumps}
        {--dry-run : Explicitly inspect without importing; cannot be combined with --execute}
        {--execute : Import the reviewed artifact into the local database}
        {--replace-existing : Permit explicit DROP TABLE IF EXISTS statements in the reviewed artifact}
        {--sha256= : Require this exact SHA-256 before preview or execution}
        {--max-file-bytes=536870912 : Maximum compressed/on-disk bytes}
        {--max-expanded-bytes=1073741824 : Maximum inspected uncompressed bytes}
        {--timeout=900 : MariaDB client timeout in seconds}
        {--json : Emit machine-readable output}';

    protected $description = 'Preview or explicitly import an approved dump into local YouTube Board MariaDB';

    public function handle(
        LocalDumpInspector $inspector,
        LocalDumpImportRunner $runner,
        LocalDumpImportAudit $audit,
    ): int {
        $execute = (bool) $this->option('execute');
        $dryRun = (bool) $this->option('dry-run');
        $mode = $execute && ! $dryRun ? 'execute' : 'preview';
        $inspection = null;
        $lock = null;
        $lockAcquired = false;

        try {
            if ($execute && $dryRun) {
                throw new \RuntimeException('conflicting_execution_modes');
            }

            $runner->assertLocalTarget();
            $maxFileBytes = $this->boundedInteger('max-file-bytes', 1, 2 * 1024 * 1024 * 1024);
            $maxExpandedBytes = $this->boundedInteger('max-expanded-bytes', 1, 2 * 1024 * 1024 * 1024);
            $timeout = $this->boundedInteger('timeout', 1, 3600);
            $expectedSha = strtolower(trim((string) $this->option('sha256')));

            if ($expectedSha !== '' && preg_match('/\A[a-f0-9]{64}\z/', $expectedSha) !== 1) {
                throw new \RuntimeException('invalid_sha256');
            }

            if ($mode === 'execute') {
                $lock = Cache::lock('local-dump-import:global', $timeout + 3600);
                $lockAcquired = $lock->get();

                if (! $lockAcquired) {
                    throw new \RuntimeException('dump_import_locked');
                }
            }

            $inspection = $inspector->inspect(
                (string) $this->argument('file'),
                $maxFileBytes,
                $maxExpandedBytes,
            );

            if ($expectedSha !== '' && ! hash_equals($expectedSha, $inspection['sha256'])) {
                throw new \RuntimeException('checksum_mismatch');
            }

            if ($inspection['unsafe_reasons'] !== []) {
                throw new \RuntimeException('unsafe_sql_refused');
            }

            $payload = $this->publicPayload($inspection, $mode);

            if ($mode === 'preview') {
                $this->render($payload);

                return self::SUCCESS;
            }

            if ($inspection['replacement_required'] && ! (bool) $this->option('replace-existing')) {
                throw new \RuntimeException('replace_existing_confirmation_required');
            }

            $inspector->assertUnchanged($inspection);
            $completedId = $audit->completedId($inspection['sha256']);

            if ($completedId !== null) {
                $payload['status'] = 'already_completed';
                $payload['idempotent'] = true;
                $payload['prior_audit_id'] = $completedId;
                $payload['audit_id'] = $audit->record([
                    'status' => 'already_completed',
                    'sha256' => $inspection['sha256'],
                    'size_bytes' => $inspection['size_bytes'],
                    'expanded_bytes' => $inspection['expanded_bytes'],
                    'tables' => $inspection['tables'],
                    'replacement_confirmed' => (bool) $this->option('replace-existing'),
                ]);
                $this->render($payload);

                return self::SUCCESS;
            }

            $runner->run($inspection, $timeout);

            $payload['status'] = 'completed';
            $payload['audit_id'] = $audit->record([
                'status' => 'completed',
                'sha256' => $inspection['sha256'],
                'size_bytes' => $inspection['size_bytes'],
                'expanded_bytes' => $inspection['expanded_bytes'],
                'tables' => $inspection['tables'],
                'replacement_confirmed' => (bool) $this->option('replace-existing'),
            ]);
            Log::info('Local dashboard dump import completed.', [
                'audit_id' => $payload['audit_id'],
                'sha256' => $inspection['sha256'],
                'size_bytes' => $inspection['size_bytes'],
                'expanded_bytes' => $inspection['expanded_bytes'],
                'table_count' => count($inspection['tables']),
                'replacement_confirmed' => (bool) $this->option('replace-existing'),
            ]);
            $this->render($payload);

            return self::SUCCESS;
        } catch (Throwable $exception) {
            $errorCode = $this->safeErrorCode($exception);
            $auditId = null;

            if ($mode === 'execute') {
                try {
                    $auditId = $audit->record([
                        'status' => 'refused_or_failed',
                        'error_code' => $errorCode,
                        'sha256' => $inspection['sha256'] ?? null,
                        'size_bytes' => $inspection['size_bytes'] ?? null,
                        'expanded_bytes' => $inspection['expanded_bytes'] ?? null,
                        'tables' => $inspection['tables'] ?? [],
                        'replacement_confirmed' => (bool) $this->option('replace-existing'),
                    ]);
                } catch (Throwable) {
                    $auditId = null;
                }
            }

            Log::warning('Local dashboard dump import refused or failed.', [
                'mode' => $mode,
                'error_code' => $errorCode,
                'exception' => $exception::class,
                'audit_id' => $auditId,
            ]);
            $payload = [
                'mode' => $mode,
                'status' => 'refused',
                'error_code' => $errorCode,
                'secrets' => 'not_printed',
            ];

            if ($auditId !== null) {
                $payload['audit_id'] = $auditId;
            }

            $this->render($payload);

            return self::FAILURE;
        } finally {
            $inspector->cleanup($inspection);

            if ($lockAcquired && $lock !== null) {
                try {
                    $lock->release();
                } catch (Throwable) {
                    // An expired lock must not hide the import result or audit entry.
                }
            }
        }
    }

    private function boundedInteger(string $option, int $minimum, int $maximum): int
    {
        $value = filter_var($this->option($option), FILTER_VALIDATE_INT);

        if ($value === false || $value < $minimum || $value > $maximum) {
            throw new \RuntimeException("invalid_{$option}");
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $inspection
     * @return array<string, mixed>
     */
    private function publicPayload(array $inspection, string $mode): array
    {
        return [
            'mode' => $mode,
            'dry_run' => $mode === 'preview',
            'status' => 'ready',
            'file' => $inspection['file'],
            'compressed' => $inspection['compressed'],
            'size_bytes' => $inspection['size_bytes'],
            'expanded_bytes' => $inspection['expanded_bytes'],
            'sha256' => $inspection['sha256'],
            'tables' => $inspection['tables'],
            'statements' => $inspection['statements'],
            'replacement_required' => $inspection['replacement_required'],
            'write_target' => 'local_mysql_only',
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function render(array $payload): void
    {
        if ((bool) $this->option('json')) {
            $this->line((string) json_encode($payload, JSON_UNESCAPED_SLASHES));

            return;
        }

        foreach ($payload as $key => $value) {
            $rendered = is_array($value)
                ? json_encode($value, JSON_UNESCAPED_SLASHES)
                : match (true) {
                    is_bool($value) => $value ? 'true' : 'false',
                    $value === null => 'null',
                    default => (string) $value,
                };
            $this->line("{$key}={$rendered}");
        }
    }

    private function safeErrorCode(Throwable $exception): string
    {
        $message = $exception->getMessage();

        return preg_match('/\A[a-z0-9_-]+\z/', $message) === 1
            ? $message
            : 'import_failed';
    }
}
