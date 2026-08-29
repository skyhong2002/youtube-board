<?php

namespace Tests\Feature\Reports;

use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MayorReportRouteTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_mayor_city_page_renders_legacy_candidate_support_from_tag_date_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();
        $this->seedTaipeiCache('2026-05-08', '2026-05-20');

        $response = $this->get('/mayor/cities/taipei?from=2026-05-20&to=2026-05-20&type=tags_views');

        $response->assertOk();
        $response->assertSee('台北市候選人影片觀看支持度');
        $response->assertSee('蔣萬安');
        $response->assertSee('沈伯洋');
        $response->assertSee('郭璽');
        $response->assertSee('蔣萬安<small>（中國國民黨）</small>', false);
        $response->assertSee('沈伯洋<small>（民主進步黨）</small>', false);
        $response->assertSee('郭璽<small>（麻將黨）</small>', false);
        $response->assertSee('background: #2563eb', false);
        $response->assertSee('background: #16a34a', false);
        $response->assertSee('background: #7c3aed', false);
        $response->assertDontSee('郭璽<small>（其他）</small>', false);
        $response->assertDontSee('蔣萬安<small>（泛藍）</small>', false);
        $response->assertSee('泛藍係數');
        $response->assertSee('泛綠係數');
        $response->assertSee('泛紅係數');
        $response->assertSee('泛白係數');
        $response->assertDontSee('factor tag 3');
        $response->assertSee('cache rows 52');
        $response->assertSee('候選人支持度趨勢');
        $response->assertSee('關鍵字趨勢');
        $response->assertSee('/tags/compare?tagid=3%2C4%2C5%2C6&amp;tags=%E8%94%A3%E8%90%AC%E5%AE%89&amp;type=tags_views&amp;days=30&amp;from=2026-05-20&amp;to=2026-05-20', false);
        $response->assertDontSee('api/cloud_tag_date.php');
    }

    public function test_mayor_city_support_percentages_do_not_use_negative_weighted_scores_as_support(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();

        DB::table('urt_show_tag_date')->insert([
            'pk' => 1,
            'tagid' => '4',
            'tag_or' => null,
            'tag_not' => null,
            'the_date' => '2026-05-20',
            'total_views' => 200000,
            'count_videos' => 10,
            'count_channels' => 2,
            'tags_views' => json_encode(['謝國樑' => 100000, '童子瑋' => 100000], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode([], JSON_UNESCAPED_UNICODE),
            'tags_result' => json_encode([], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/mayor/cities/keelung?from=2026-05-20&to=2026-05-20&type=tags_views');

        $response->assertOk();
        $response->assertSee('0.00%');
        $response->assertSee('-90,000.00');
        $response->assertSee('100.00%');
        $response->assertSee('300,000.00');
        $response->assertDontSee('-42.86%');
        $response->assertDontSee('142.86%');
    }

    public function test_mayor_city_page_shows_unavailable_state_with_cache_refresh_guidance(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();

        $response = $this->get('/mayor/cities/taipei?from=2026-05-20&to=2026-05-20');

        $response->assertOk();
        $response->assertSee('台北市候選人影片觀看支持度');
        $response->assertSee('mayor cache refresh');
        $response->assertSee('動態儀表板資料');
        $response->assertSee('目前沒有可繪製的候選人趨勢資料');
    }

    public function test_mayor_city_page_defaults_to_video_metric_when_view_metric_has_no_candidate_data(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();

        DB::table('urt_show_tag_date')->insert([
            'pk' => 1,
            'tagid' => '4',
            'tag_or' => null,
            'tag_not' => null,
            'the_date' => '2026-05-20',
            'total_views' => 0,
            'count_videos' => 1,
            'count_channels' => 1,
            'tags_views' => json_encode([], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['陳瑩' => 1], JSON_UNESCAPED_UNICODE),
            'tags_result' => json_encode([], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/mayor/cities/taitung?from=2026-05-20&to=2026-05-20');

        $response->assertOk();
        $response->assertSee('影片數 · 2026-05-20 - 2026-05-20');
        $response->assertSee('候選人支持度趨勢');
        $response->assertDontSee('目前沒有符合這組 city/date/type');
    }

    public function test_mayor_index_defaults_to_latest_imported_tag_date_cache_when_yesterday_is_empty(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();
        $this->seedTaipeiCache('2026-05-08', '2026-05-10');

        $response = $this->get('/mayor');

        $response->assertOk();
        $response->assertSee('台北市候選人影片觀看支持度');
        $response->assertSee('2026-05-10');
        $response->assertSee('候選人支持度趨勢');
        $response->assertDontSee('api/cloud_tag_date.php');
        $response->assertDontSee('html_*.html');
    }

    public function test_mayor_city_page_marks_cache_gaps_as_pending_instead_of_zero(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();
        $this->seedTaipeiCache('2026-05-01', '2026-05-01');

        $response = $this->get('/mayor/cities/taipei?from=2026-05-01&to=2026-05-20&type=tags_video');

        $response->assertOk();
        $response->assertSee('缺少 19 天');
        $response->assertSee('最後涵蓋日期為 2026-05-01');
        $response->assertSee('待更新');
        $response->assertDontSee('2026-05-20</th>\n                                                                    <td class="number ">0.00%', false);
    }

    public function test_mayor_nav_and_city_page_cover_current_county_city_candidate_list(): void
    {
        $this->createTagDateCacheTable();

        $response = $this->get('/mayor/cities/kinmen?from=2026-05-20&to=2026-05-20');

        $response->assertOk();
        $response->assertSee('<details class="city-group" open>', false);
        $response->assertSee('北部');
        $response->assertSee('中部');
        $response->assertSee('南部');
        $response->assertSee('東部');
        $response->assertSee('離島');
        $response->assertSee('台北市');
        $response->assertSee('新北市');
        $response->assertSee('桃園市');
        $response->assertSee('台中市');
        $response->assertSee('台南市');
        $response->assertSee('高雄市');
        $response->assertSee('新竹縣');
        $response->assertSee('嘉義市');
        $response->assertSee('金門縣候選人影片觀看支持度');
        $response->assertSee('陳玉珍');
        $response->assertSee('楊鎮浯');
        $response->assertSee('李文良');
    }

    public function test_mayor_legacy_dynamic_url_redirects_to_clean_city_route(): void
    {
        $response = $this->get('/mayor/city.php?city=taichung&days=7&type=tags_video');

        $response->assertRedirect('/mayor/cities/taichung?days=7&type=tags_video');
        $this->assertSame(308, $response->getStatusCode());
    }

    public function test_mayor_legacy_city_config_url_redirects_to_clean_city_route(): void
    {
        $response = $this->get('/mayor/taipei.php?days=30&type=tags_result&today=1');

        $response->assertRedirect('/mayor/cities/taipei?days=30&type=tags_result&today=1');
        $this->assertSame(308, $response->getStatusCode());
    }

    public function test_mayor_legacy_static_url_redirects_to_clean_city_route(): void
    {
        $response = $this->get('/mayor/html_taipei.html?days=30');

        $response->assertRedirect('/mayor/cities/taipei?days=30');
        $this->assertSame(308, $response->getStatusCode());
    }

    private function createTagDateCacheTable(): void
    {
        Schema::dropIfExists('urt_show_tag_date');

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->integer('total_views')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_channels')->nullable();
            $table->longText('tags_views')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    private function seedTaipeiCache(string $from, string $to): void
    {
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');
        $pk = 1;

        while ($cursor <= $end) {
            foreach ([3, 4, 5, 6] as $tagId) {
                DB::table('urt_show_tag_date')->insert([
                    'pk' => $pk++,
                    'tagid' => (string) $tagId,
                    'tag_or' => null,
                    'tag_not' => null,
                    'the_date' => $cursor->toDateString(),
                    'total_views' => 1000,
                    'count_videos' => 10,
                    'count_channels' => 3,
                    'tags_views' => json_encode($this->candidateWeights($tagId), JSON_UNESCAPED_UNICODE),
                    'tags_video' => json_encode($this->candidateWeights($tagId), JSON_UNESCAPED_UNICODE),
                    'tags_result' => json_encode($this->candidateWeights($tagId), JSON_UNESCAPED_UNICODE),
                ]);
            }

            $cursor = $cursor->addDay();
        }
    }

    /**
     * @return array<string, int>
     */
    private function candidateWeights(int $tagId): array
    {
        return match ($tagId) {
            3 => ['蔣萬安' => 100, '沈伯洋' => 1, '郭璽' => 1],
            4 => ['蔣萬安' => 1, '沈伯洋' => 100, '郭璽' => 1],
            5 => ['蔣萬安' => 100, '沈伯洋' => 1, '郭璽' => 10],
            default => ['蔣萬安' => 1, '沈伯洋' => 1, '郭璽' => 100],
        };
    }
}
