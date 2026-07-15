<?php

namespace App\Services\Ingestion;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use JsonException;
use Throwable;

final class AiBusinessKeyLock
{
    private const NAME_PREFIX = 'ytb:ai:';

    private const NAME_HASH_LENGTH = 56;

    /**
     * @param  array<string, bool|float|int|string|null>  $identity
     */
    public function acquire(string $table, array $identity): ?AiBusinessKeyLockHandle
    {
        $name = $this->name($table, $identity);
        $timeoutSeconds = max(0, min(30, (int) config('ingestion.ai_business_lock_timeout_seconds', 0)));
        $ttlSeconds = max(60, min(3600, (int) config('ingestion.ai_business_lock_seconds', 900)));
        $connection = DB::connection();

        if (in_array($connection->getDriverName(), ['mysql', 'mariadb'], true)) {
            return $this->acquireMysql($connection, $name, $table, $timeoutSeconds);
        }

        return $this->acquireFallback($name, $table, $timeoutSeconds, $ttlSeconds);
    }

    /**
     * MySQL and MariaDB limit advisory-lock names to 64 bytes. Only the
     * non-sensitive table namespace and a bounded hash leave this process.
     *
     * @param  array<string, bool|float|int|string|null>  $identity
     */
    public function name(string $table, array $identity): string
    {
        $table = strtolower(trim($table));
        // Legacy AI identity columns use case-insensitive, PAD SPACE collations.
        $identity = array_map(
            static fn (bool|float|int|string|null $value): bool|float|int|string|null => is_string($value)
                ? mb_strtolower(rtrim($value, ' '), 'UTF-8')
                : $value,
            $identity,
        );
        ksort($identity, SORT_STRING);

        try {
            $encoded = json_encode([$table, $identity], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (JsonException) {
            $encoded = serialize([$table, $identity]);
        }

        return self::NAME_PREFIX.substr(hash('sha256', $encoded), 0, self::NAME_HASH_LENGTH);
    }

    private function acquireMysql(Connection $connection, string $name, string $table, int $timeoutSeconds): ?AiBusinessKeyLockHandle
    {
        try {
            $row = $connection->selectOne(
                'SELECT GET_LOCK(?, ?) AS lock_acquired',
                [$name, $timeoutSeconds],
                false,
            );
            $acquired = (int) data_get($row, 'lock_acquired', 0) === 1;
        } catch (Throwable $exception) {
            $this->logFailure($table, $name, 'mysql_acquire_failed', $exception);

            return null;
        }

        if (! $acquired) {
            $this->logFailure($table, $name, 'contended');

            return null;
        }

        return new AiBusinessKeyLockHandle($name, function () use ($connection, $name, $table): void {
            try {
                $connection->selectOne('SELECT RELEASE_LOCK(?) AS lock_released', [$name], false);
            } catch (Throwable $exception) {
                $this->logFailure($table, $name, 'mysql_release_failed', $exception);
            }
        });
    }

    private function acquireFallback(string $name, string $table, int $timeoutSeconds, int $ttlSeconds): ?AiBusinessKeyLockHandle
    {
        try {
            $lock = IngestionLockStore::lock($name, $ttlSeconds);
            $acquired = $timeoutSeconds === 0
                ? $lock->get()
                : $lock->block($timeoutSeconds);
        } catch (LockTimeoutException) {
            $this->logFailure($table, $name, 'contended');

            return null;
        } catch (Throwable $exception) {
            $this->logFailure($table, $name, 'fallback_acquire_failed', $exception);

            return null;
        }

        if (! $acquired) {
            $this->logFailure($table, $name, 'contended');

            return null;
        }

        return new AiBusinessKeyLockHandle($name, function () use ($lock, $name, $table): void {
            try {
                $lock->release();
            } catch (Throwable $exception) {
                $this->logFailure($table, $name, 'fallback_release_failed', $exception);
            }
        });
    }

    private function logFailure(string $table, string $name, string $status, ?Throwable $exception = null): void
    {
        Log::warning('AI business-key lock unavailable.', [
            'table' => $table,
            'lock_name' => $name,
            'status' => $status,
            'exception_class' => $exception === null ? null : $exception::class,
            'secrets' => 'not_printed',
        ]);
    }
}
