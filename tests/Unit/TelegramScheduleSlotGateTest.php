<?php

namespace Tests\Unit;

use App\Services\Notifications\TelegramScheduleSlotGate;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class TelegramScheduleSlotGateTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config()->set('services.telegram.dedup_store', 'array');
        Cache::store('array')->flush();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_claims_each_interval_once_without_requiring_the_exact_cron_minute(): void
    {
        Carbon::setTestNow('2026-07-30 17:11:00 UTC');
        $gate = app(TelegramScheduleSlotGate::class);

        $this->assertTrue($gate->claim('hourly', 10, 'UTC'));
        $this->assertFalse($gate->claim('hourly', 10, 'UTC'));

        Carbon::setTestNow('2026-07-30 17:19:59 UTC');
        $this->assertFalse($gate->claim('hourly', 10, 'UTC'));

        Carbon::setTestNow('2026-07-30 17:20:00 UTC');
        $this->assertTrue($gate->claim('hourly', 10, 'UTC'));
    }

    public function test_daily_slots_use_taipei_calendar_time(): void
    {
        Carbon::setTestNow('2026-07-30 16:31:00 UTC');
        $gate = app(TelegramScheduleSlotGate::class);

        $this->assertTrue($gate->claim('daily', 30, 'Asia/Taipei'));
        $this->assertFalse($gate->claim('daily', 30, 'Asia/Taipei'));

        Carbon::setTestNow('2026-07-30 17:00:00 UTC');
        $this->assertTrue($gate->claim('daily', 30, 'Asia/Taipei'));
    }
}
