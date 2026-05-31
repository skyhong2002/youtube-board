<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagDailyRelationRouteTest extends TestCase
{
    public function test_tag_daily_relation_page_reads_legacy_cache_with_cache_refresh_guidance(): void
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
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('class="lineage-panel" hidden', false);
        $response->assertSee('data-lineage-graph', false);
        $response->assertSee('YouTube Data API playlistItems.list', false);
        $response->assertSee('urt_show_tag_date cache');
        $response->assertSee('逐日標籤頁');
        $response->assertSee('cache rows 2');
        $response->assertSee('raw ranking');
        $response->assertSee('柯文哲');
        $response->assertSee('賴清德');
        $response->assertSee('頻道數');
        $response->assertSee('2,000');
        $response->assertDontSee('Laravel 目前以排程與快取資料呈現');
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

    public function test_keyword_daily_relation_page_derives_from_raw_video_keywords_when_cache_is_empty(): void
    {
        $this->createTables();
        $this->createRawKeywordTables();

        DB::table('tags')->insert([
            ['tag' => '少子化', 'no_tag' => null, 'hours_count' => 50],
            ['tag' => '托育', 'no_tag' => null, 'hours_count' => 40],
            ['tag' => '育兒', 'no_tag' => null, 'hours_count' => 30],
        ]);
        DB::table('urt_video')->insert([
            [
                'videoId' => 'birthrate-a',
                'u_id' => 10,
                'publishedAt' => '2026-05-21 10:00:00',
                'title' => '少子化 托育政策',
                'description' => '育兒補助',
                'viewCount' => 1200,
            ],
            [
                'videoId' => 'birthrate-b',
                'u_id' => 11,
                'publishedAt' => '2026-05-22 10:00:00',
                'title' => '少子化與育兒支持',
                'description' => '托育名額',
                'viewCount' => 800,
            ],
        ]);

        $response = $this->get('/keywords/%E5%B0%91%E5%AD%90%E5%8C%96/days?from=2026-05-21&to=2026-05-22&diff=0');

        $response->assertOk();
        $response->assertSee('少子化 在 1 天的逐日排行');
        $response->assertSee('cache rows 0');
        $response->assertSee('urt_video + tags derived real-time YouTube dashboard');
        $response->assertSee('托育');
        $response->assertSee('育兒');
        $response->assertDontSee('Laravel 目前以排程與快取資料呈現');
        $this->assertSame(0, DB::table('urt_show_video_tag_date')->count());
    }

    public function test_tag_daily_relation_page_derives_from_raw_video_keywords_when_cache_is_empty(): void
    {
        $this->createTables();
        $this->createRawTagDateTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '新聞'],
        ]);
        DB::table('tags')->insert([
            ['tag' => '少子化', 'no_tag' => null, 'max_count' => 20, 'hours_count' => 50, 'max_hours' => '2026-05-22 12:00:00'],
            ['tag' => '托育', 'no_tag' => null, 'max_count' => 15, 'hours_count' => 40, 'max_hours' => '2026-05-22 12:00:00'],
            ['tag' => '育兒', 'no_tag' => null, 'max_count' => 10, 'hours_count' => 30, 'max_hours' => '2026-05-22 12:00:00'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]'],
            ['u_id' => 11, 'tags' => '[1]'],
            ['u_id' => 12, 'tags' => '[9]'],
        ]);
        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'videoId' => 'birthrate-a',
                'u_id' => 10,
                'publishedAt' => '2026-05-21 10:00:00',
                'title' => '少子化 托育政策',
                'description' => '育兒補助',
                'viewCount' => 1200,
            ],
            [
                'pk' => 2,
                'videoId' => 'birthrate-b',
                'u_id' => 11,
                'publishedAt' => '2026-05-22 10:00:00',
                'title' => '少子化與育兒支持',
                'description' => '托育名額',
                'viewCount' => 800,
            ],
            [
                'pk' => 3,
                'videoId' => 'outside-tag',
                'u_id' => 12,
                'publishedAt' => '2026-05-22 10:00:00',
                'title' => '少子化 不應列入',
                'description' => '托育',
                'viewCount' => 500,
            ],
        ]);

        $response = $this->get('/tags/1/days?from=2026-05-21&to=2026-05-22&diff=0');

        $response->assertOk();
        $response->assertSee('新聞 在 1 天的逐日排行');
        $response->assertSee('cache rows 0');
        $response->assertSee('urt_video + urt_count + tags derived real-time YouTube dashboard');
        $response->assertSee('少子化');
        $response->assertSee('托育');
        $response->assertSee('育兒');
        $response->assertSee('1,200');
        $response->assertDontSee('不應列入');
        $response->assertDontSee('Laravel 會透過排程擷取與快取重建補齊即時儀表板資料');
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
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
        $response->assertSee('Laravel 會透過排程擷取與快取重建補齊即時儀表板資料');
    }

    public function test_legacy_daily_relation_urls_redirect_to_ingestion_pages(): void
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

    private function createRawKeywordTables(): void
    {
        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->integer('no_tag')->nullable();
            $table->integer('hours_count')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
        });
    }

    private function createRawTagDateTables(): void
    {
        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->integer('no_tag')->nullable();
            $table->integer('max_count')->nullable();
            $table->integer('hours_count')->nullable();
            $table->dateTime('max_hours')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->text('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->integer('pk');
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
        });
    }
}
