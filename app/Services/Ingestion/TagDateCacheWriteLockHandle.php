<?php

namespace App\Services\Ingestion;

use Closure;

final class TagDateCacheWriteLockHandle
{
    private bool $released = false;

    /**
     * @param  Closure(): void  $release
     */
    public function __construct(
        public readonly string $name,
        private readonly Closure $release,
    ) {}

    public function release(): void
    {
        if ($this->released) {
            return;
        }

        $this->released = true;
        ($this->release)();
    }

    public function __destruct()
    {
        $this->release();
    }
}
