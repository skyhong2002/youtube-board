<?php

namespace App\Services\Notifications;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

class TelegramScheduleSlotGate
{
    public function claim(string $period, int $minutes, string $timezone): bool
    {
        $now = CarbonImmutable::now($timezone);
        $slot = intdiv((((int) $now->format('H')) * 60) + (int) $now->format('i'), $minutes);

        return Cache::store((string) config('services.telegram.dedup_store', 'database'))->add(
            'tg:schedule:'.$period.':'.$now->format('Ymd').':'.$slot,
            true,
            $now->addMinutes($minutes + 5),
        );
    }
}
