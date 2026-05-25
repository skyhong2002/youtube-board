<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

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
     * @return array{
     *     active: bool,
     *     window_minutes: int,
     *     latest: array<string, mixed>|null,
     *     latest_created_at: string|null,
     *     latest_age_seconds: int|null,
     *     summary: array<string, mixed>,
     *     not_observed_reasons: list<string>
     * }
     */
    public function externalSchedulerActivity(int $windowMinutes = 3, ?CarbonImmutable $now = null): array
    {
        $windowMinutes = max(1, min(60, $windowMinutes));
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now ??= CarbonImmutable::now($timezone);

        $latest = collect($this->latest(30))
            ->first(fn (array $record): bool => $this->isExternalSchedulerRecord($record));

        $createdAt = $latest !== null ? $this->createdAt($latest, $timezone) : null;
        $ageSeconds = $createdAt !== null ? max(0, $createdAt->diffInSeconds($now)) : null;
        $active = $ageSeconds !== null && $ageSeconds <= ($windowMinutes * 60);

        return [
            'active' => $active,
            'window_minutes' => $windowMinutes,
            'latest' => $latest,
            'latest_created_at' => $createdAt !== null ? $createdAt->toDateTimeString().' '.$createdAt->getTimezone()->getName() : null,
            'latest_age_seconds' => $ageSeconds,
            'summary' => is_array($latest['result']['summary'] ?? null) ? $latest['result']['summary'] : [],
            'not_observed_reasons' => [
                'Dokploy scheduled task may be disabled or paused.',
                'The scheduled command may not include ingestion:run --execute --record.',
                'The app may not be able to write local run-history JSON files.',
                'No external scheduler run file was created within the recent activity window.',
            ],
        ];
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

    /**
     * @param  array<string, mixed>  $record
     */
    private function isExternalSchedulerRecord(array $record): bool
    {
        return ($record['request']['source'] ?? null) === 'artisan'
            && ($record['request']['mode'] ?? null) === 'execute'
            && ($record['result']['mode'] ?? null) === 'execute';
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function createdAt(array $record, string $timezone): ?CarbonImmutable
    {
        $createdAt = $record['created_at'] ?? null;

        if (is_string($createdAt) && trim($createdAt) !== '') {
            try {
                return CarbonImmutable::parse($createdAt, $timezone);
            } catch (Throwable) {
                return null;
            }
        }

        $id = $record['id'] ?? null;

        if (is_string($id) && preg_match('/^(\d{8})-(\d{6})-/', $id, $matches)) {
            $parsed = CarbonImmutable::createFromFormat('Ymd His', $matches[1].' '.$matches[2], $timezone);

            return $parsed instanceof CarbonImmutable ? $parsed : null;
        }

        return null;
    }
}
