<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagDailyRelationRouteTest extends TestCase
{
    public function test_tag_daily_relation_page_reads_legacy_cache_without_generating_data(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '新聞'],
        ]);

        DB::table('urt_show_tag_date')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-21 00:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '9',
                'the_date' => '2026-05-21',
                'count_channels' => 5,
                'count_videos' => 10,
                'count_tags' => 3,
                'total_views' => 1000,
                'tags_result' => json_encode(['柯文哲' => 30, '交通' => 20, '新聞' => 999], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['柯文哲' => 3, '交通' => 2], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['柯文哲' => 300, '交通' => 200], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-22 00:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '9',
                'the_date' => '2026-05-22',
                'count_channels' => 6,
                'count_videos' => 12,
                'count_tags' => 3,
                'total_views' => 2000,
                'tags_result' => json_encode(['賴清德' => 40, '交通' => 10, '新聞' => 999], JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode(['賴清德' => 4, '交通' => 1], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['賴清德' => 400, '交通' => 100], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/tags/1/days?from=2026-05-21&to=2026-05-22&type=tags_result&diff=0&not=9');

        $response->assertOk();
        $response->assertSee('新聞 在 1 天的逐日排行');
        $response->assertSee('cache rows 2');
        $response->assertSee('raw ranking');
        $response->assertSee('柯文哲');
        $response->assertSee('賴清德');
        $response->assertSee('頻道數');
        $response->assertSee('2,000');
        $response->assertDontSee('Laravel 目前只讀取既有資料');
        $response->assertDontSee('search_query=%E6%96%B0%E8%81%9E', false);
    }

    public function test_keyword_daily_relation_page_reads_video_tag_date_cache(): void
    {
        $this->createTables();

        DB::table('urt_show_video_tag_date')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-21 00:00:00',
                'the_date' => '2026-05-21',
                'tag' => '蔡英文',
                'count_videos' => 8,
                'count_tags' => 2,
                'count_channels' => 3,
                'videos_json' => '{}',
                'tags_json' => json_encode(['賴清德' => 4, '新聞' => 99], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-22 00:00:00',
                'the_date' => '2026-05-22',
                'tag' => '蔡英文',
                'count_videos' => 10,
                'count_tags' => 2,
                'count_channels' => 4,
                'videos_json' => '{}',
                'tags_json' => json_encode(['蕭美琴' => 5, '新聞' => 99], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/days?from=2026-05-21&to=2026-05-22&diff=0');

        $response->assertOk();
        $response->assertSee('蔡英文 在 1 天的逐日排行');
        $response->assertSee('tag=蔡英文');
        $response->assertSee('賴清德');
        $response->assertSee('蕭美琴');
        $response->assertSee('cache rows 2');
        $response->assertDontSee('search_query=%E6%96%B0%E8%81%9E', false);
    }

    public function test_daily_relation_pages_read_wrapped_and_list_shaped_cache_payloads(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '新聞'],
        ]);

        DB::table('urt_show_tag_date')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-21 00:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-21',
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 2,
                'total_views' => 500,
                'tags_result' => json_encode([
                    'result' => [
                        ['tag' => '交通', 'count' => 12],
                        ['keyword' => '政策', 'weight' => 7],
                    ],
                ], JSON_UNESCAPED_UNICODE),
                'tags_video' => '{}',
                'tags_views' => '{}',
            ],
        ]);

        DB::table('urt_show_video_tag_date')->insert([
            [
                'pk' => 2,
                'ctime' => '2026-05-21 00:00:00',
                'the_date' => '2026-05-21',
                'tag' => '蔡英文',
                'count_videos' => 4,
                'count_tags' => 2,
                'count_channels' => 2,
                'videos_json' => '{}',
                'tags_json' => json_encode([
                    'tags' => [
                        ['word' => '外交', 'score' => 9],
                        ['tag' => '能源', 'value' => 6],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $tagResponse = $this->get('/tags/1/days?from=2026-05-21&to=2026-05-21&diff=0');

        $tagResponse->assertOk();
        $tagResponse->assertSee('交通');
        $tagResponse->assertSee('政策');

        $keywordResponse = $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/days?from=2026-05-21&to=2026-05-21&diff=0');

        $keywordResponse->assertOk();
        $keywordResponse->assertSee('外交');
        $keywordResponse->assertSee('能源');
    }

    public function test_tag_daily_relation_page_reports_empty_local_cache(): void
    {
        $this->createTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '新聞'],
        ]);

        $response = $this->get('/tags/1/days?from=2026-05-21&to=2026-05-22');

        $response->assertOk();
        $response->assertSee('cache rows 0');
        $response->assertSee('Laravel 目前只讀取既有資料');
    }

    public function test_legacy_daily_relation_urls_redirect_to_read_only_pages(): void
    {
        $this->get('/days.php?tagid=1&days=3&type=tags_video&not=9')
            ->assertStatus(308)
            ->assertRedirect(route('tags.days', [
                'tagId' => 1,
                'days' => '3',
                'type' => 'tags_video',
                'not' => '9',
            ]));

        $this->get('/tag_days.php?tag=蔡英文&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('keywords.days', [
                'keyword' => '蔡英文',
                'days' => '7',
            ]));
    }

    private function createTables(): void
    {
        foreach (['urt_show_tag_date', 'urt_show_video_tag_date', 'urt_tag'] as $table) {
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

        Schema::create('urt_show_video_tag_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('the_date');
            $table->string('tag');
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('count_channels')->nullable();
            $table->text('videos_json')->nullable();
            $table->text('tags_json')->nullable();
        });
    }
}
