<?php

namespace App\Services\Ingestion;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

final class TagDateCacheWriteLock
{
    private const NAME_PREFIX = 'ytb:tag-date:';

    private const NAME_HASH_LENGTH = 51;

    private const FALLBACK_TTL_SECONDS = 300;

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     */
    public function acquire(array $tagIds, array $orTagIds, array $notTagIds, string $date): ?TagDateCacheWriteLockHandle
    {
        $name = $this->name($tagIds, $orTagIds, $notTagIds, $date);
        $connection = DB::connection();

        if (in_array($connection->getDriverName(), ['mysql', 'mariadb'], true)) {
            return $this->acquireMysql($connection, $name);
        }

        return $this->acquireFallback($name);
    }

    /**
     * The identity matches the urt_show_tag_date lookup key. Keyword subsets
     * intentionally share a lock because partial rebuilds merge into that row.
     *
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     */
    public function name(array $tagIds, array $orTagIds, array $notTagIds, string $date): string
    {
        $tagIds = ReportCacheBuildGuardrails::ids($tagIds);
        $orTagIds = ReportCacheBuildGuardrails::ids($orTagIds);
        $notTagIds = ReportCacheBuildGuardrails::ids($notTagIds);
        $identity = json_encode([
            'tagid' => implode(',', $tagIds),
            'tag_or' => implode(',', $orTagIds),
            'tag_not' => implode(',', $notTagIds),
            'the_date' => trim($date),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);

        return self::NAME_PREFIX.substr(hash('sha256', $identity), 0, self::NAME_HASH_LENGTH);
    }

    private function acquireMysql(Connection $connection, string $name): ?TagDateCacheWriteLockHandle
    {
        try {
            $row = $connection->selectOne('SELECT GET_LOCK(?, 0) AS lock_acquired', [$name], false);
            $acquired = (int) data_get($row, 'lock_acquired', 0) === 1;
        } catch (Throwable $exception) {
            $this->logUnavailable($name, 'mysql_acquire_failed', $exception);

            return null;
        }

        if (! $acquired) {
            $this->logUnavailable($name, 'contended');

            return null;
        }

        return new TagDateCacheWriteLockHandle($name, function () use ($connection, $name): void {
            try {
                $row = $connection->selectOne('SELECT RELEASE_LOCK(?) AS lock_released', [$name], false);

                if ((int) data_get($row, 'lock_released', 0) !== 1) {
                    $this->logUnavailable($name, 'mysql_release_unconfirmed');
                }
            } catch (Throwable $exception) {
                $this->logUnavailable($name, 'mysql_release_failed', $exception);
            }
        });
    }

    private function acquireFallback(string $name): ?TagDateCacheWriteLockHandle
    {
        try {
            $lock = IngestionLockStore::lock($name, self::FALLBACK_TTL_SECONDS);

            if (! $lock->get()) {
                $this->logUnavailable($name, 'contended');

                return null;
            }
        } catch (Throwable $exception) {
            $this->logUnavailable($name, 'fallback_acquire_failed', $exception);

            return null;
        }

        return new TagDateCacheWriteLockHandle($name, function () use ($lock, $name): void {
            try {
                $lock->release();
            } catch (Throwable $exception) {
                $this->logUnavailable($name, 'fallback_release_failed', $exception);
            }
        });
    }

    private function logUnavailable(string $name, string $status, ?Throwable $exception = null): void
    {
        Log::warning('Tag date cache write lock unavailable.', [
            'lock_name' => $name,
            'status' => $status,
            'exception_class' => $exception === null ? null : $exception::class,
            'secrets' => 'not_printed',
        ]);
    }
}
