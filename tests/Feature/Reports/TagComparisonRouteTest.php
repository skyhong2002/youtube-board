<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagComparisonRouteTest extends TestCase
{
    public function test_tag_comparison_reads_legacy_tag_date_json_and_builds_weekly_series(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '政治'],
        ]);

        foreach ([
            ['2026-05-18', 2, 100, 10],
            ['2026-05-19', 3, 200, 20],
            ['2026-05-20', 4, 300, 30],
            ['2026-05-21', 5, 400, 40],
        ] as $index => [$date, $videos, $views, $commentary]) {
            DB::table('urt_show_tag_date')->insert([
                'pk' => $index + 1,
                'ctime' => $date.' 00:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '9',
                'the_date' => $date,
                'count_channels' => 3,
                'count_videos' => $videos,
                'count_tags' => 2,
                'tags_count' => 2,
                'total_views' => $views * 10,
                'tags_result' => json_encode(['柯文哲' => 1.5, '侯友宜' => 2.5], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['柯文哲' => $videos, '侯友宜' => $videos + 1], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['柯文哲' => $views, '侯友宜' => $commentary], JSON_UNESCAPED_UNICODE),
            ]);
        }

        $response = $this->get('/tags/compare?tagid=1&not=9&tags=柯文哲,侯友宜&type=tags_views&from=2026-05-20&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('政治 多關鍵字趨勢比較');
        $response->assertSee('cache rows 4');
        $response->assertSee('tags=柯文哲,侯友宜');
        $response->assertSee('2026-05-20');
        $response->assertSee('2026-05-21');
        $response->assertSee('關鍵字文字雲');
        $response->assertSee('趨勢摘要');
        $response->assertSee('600');
        $response->assertSee('1,000');
        $response->assertSee('60');
        $response->assertSee('100');
        $response->assertDontSee('legacy cache generation');
    }

    public function test_tag_comparison_defaults_to_legacy_tag_one_when_no_filter_is_provided(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '政治'],
        ]);

        DB::table('urt_show_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-21 00:00:00',
            'tagid' => '1',
            'tag_or' => '',
            'tag_not' => '',
            'the_date' => '2026-05-21',
            'count_channels' => 3,
            'count_videos' => 2,
            'count_tags' => 1,
            'tags_count' => 1,
            'total_views' => 1000,
            'tags_result' => json_encode(['柯文哲' => 2.5], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['柯文哲' => 2], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['柯文哲' => 1000], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/tags/compare?tags=柯文哲&type=tags_view&from=2026-05-21&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('type=tags_views');
        $response->assertSee('tagid=1');
        $response->assertSee('1,000');
    }

    public function test_tag_comparison_aggregates_singleton_tag_cache_when_combined_tagid_cache_is_missing(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
        ]);

        foreach ([
            ['2026-05-20', '3', 100, 5],
            ['2026-05-20', '4', 10, 15],
            ['2026-05-21', '3', 200, 25],
            ['2026-05-21', '4', 20, 35],
        ] as $index => [$date, $tagId, $views, $otherViews]) {
            DB::table('urt_show_tag_date')->insert([
                'pk' => $index + 1,
                'ctime' => $date.' 00:00:00',
                'tagid' => $tagId,
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => $date,
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 2,
                'tags_count' => 2,
                'total_views' => $views * 10,
                'tags_result' => json_encode(['蔣萬安' => 1], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['蔣萬安' => 1], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['蔣萬安' => $views, '沈伯洋' => $otherViews], JSON_UNESCAPED_UNICODE),
            ]);
        }

        $response = $this->get('/tags/compare?tagid=3,4&tags=蔣萬安,沈伯洋&type=tags_views&from=2026-05-21&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('泛藍 泛綠 多關鍵字趨勢比較');
        $response->assertSee('cache rows 4');
        $response->assertSee('tagid=3,4');
        $response->assertSee('330');
        $response->assertSee('80');
        $response->assertDontSee('目前沒有符合條件的多關鍵字趨勢 cache');
    }

    public function test_tag_comparison_derives_requested_keywords_from_local_videos_when_cache_has_no_keyword_data(): void
    {
        $this->createTables();
        $this->createLocalVideoTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
        ]);

        DB::table('tags')->insert([
            ['tag' => '蔣萬安', 'max_count' => 10, 'hours_count' => 10, 'max_hours' => '2026-05-21 00:00:00', 'no_tag' => null],
            ['tag' => '交通', 'max_count' => 10, 'hours_count' => 10, 'max_hours' => '2026-05-21 00:00:00', 'no_tag' => null],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[3]'],
            ['u_id' => 20, 'tags' => '[4]'],
        ]);

        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'videoId' => 'blue-1',
                'publishedAt' => '2026-05-20 10:00:00',
                'title' => '蔣萬安市政',
                'description' => '',
                'viewCount' => 100,
            ],
            [
                'pk' => 2,
                'u_id' => 20,
                'videoId' => 'green-1',
                'publishedAt' => '2026-05-20 11:00:00',
                'title' => '蔣萬安交通',
                'description' => '',
                'viewCount' => 50,
            ],
            [
                'pk' => 3,
                'u_id' => 10,
                'videoId' => 'blue-2',
                'publishedAt' => '2026-05-21 10:00:00',
                'title' => '蔣萬安交通',
                'description' => '',
                'viewCount' => 200,
            ],
        ]);

        $response = $this->get('/tags/compare?tagid=3,4&tags=蔣萬安,交通&type=tags_views&from=2026-05-21&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('derived local video fallback');
        $response->assertSee('關鍵字文字雲');
        $response->assertSee('趨勢摘要');
        $response->assertSee('350');
        $response->assertSee('250');
        $response->assertDontSee('目前沒有符合條件的多關鍵字趨勢 cache');
    }

    public function test_tag_comparison_reports_empty_local_cache_with_cache_refresh_guidance(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '政治'],
        ]);

        $response = $this->get('/tags/compare?tags=柯文哲&type=tags_video&from=2026-05-20&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('cache rows 0');
        $response->assertSee('目前沒有符合條件的多關鍵字趨勢 cache');
    }

    public function test_legacy_tag_php_redirects_to_tag_comparison(): void
    {
        $this->get('/tag.php?tagid=1&tags=柯文哲,侯友宜&type=tags_video&days=10')
            ->assertStatus(308)
            ->assertRedirect(route('tags.compare', [
                'tagid' => '1',
                'tags' => '柯文哲,侯友宜',
                'type' => 'tags_video',
                'days' => '10',
            ]));
    }

    private function createTables(): void
    {
        foreach (['urt_show_tag_date', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->date('the_date');
            $table->integer('tags_count')->nullable();
            $table->integer('total_views')->nullable();
            $table->text('tags_result')->nullable();
            $table->text('tags_video')->nullable();
            $table->text('tags_views')->nullable();
        });
    }

    private function createLocalVideoTables(): void
    {
        foreach (['tags', 'urt_count', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->integer('max_count')->nullable();
            $table->integer('hours_count')->nullable();
            $table->dateTime('max_hours')->nullable();
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id')->nullable();
            $table->string('videoId')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
        });
    }
}
