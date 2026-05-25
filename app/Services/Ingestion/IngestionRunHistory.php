<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class IngestionRunHistory
{
    private const DIRECTORY = 'ingestion-runs';

    /**
     * @param  array<string, mixed>  $result
     * @param  array<string, mixed>  $request
     * @return array<string, mixed>
     */
    public function record(array $result, array $request): array
    {
        $createdAt = CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei')));
        $id = $createdAt->format('Ymd-His').'-'.Str::lower((string) Str::uuid());
        $path = self::DIRECTORY.'/'.$id.'.json';

        $record = [
            'id' => $id,
            'path' => $path,
            'created_at' => $createdAt->toDateTimeString().' '.$createdAt->getTimezone()->getName(),
            'request' => $request,
            'result' => $result,
        ];

        Storage::disk('local')->put(
            $path,
            json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );

        return $record;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function latest(int $limit = 8): array
    {
        $limit = max(1, min(30, $limit));

        return collect(Storage::disk('local')->files(self::DIRECTORY))
            ->filter(fn (string $path): bool => str_ends_with($path, '.json'))
            ->sortDesc()
            ->take($limit)
            ->map(function (string $path): ?array {
                $payload = json_decode((string) Storage::disk('local')->get($path), true);

                if (! is_array($payload)) {
                    return null;
                }

                return $payload + ['path' => $path];
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        if (! preg_match('/^\d{8}-\d{6}-[0-9a-f-]{36}$/', $id)) {
            return null;
        }

        $path = self::DIRECTORY.'/'.$id.'.json';

        if (! Storage::disk('local')->exists($path)) {
            return null;
        }

        $payload = json_decode((string) Storage::disk('local')->get($path), true);

        if (! is_array($payload)) {
            return null;
        }

        return $payload + ['path' => $path];
    }
}
