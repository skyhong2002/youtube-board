<?php

namespace App\Services\Ingestion;

final class ReportCacheBuildGuardrails
{
    public const TAG_ID_LIST_LIMIT = 50;

    public const PERIOD_LIST_LIMIT = 10;

    public const KEYWORD_LIST_LIMIT = 500;

    public const CHANNEL_ID_LIST_LIMIT = 500;

    public const DATE_RANGE_LIMIT = 400;

    public const CHANNEL_SCAN_LIMIT_MAX = 5000;

    public const KEYWORD_SCAN_LIMIT_MAX = 20000;

    public const TAG_DATE_KEYWORD_SCAN_LIMIT_MAX = 100000;

    public const VIDEO_SCAN_LIMIT_MAX = 100000;

    /**
     * @return list<int>
     */
    public static function ids(array $values): array
    {
        return collect($values)
            ->map(fn (mixed $value): int => (int) $value)
            ->filter(fn (int $value): bool => $value > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @return list<int>
     */
    public static function days(array $values): array
    {
        return collect($values)
            ->map(fn (mixed $value): int => max(1, min(365, (int) $value)))
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    public static function keywords(array $values): array
    {
        return collect($values)
            ->map(fn (mixed $value): string => trim((string) $value))
            ->filter(fn (string $value): bool => $value !== '')
            ->unique()
            ->values()
            ->all();
    }

    public static function bounded(int $value, int $maximum): int
    {
        return max(1, min($maximum, $value));
    }
}
