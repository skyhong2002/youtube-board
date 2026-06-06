<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class MayorPersonDailyRouteTest extends TestCase
{
    public function test_mayor_person_daily_page_reads_ai_cache_and_source_videos(): void
    {
        $this->createTables();
        $this->seedPageData();

        $response = $this->get('/mayor/cities/taipei/people/%E8%94%A3%E8%90%AC%E5%AE%89/days/2026-05-24');

        $response->assertOk();
        $response->assertSee('台北市 蔣萬安 每日 Dashboard');
        $response->assertSee('AI ready');
        $response->assertSee('每日 AI 摘要');
        $response->assertSee('蔣萬安今日市政聲量升高');
        $response->assertSee('媒體聚焦市政攻防');
        $response->assertSee('安排短影音回應');
        $response->assertSee('蔣萬安市政攻防');
        $response->assertSee('City News');
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('urt_mayor_person_ai');
    }

    public function test_mayor_city_page_links_candidates_to_daily_dashboards(): void
    {
        $this->createTables();
        $this->seedPageData();

        $response = $this->get('/mayor/cities/taipei?from=2026-05-24&to=2026-05-24');

        $response->assertOk();
        $response->assertSee('每日 Dashboard');
        $response->assertSee('/mayor/cities/taipei/people/%E8%94%A3%E8%90%AC%E5%AE%89?type=tags_views', false);
        $response->assertSee('/mayor/cities/taipei/people/%E6%B2%88%E4%BC%AF%E6%B4%8B?type=tags_views', false);
        $response->assertSee('/mayor/cities/taipei/people/%E8%94%A3%E8%90%AC%E5%AE%89/days/2026-05-24?type=tags_views', false);
        $response->assertSee('/mayor/cities/taipei/people/%E6%B2%88%E4%BC%AF%E6%B4%8B/days/2026-05-24?type=tags_views', false);
    }

    public function test_mayor_person_page_without_date_prefers_latest_ai_row(): void
    {
        $this->createTables();
        $this->seedPageData();
        DB::table('urt_show_tag_date')->insert([
            'pk' => 99,
            'tagid' => '3',
            'tag_or' => null,
            'tag_not' => null,
            'the_date' => '2026-05-25',
            'tags_views' => json_encode(['蔣萬安' => 9999], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['蔣萬安' => 9], JSON_UNESCAPED_UNICODE),
            'tags_result' => json_encode(['蔣萬安' => 9999], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/mayor/cities/taipei/people/%E8%94%A3%E8%90%AC%E5%AE%89');

        $response->assertOk();
        $response->assertSee('2026-05-24 · AI generated', false);
        $response->assertSee('AI ready');
    }

    private function createTables(): void
    {
        foreach (['urt_mayor_person_ai', 'urt_show_video_tag_date', 'urt_show_tag_date', 'urt_video', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_mayor_person_ai', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('city_key');
            $table->string('city_label');
            $table->string('person');
            $table->date('the_date');
            $table->string('ai_type')->nullable();
            $table->string('provider')->nullable();
            $table->string('user_token')->default('CLI');
            $table->text('prompt_json')->nullable();
            $table->text('source_json')->nullable();
            $table->text('result_json');
            $table->integer('del_flag')->nullable();
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->text('tags_views')->nullable();
            $table->text('tags_video')->nullable();
            $table->text('tags_result')->nullable();
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

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });
    }

    private function seedPageData(): void
    {
        DB::table('urt_tag')->insert([
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
            ['tag_id' => 5, 'tag_name' => '泛紅'],
            ['tag_id' => 6, 'tag_name' => '泛白'],
        ]);

        foreach ([3, 4, 5, 6] as $index => $tagId) {
            DB::table('urt_show_tag_date')->insert([
                'pk' => $index + 1,
                'tagid' => (string) $tagId,
                'tag_or' => null,
                'tag_not' => null,
                'the_date' => '2026-05-24',
                'tags_views' => json_encode($this->weights($tagId), JSON_UNESCAPED_UNICODE),
                'tags_video' => json_encode($this->videoWeights($tagId), JSON_UNESCAPED_UNICODE),
                'tags_result' => json_encode($this->weights($tagId), JSON_UNESCAPED_UNICODE),
            ]);
        }

        DB::table('urt_show_video_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'the_date' => '2026-05-24',
            'tag' => '蔣萬安',
            'count_videos' => 1,
            'count_tags' => 2,
            'count_channels' => 1,
            'videos_json' => json_encode(['jiang-video' => 10], JSON_UNESCAPED_UNICODE),
            'tags_json' => json_encode(['市政' => 2, '交通' => 1], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_video')->insert([
            'videoId' => 'jiang-video',
            'u_id' => 10,
            'channelTitle' => 'City News',
            'publishedAt' => '2026-05-24 10:00:00',
            'title' => '蔣萬安市政攻防',
            'description' => '蔣萬安交通政策',
            'viewCount' => 5000,
            'likeCount' => 50,
            'commentCount' => 20,
        ]);

        DB::table('urt_mayor_person_ai')->insert([
            'ctime' => '2026-05-24 16:35:00',
            'mtime' => '2026-05-24 16:36:00',
            'city_key' => 'taipei',
            'city_label' => '台北市',
            'person' => '蔣萬安',
            'the_date' => '2026-05-24',
            'ai_type' => 'qwen-test',
            'provider' => 'primary',
            'user_token' => 'CLI',
            'prompt_json' => '{}',
            'source_json' => '{}',
            'result_json' => json_encode([
                'summary' => '蔣萬安今日市政聲量升高。',
                'what_happened' => ['媒體聚焦市政攻防'],
                'risks' => [['level' => 'medium', 'item' => '攻防升溫', 'reason' => '代表影片留言增加']],
                'adjustments' => ['補一段市政成果說法'],
                'actions_today' => ['安排短影音回應'],
                'follow_up_metrics' => ['明日觀看數 delta'],
            ], JSON_UNESCAPED_UNICODE),
            'del_flag' => null,
        ]);
    }

    /**
     * @return array<string, int>
     */
    private function weights(int $tagId): array
    {
        return match ($tagId) {
            3 => ['蔣萬安' => 1000, '沈伯洋' => 50, '郭璽' => 10],
            4 => ['蔣萬安' => 80, '沈伯洋' => 900, '郭璽' => 10],
            5 => ['蔣萬安' => 300, '沈伯洋' => 60, '郭璽' => 20],
            default => ['蔣萬安' => 120, '沈伯洋' => 120, '郭璽' => 100],
        };
    }

    /**
     * @return array<string, int>
     */
    private function videoWeights(int $tagId): array
    {
        return match ($tagId) {
            3 => ['蔣萬安' => 4, '沈伯洋' => 1, '郭璽' => 1],
            4 => ['蔣萬安' => 1, '沈伯洋' => 4, '郭璽' => 1],
            default => ['蔣萬安' => 1, '沈伯洋' => 1, '郭璽' => 1],
        };
    }
}
