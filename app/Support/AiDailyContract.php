<?php

namespace App\Support;

final class AiDailyContract
{
    public const OFFICIAL_ALL_MAX_TOKENS = 12_288;

    public const MIN_MEDIA_PER_TOPIC = 2;

    public const MAX_REPRESENTATIVE_MEDIA_PER_TOPIC = 6;

    public const REPRESENTATIVE_EVENTS_PER_MEDIA = 1;

    /**
     * Legacy `maint/get_ai_day.php` daily topic-count contract.
     *
     * @return array{min: int, max: int}
     */
    public static function bounds(string $condition): array
    {
        return $condition === 'all'
            ? ['min' => 15, 'max' => 20]
            : ['min' => 8, 'max' => 12];
    }

    public static function minTopics(string $condition): int
    {
        return self::bounds($condition)['min'];
    }

    public static function maxTopics(string $condition): int
    {
        return self::bounds($condition)['max'];
    }
}
