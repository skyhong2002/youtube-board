<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GroupMetricReportsRouteTest extends TestCase
{
    public function test_group_ranking_reads_tag_date_cache_for_legacy_group_chart(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 05:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedMediaCache();

        $response = $this->get('/groups/media/ranking?from=2026-05-22&to=2026-05-24');

        $response->assertOk();
        $response->assertSee('主要媒體 在 2天 的排行');
        $response->assertSee('旺中');
        $response->assertSee('TVBS');
        $response->assertSee('400');
        $response->assertSee('200');
        $response->assertSee('6');
        $response->assertSee('3');
        $response->assertSee('cache rows 4');
        $response->assertDontSee('api/cloud_tag_date.php');

        Carbon::setTestNow();
    }

    public function test_group_trend_reads_tag_date_cache_for_legacy_group_line(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 05:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedMediaCache();

        $response = $this->get('/groups/media/trends?from=2026-05-22&to=2026-05-24&type=total_views');

        $response->assertOk();
        $response->assertSee('主要媒體 在 2天 的逐日線圖');
        $response->assertSee('觀看數');
        $response->assertSee('旺中');
        $response->assertSee('TVBS');
        $response->assertSee('2026-05-24');
        $response->assertSee('410');
        $response->assertSee('200');
        $response->assertDontSee('api/cloud_tag_date.php');

        Carbon::setTestNow();
    }

    public function test_group_two_legacy_url_redirects_to_ingestion_position_trend(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 05:00:00', 'Asia/Taipei'));
        $this->createTables();
        DB::table('urt_show_tag_date')->insert([
            [
                'pk' => 10,
                'the_date' => '2026-05-23',
                'tagid' => '9,48',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 1,
                'total_views' => 10,
            ],
            [
                'pk' => 11,
                'the_date' => '2026-05-24',
                'tagid' => '9,48',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 2,
                'total_views' => 40,
            ],
            [
                'pk' => 12,
                'the_date' => '2026-05-23',
                'tagid' => '9,49',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 1,
                'total_views' => 20,
            ],
            [
                'pk' => 13,
                'the_date' => '2026-05-24',
                'tagid' => '9,49',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 3,
                'total_views' => 60,
            ],
        ]);

        $this->get('/group_two.php?from=2026-05-22&to=2026-05-24&type=total_views')
            ->assertStatus(308)
            ->assertRedirect(route('groups.trends', [
                'groupName' => 'two',
                'from' => '2026-05-22',
                'to' => '2026-05-24',
                'type' => 'total_views',
            ]));

        $response = $this->get('/groups/two/trends?from=2026-05-22&to=2026-05-24&type=total_views');

        $response->assertOk();
        $response->assertSee('台灣立場 vs 中國立場 在 2天 的逐日線圖');
        $response->assertSee('台灣立場 tagid=9,48');
        $response->assertSee('中國立場 tagid=9,49');
        $response->assertSee('50');
        $response->assertSee('80');
        $response->assertDontSee('api/cloud_tag_date.php');

        Carbon::setTestNow();
    }

    public function test_group_two_all_legacy_url_preserves_expanded_legacy_group_set(): void
    {
        $this->get('/group_two.php?all=1&days=30&type=count_videos')
            ->assertStatus(308)
            ->assertRedirect(route('groups.trends', [
                'groupName' => 'two_all',
                'days' => '30',
                'type' => 'count_videos',
            ]));
    }

    public function test_legacy_group_chart_and_line_urls_redirect_to_clean_group_reports(): void
    {
        $this->get('/group_chart.php?group=media&days=7&type=total_views')
            ->assertStatus(308)
            ->assertRedirect(route('groups.ranking', [
                'groupName' => 'media',
                'days' => '7',
                'type' => 'total_views',
            ]));

        $this->get('/group_line.php?group=media&days=7&type=count_videos')
            ->assertStatus(308)
            ->assertRedirect(route('groups.trends', [
                'groupName' => 'media',
                'days' => '7',
                'type' => 'count_videos',
            ]));
    }

    public function test_legacy_group_static_html_urls_redirect_to_dynamic_reports(): void
    {
        $this->get('/html/group_chart.html')
            ->assertStatus(308)
            ->assertRedirect(route('groups.ranking', [
                'groupName' => 'media',
                'days' => 7,
            ]));

        $this->get('/html/group_chart_30.html')
            ->assertStatus(308)
            ->assertRedirect(route('groups.ranking', [
                'groupName' => 'media',
                'days' => 30,
            ]));

        $this->get('/html/group_chart_all.html')
            ->assertStatus(308)
            ->assertRedirect(route('groups.ranking', [
                'groupName' => 'media_all',
                'days' => 30,
            ]));

        $this->get('/html/group_line.html?type=count_videos')
            ->assertStatus(308)
            ->assertRedirect(route('groups.trends', [
                'groupName' => 'media',
                'days' => 30,
                'type' => 'count_videos',
            ]));
    }

    private function createTables(): void
    {
        Schema::dropIfExists('urt_show_tag_date');

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->date('the_date');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('total_views')->nullable();
        });
    }

    private function seedMediaCache(): void
    {
        DB::table('urt_show_tag_date')->insert([
            [
                'pk' => 1,
                'the_date' => '2026-05-22',
                'tagid' => '53',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 1,
                'total_views' => 10,
            ],
            [
                'pk' => 2,
                'the_date' => '2026-05-23',
                'tagid' => '53',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 2,
                'total_views' => 100,
            ],
            [
                'pk' => 3,
                'the_date' => '2026-05-24',
                'tagid' => '53',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 4,
                'total_views' => 300,
            ],
            [
                'pk' => 4,
                'the_date' => '2026-05-23',
                'tagid' => '29',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 1,
                'total_views' => 50,
            ],
            [
                'pk' => 5,
                'the_date' => '2026-05-24',
                'tagid' => '29',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 1,
                'count_videos' => 3,
                'total_views' => 150,
            ],
        ]);
    }
}
