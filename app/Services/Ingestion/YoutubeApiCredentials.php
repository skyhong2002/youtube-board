<?php

namespace App\Services\Ingestion;

class YoutubeApiCredentials
{
    /**
     * @return list<string>
     */
    public function keys(): array
    {
        return collect([
            config('services.youtube.api_key'),
            ...explode(',', (string) config('services.youtube.api_keys', '')),
        ])
            ->map(fn (mixed $key): string => trim((string) $key))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    public function configured(): bool
    {
        return $this->keys() !== [];
    }
}
