<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class HomeRouteTest extends TestCase
{
    public function test_home_page_renders_legacy_tag_index(): void
    {
        $this->createTagIndexTables();

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

        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee('所有分類列表');
        $response->assertSee('直播排行榜');
        $response->assertSee('個人社論');
        $response->assertSeeInOrder(['社論', '新聞', '直播']);
        $response->assertSee('400');
        $response->assertSee('200');
        $response->assertDontSee('本機尚未匯入');
    }

    public function test_home_page_hides_dev_check_link_outside_local_environments(): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        $this->createTagIndexTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
        ]);

        $response = $this->get('/');

        $response->assertOk();
        $response->assertDontSee('API 檢查');
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
}
