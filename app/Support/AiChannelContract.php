<?php

namespace App\Support;

final class AiChannelContract
{
    /**
     * @return array{min: int, max: int}
     */
    public static function boundsForVideoCount(int $videoCount): array
    {
        $videoCount = max(0, $videoCount);
        $min = max(1, 3 + (int) floor($videoCount / 31));

        return [
            'min' => $min,
            'max' => max($min, 6 + (int) ceil($videoCount / 29)),
        ];
    }
}
