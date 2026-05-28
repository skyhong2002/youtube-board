<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class KeywordGroupTrendRouteTest extends TestCase
{
    public function test_keyword_group_trend_page_builds_rolling_series_from_tag_period_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createTagMonthTable();
        $this->seedPositionTagPeriodCache();

        $response = $this->get('/keywords/柯文哲/groups/trends?view=position&days=2&from=2026-05-23&to=2026-05-24&type=total_views&today=0');

        $response->assertOk();
        $response->assertSee('柯文哲 依 政治立場 在 2 天的逐日線圖');
        $response->assertSee('觀看數');
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('2026-05-24');
        $response->assertSee('600');
        $response->assertSee('160');
        $response->assertSee('cache rows 2');
        $response->assertSee('parsed');
        $response->assertDontSee('api/tag_period.php');

        Carbon::setTestNow();
    }

    public function test_keyword_group_trend_supports_views_per_video_metric(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createTagMonthTable();
        $this->seedPositionTagPeriodCache();

        $response = $this->get('/keywords/柯文哲/groups/trends?group=position&days=2&from=2026-05-24&to=2026-05-24&type=views_video&today=0');

        $response->assertOk();
        $response->assertSee('觀注度');
        $response->assertSee('50');
        $response->assertSee('53');

        Carbon::setTestNow();
    }

    public function test_keyword_group_trend_reads_wrapped_and_list_shaped_period_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createTagMonthTable();

        DB::table('urt_show_tag_month')->insert([
            [
                'pk' => 1,
                'tag' => '柯文哲',
                'tagid' => '3',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-05-01',
                'count_videos' => 6,
                'total_views' => 300,
                'tags_result' => json_encode([
                    'result' => [
                        ['date' => '2026-05-23', 'tags_views' => 200, 'tags_video' => 4],
                        ['the_date' => '2026-05-24', 'tags_views' => 300, 'tags_video' => 6],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'tag' => '柯文哲',
                'tagid' => '4',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-05-01',
                'count_videos' => 2,
                'total_views' => 120,
                'tags_result' => json_encode([
                    'tags_result' => [
                        '2026-05-24' => ['tags_views' => 120, 'tags_video' => 2],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/keywords/柯文哲/groups/trends?view=position&days=2&from=2026-05-23&to=2026-05-24&type=total_views&today=0');

        $response->assertOk();
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('500');
        $response->assertSee('120');
        $response->assertSee('cache rows 2');
        $response->assertDontSee('api/tag_period.php');

        Carbon::setTestNow();
    }

    public function test_keyword_group_trend_reports_missing_cache_refresh_guidance(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createTagMonthTable();

        $response = $this->get('/keywords/柯文哲/groups/trends?group=position&days=7');

        $response->assertOk();
        $response->assertSee('目前沒有符合這組 keyword/group/date 的 tag period cache');
        $response->assertSee('keyword period cache refresh');
        $response->assertSee('即時儀表板');
        $response->assertSee('cache rows 0');

        Carbon::setTestNow();
    }

    public function test_keyword_group_trend_falls_back_to_daily_tag_date_cache_when_period_cache_is_absent(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        Schema::dropIfExists('urt_show_tag_month');
        $this->createTagDateTable();

        DB::table('urt_show_tag_date')->insert([
            [
                'pk' => 1,
                'tagid' => '3',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'tags_views' => json_encode(['毒駕' => 220], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['毒駕' => 4], JSON_UNESCAPED_UNICODE),
                'tags_result' => json_encode(['毒駕' => 12.5], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'tagid' => '4',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'tags_views' => json_encode(['毒駕' => 80], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['毒駕' => 2], JSON_UNESCAPED_UNICODE),
                'tags_result' => json_encode(['毒駕' => 4.5], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/keywords/毒駕/groups/trends?view=position&days=2&from=2026-05-23&to=2026-05-24&type=total_views');

        $response->assertOk();
        $response->assertSee('毒駕 依 政治立場 在 2 天的逐日線圖');
        $response->assertSee('220');
        $response->assertSee('80');
        $response->assertSee('cache rows 2');
        $response->assertDontSee('api/tag_period.php');

        Carbon::setTestNow();
    }

    public function test_legacy_tag_group_url_redirects_to_keyword_group_trend(): void
    {
        $this->get('/tag_group.php?tag=柯文哲&view=position&days=7&type=views_video')
            ->assertStatus(308)
            ->assertRedirect(route('keywords.groups.trends', [
                'keyword' => '柯文哲',
                'view' => 'position',
                'days' => '7',
                'type' => 'views_video',
            ]));
    }

    private function createTagMonthTable(): void
    {
        Schema::dropIfExists('urt_show_tag_month');

        Schema::create('urt_show_tag_month', function ($table): void {
            $table->integer('pk');
            $table->string('tag');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_month');
            $table->integer('count_videos')->nullable();
            $table->integer('total_views')->nullable();
            $table->text('tags_result')->nullable();
        });
    }

    private function createTagDateTable(): void
    {
        Schema::dropIfExists('urt_show_tag_date');

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->longText('tags_views')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    private function seedPositionTagPeriodCache(): void
    {
        DB::table('urt_show_tag_month')->insert([
            [
                'pk' => 1,
                'tag' => '柯文哲',
                'tagid' => '3',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-05-01',
                'count_videos' => 12,
                'total_views' => 600,
                'tags_result' => json_encode([
                    '2026-05-18' => ['tags_views' => 100, 'tags_video' => 2, 'total_views' => 100, 'count_videos' => 2],
                    '2026-05-23' => ['tags_views' => 200, 'tags_video' => 4, 'total_views' => 200, 'count_videos' => 4],
                    '2026-05-24' => ['tags_views' => 300, 'tags_video' => 6, 'total_views' => 300, 'count_videos' => 6],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'tag' => '柯文哲',
                'tagid' => '4',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-05-01',
                'count_videos' => 3,
                'total_views' => 160,
                'tags_result' => json_encode([
                    '2026-05-23' => ['tags_views' => 40, 'tags_video' => 1, 'total_views' => 40, 'count_videos' => 1],
                    '2026-05-24' => ['tags_views' => 120, 'tags_video' => 2, 'total_views' => 120, 'count_videos' => 2],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
