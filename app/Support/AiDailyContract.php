<?php

namespace App\Support;

final class AiDailyContract
{
    public const OFFICIAL_DAILY_MAX_TOKENS = 12_288;

    public const MIN_MEDIA_PER_TOPIC = 2;

    public const MAX_REPRESENTATIVE_MEDIA_PER_TOPIC = 6;

    public const REPRESENTATIVE_EVENTS_PER_MEDIA = 1;

    /**
     * Daily topic-count contract. The wide range is intentional: topics must be
     * single concrete news events, so the count follows the news day instead of
     * forcing distinct stories into a fixed number of buckets.
     *
     * @return array{min: int, max: int}
     */
    public static function bounds(string $condition): array
    {
        return $condition === 'all'
            ? ['min' => 5, 'max' => 40]
            : ['min' => 3, 'max' => 25];
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
