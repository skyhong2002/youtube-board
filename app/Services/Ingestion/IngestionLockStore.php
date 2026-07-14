<?php

namespace App\Services\Ingestion;

use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;

final class IngestionLockStore
{
    public static function name(): ?string
    {
        $store = trim((string) config('ingestion.lock_store', ''));

        return $store !== '' ? $store : null;
    }

    public static function lock(string $name, int $seconds): Lock
    {
        $store = self::name();

        return $store === null
            ? Cache::lock($name, $seconds)
            : Cache::store($store)->lock($name, $seconds);
    }
}
