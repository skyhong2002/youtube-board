<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class HomeRouteTest extends TestCase
{
    public function test_home_page_renders_overview_dashboard(): void
    {
        $this->createTagIndexTables();
        $this->createKeywordTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
            ['tag_id' => 3, 'tag_name' => '直播'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][2]', 'view_week' => 100],
            ['u_id' => 20, 'tags' => '[1]', 'view_week' => 300],
            ['u_id' => 30, 'tags' => '[2]', 'view_week' => 5],
            ['u_id' => 40, 'tags' => '[3]', 'view_week' => 80],
        ]);
        DB::table('tags')->insert([
            ['tag' => '柯文哲', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 1200, 'hours_count' => 80, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
        ]);

        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee('總覽');
        $response->assertSeeInOrder(['總覽', '直播', '分類', '關鍵字', '群組', 'AI', '市長']);
        $response->assertSee('YouTube Board 在做什麼');
        $response->assertSee('把公開 YouTube 頻道、直播、影片、關鍵字和主題群組整理成即時 YouTube 資料儀表板');
        $response->assertSee('看目前直播');
        $response->assertSee('/tags', false);
        $response->assertSee('/keywords', false);
        $response->assertSee('熱門分類');
        $response->assertSee('熱門關鍵字');
        $response->assertSee('/keywords/%E6%9F%AF%E6%96%87%E5%93%B2/videos', false);
        $response->assertSee('/tags/1/videos', false);
        $response->assertSee('/tags/1/trends', false);
        $response->assertSeeInOrder(['社論', '新聞', '直播']);
        $response->assertSee('400');
        $response->assertSee('580');
        $response->assertDontSee('本機尚未匯入');
    }

    public function test_home_page_links_to_public_integration_check_outside_local_environments(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        $this->createTagIndexTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
        ]);

        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee('整合檢查');
        $response->assertSee('/ops/integrations', false);
        $response->assertDontSee('/dev/check');
    }

    public function test_tags_url_uses_same_tag_index_and_safe_sort(): void
    {
        $this->createTagIndexTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]', 'view_week' => 100],
            ['u_id' => 20, 'tags' => '[2]', 'view_week' => 500],
        ]);

        $response = $this->get('/tags?sort=unknown&limit=1');

        $response->assertOk();
        $response->assertSee('sort=num');
        $response->assertSee('所有分類列表');
        $response->assertDontSee('分類報表');
        $response->assertSee('/tags?sort=total', false);
        $response->assertDontSee('關鍵字列表');
        $response->assertDontSee('多關鍵字趨勢');
        $response->assertDontSee('直播排行榜');
        $response->assertDontSee('帶狀直播');
        $response->assertSee('社論');
        $response->assertDontSee('新聞');
    }

    private function createTagIndexTables(): void
    {
        foreach (['urt_count', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
            $table->integer('view_week')->nullable();
        });
    }

    private function createKeywordTables(): void
    {
        foreach (['tags', 'urt_show_data'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->timestamp('ctime')->nullable();
            $table->timestamp('mtime')->nullable();
            $table->integer('max_count')->nullable();
            $table->integer('hours_count')->nullable();
            $table->timestamp('max_hours')->nullable();
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_show_data', function ($table): void {
            $table->string('data_name');
            $table->longText('the_result')->nullable();
        });
    }
}
