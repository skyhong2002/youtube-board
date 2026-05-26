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
        $response->assertSee('黃珊珊');
        $response->assertSee('陳時中');
        $response->assertSee('cache rows 52');
        $response->assertSee('候選人支持度趨勢');
        $response->assertSee('關鍵字趨勢');
        $response->assertDontSee('api/cloud_tag_date.php');
    }

    public function test_mayor_city_page_shows_unavailable_state_without_triggering_legacy_cache_generation(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();

        $response = $this->get('/mayor/cities/taipei?from=2026-05-20&to=2026-05-20');

        $response->assertOk();
        $response->assertSee('台北市候選人影片觀看支持度');
        $response->assertSee('api/cloud_tag_date.php');
        $response->assertSee('html_*.html');
        $response->assertSee('目前沒有可繪製的候選人趨勢資料');
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
            3 => ['蔣萬安' => 100, '黃珊珊' => 1, '陳時中' => 1],
            4 => ['蔣萬安' => 1, '黃珊珊' => 1, '陳時中' => 100],
            5 => ['蔣萬安' => 100, '黃珊珊' => 10, '陳時中' => 1],
            default => ['蔣萬安' => 1, '黃珊珊' => 100, '陳時中' => 1],
        };
    }
}
