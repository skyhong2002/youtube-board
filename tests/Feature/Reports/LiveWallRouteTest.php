<?php

namespace Tests\Feature\Reports;

use Tests\TestCase;

class LiveWallRouteTest extends TestCase
{
    public function test_live_wall_renders_legacy_live4_stream_set(): void
    {
        $response = $this->get('/live/walls/news?type=5');

        $response->assertOk();
        $response->assertSee('地震 同時四窗直播');
        $response->assertSee('KyT4qSK8lJo');
        $response->assertSee('q2OqoVjIZJY');
        $response->assertSee('meHTKm4XBS8');
        $response->assertSee('5cRG33-IVVg');
        $response->assertSee('https://www.youtube.com/embed/KyT4qSK8lJo', false);
    }

    public function test_live_wall_renders_china_and_alternate_legacy_sets(): void
    {
        $this->get('/live/walls/china')
            ->assertOk()
            ->assertSee('中國相關同時四窗直播')
            ->assertSee('dSgvHzDGX3k')
            ->assertSee('imuXJFb2Uh0');

        $this->get('/live/walls/alternate')
            ->assertOk()
            ->assertSee('備用同時四窗直播')
            ->assertSee('6dXQoQqG7o8')
            ->assertSee('fJKhyf4C8UY');
    }
}
