<?php

use App\Services\Notifications\TelegramScheduleSlotGate;
use Illuminate\Support\Facades\Schedule;

if (config('ingestion.scheduler_enabled', false)) {
    Schedule::command('ingestion:run --execute --record')
        ->everyMinute()
        ->withoutOverlapping(10);
}

// Scheduled only when the channel push is explicitly enabled, so the digest
// never spends AI quota while disabled. Manual runs remain available anytime.
if (config('services.telegram.enabled', false)) {
    // The production scheduler is a `while true; schedule:run; sleep 60` loop,
    // so each cycle can skip an exact cron minute. Evaluate every minute and
    // claim a durable time slot before starting each digest command.
    Schedule::command('notify:telegram:digest --period=hourly')
        ->everyMinute()
        ->when(fn (): bool => app(TelegramScheduleSlotGate::class)->claim(
            'hourly',
            10,
            (string) config('app.timezone', 'UTC'),
        ))
        ->withoutOverlapping(15)
        ->runInBackground()
        ->appendOutputTo(storage_path('logs/telegram-digest.log'));

    Schedule::command('notify:telegram:digest --period=daily')
        ->everyMinute()
        ->timezone('Asia/Taipei')
        ->between('9:00', '21:00')
        ->when(fn (): bool => app(TelegramScheduleSlotGate::class)->claim('daily', 30, 'Asia/Taipei'))
        ->withoutOverlapping(15)
        ->runInBackground()
        ->appendOutputTo(storage_path('logs/telegram-digest.log'));
}
