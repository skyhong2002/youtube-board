<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagTrendRouteTest extends TestCase
{
    public function test_tag_trend_page_reads_legacy_tag_date_cache_and_calculates_weekly_average(): void
    {
        $this->createTables();

        foreach ([
            ['2026-05-18', 2, 100],
            ['2026-05-19', 4, 200],
            ['2026-05-20', 6, 300],
            ['2026-05-21', 8, 500],
        ] as $index => [$date, $videos, $views]) {
            DB::table('urt_show_tag_date')->insert([
                'pk' => $index + 1,
                'the_date' => $date,
                'tagid' => '1',
                'tag_or' => '2,3',
                'tag_not' => '9',
                'count_channels' => 3,
                'count_videos' => $videos,
                'total_views' => $views,
            ]);
        }

        $response = $this->get('/tags/1/trends?or=3,2&not=9&type=average&from=2026-05-20&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('政治 綠 藍 在 1 天的每影片觀看折線圖');
        $response->assertSee('cache rows 4');
        $response->assertSee('2026-05-20');
        $response->assertSee('2026-05-21');
        $response->assertSee('50.0');
        $response->assertSee('55.0');
        $response->assertSee('or=3,2');
        $response->assertDontSee('legacy cache generation');
    }

    public function test_tag_trend_page_reports_missing_cache_with_cache_refresh_guidance(): void
    {
        $this->createTables();

        $response = $this->get('/tags/1/trends?from=2026-05-20&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('目前沒有符合條件的標籤趨勢 cache');
        $response->assertSee('cache rows 0');
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
            $table->date('the_date');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('total_views')->nullable();
        });

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '政治'],
            ['tag_id' => 2, 'tag_name' => '藍'],
            ['tag_id' => 3, 'tag_name' => '綠'],
        ]);
    }
}
