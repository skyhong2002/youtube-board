<?php

namespace App\Support;

final class AiDailyContract
{
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
