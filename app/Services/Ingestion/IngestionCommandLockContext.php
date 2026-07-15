<?php

namespace App\Services\Ingestion;

use Closure;

class IngestionCommandLockContext
{
    /**
     * @var array<string, int>
     */
    private array $ownedJobs = [];

    public function owns(string $jobKey): bool
    {
        return ($this->ownedJobs[$jobKey] ?? 0) > 0;
    }

    /**
     * @param  iterable<string>  $jobKeys
     */
    public function uniquelyOwnedJob(iterable $jobKeys): ?string
    {
        $owned = [];

        foreach ($jobKeys as $jobKey) {
            if ($this->owns($jobKey)) {
                $owned[$jobKey] = true;
            }
        }

        return count($owned) === 1 ? (string) array_key_first($owned) : null;
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function withOwnership(string $jobKey, Closure $callback): mixed
    {
        $this->ownedJobs[$jobKey] = ($this->ownedJobs[$jobKey] ?? 0) + 1;

        try {
            return $callback();
        } finally {
            $remaining = ($this->ownedJobs[$jobKey] ?? 1) - 1;

            if ($remaining > 0) {
                $this->ownedJobs[$jobKey] = $remaining;
            } else {
                unset($this->ownedJobs[$jobKey]);
            }
        }
    }
}
