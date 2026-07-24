<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LiveGroupReportsRouteTest extends TestCase
{
    public function test_live_group_hours_page_reads_legacy_hour_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createLiveTagCacheTable();
        $this->seedPositionLiveCache();

        $response = $this->get('/live/groups/position/hours?date=2026-05-24');

        $response->assertOk();
        $response->assertSee('政治立場 在 2026-05-24 每小時直播總人數');
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('10 時');
        $response->assertSee('200');
        $response->assertSee('400');
        $response->assertSee('cache rows 2');
        $response->assertDontSee('api_live_tag_date.php');

        Carbon::setTestNow();
    }

    public function test_keyword_live_trend_page_builds_rolling_group_series(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createLiveTagCacheTable();
        $this->seedPositionLiveCache();

        $response = $this->get('/keywords/柯文哲/live/trends?group=position&from=2026-05-23&to=2026-05-24&type=tags_views');

        $response->assertOk();
        $response->assertSee('柯文哲 依 政治立場 在 1 天的逐日直播線圖');
        $response->assertSee('直播觀看數');
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('2026-05-24');
        $response->assertSee('400');
        $response->assertSee('160');
        $response->assertDontSee('api_live_tag_date.php');

        Carbon::setTestNow();
    }

    public function test_legacy_live_group_and_keyword_urls_redirect_to_clean_routes(): void
    {
        $this->get('/lives_date.php?group=position&date=2026-05-24')
            ->assertStatus(308)
            ->assertRedirect(route('live.groups.hours', [
                'group' => 'position',
                'date' => '2026-05-24',
            ]));

        $this->get('/tag_live.php?tag=柯文哲&group=position&days=7&type=tags_video')
            ->assertStatus(308)
            ->assertRedirect(route('keywords.live.trends', [
                'keyword' => '柯文哲',
                'group' => 'position',
                'days' => '7',
                'type' => 'tags_video',
            ]));

        $this->get('/live_index.php?or=1,2')
            ->assertStatus(308)
            ->assertRedirect(route('live.current', [
                'or' => '1,2',
            ]));
    }

    public function test_live_group_hours_page_degrades_gracefully_for_calendar_invalid_date(): void
    {
        $this->createLiveTagCacheTable();

        $this->get('/live/groups/position/hours?date=2026-13-45')->assertOk();
        $this->get('/live/groups/position/hours?date=2026-02-30')->assertOk();
    }

    private function createLiveTagCacheTable(): void
    {
        Schema::dropIfExists('urt_show_live_tag_date');

        Schema::create('urt_show_live_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->text('hour_result')->nullable();
            $table->text('tags_video')->nullable();
            $table->text('tags_views')->nullable();
        });
    }

    private function seedPositionLiveCache(): void
    {
        DB::table('urt_show_live_tag_date')->insert([
            [
                'pk' => 1,
                'tagid' => '3',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-23',
                'hour_result' => json_encode(['10' => ['count' => 1, 'views' => 100]], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['柯文哲' => ['10' => 1]], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['柯文哲' => ['10' => 100, '11' => 150]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'tagid' => '3',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'hour_result' => json_encode(['10' => ['count' => 2, 'views' => 200]], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['柯文哲' => ['10' => 2]], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['柯文哲' => ['10' => 200, '11' => 250]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 3,
                'tagid' => '4',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-23',
                'hour_result' => json_encode(['10' => ['count' => 3, 'views' => 300]], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['柯文哲' => ['10' => 3]], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['柯文哲' => ['10' => 70]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 4,
                'tagid' => '4',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'hour_result' => json_encode(['10' => ['count' => 4, 'views' => 400]], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['柯文哲' => ['10' => 4]], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['柯文哲' => ['10' => 90]], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
