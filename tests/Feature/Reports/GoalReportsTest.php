<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GoalReportsTest extends TestCase
{
    public function test_live_video_trend_expands_log_json(): void
    {
        $this->createLiveTrendTables();

        DB::table('urt_show_video_live')->insert([
            'pk_live' => 1,
            'videoId' => 'trend123',
            'u_id' => 10,
            'publishedAt' => '2026-05-23 10:00:00',
            'channelTitle' => 'Trend Channel',
            'title' => 'Trend Live Title',
            'thumbnails' => 'https://example.test/trend.jpg',
        ]);
        DB::table('urt_video_live')->insert([
            'videoId' => 'trend123',
            'u_id' => 10,
            'publishedAt' => '2026-05-23 10:00:00',
            'actualStartTime' => '2026-05-23 10:00:00',
            'actualEndTime' => null,
            'scheduledStartTime' => null,
            'concurrentViewers' => 321,
            'mtime' => '2026-05-24 18:00:00',
            'max_current' => 999,
            'del_flag' => null,
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'trend123',
                'u_id' => 10,
                'the_date' => '2026-05-23',
                'max_current' => 800,
                'log_json' => json_encode(['10:15' => 200, '10:45' => 500, '11:00' => 800]),
            ],
            [
                'videoId' => 'trend123',
                'u_id' => 10,
                'the_date' => '2026-05-24',
                'max_current' => 900,
                'log_json' => json_encode(['09:00' => 900]),
            ],
        ]);

        $response = $this->get('/live/videos/trend123/trend');

        $response->assertOk();
        $response->assertSee('Trend Live Title');
        $response->assertSee('每小時最高線上人數');
        $response->assertSee('每日最高線上人數');
        $response->assertSee('500');
        $response->assertSee('900');
    }

    public function test_tag_channel_ranking_filters_and_falls_back_to_safe_sort(): void
    {
        $this->createTagRankingTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
            ['tag_id' => 9, 'tag_name' => '排除'],
        ]);
        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'youtube_id' => 'UC10', 'title' => 'Included Channel', 'thumbnails' => 'https://example.test/10.jpg', 'flag_del' => null],
            ['u_id' => 20, 'youtube_id' => 'UC20', 'title' => 'Excluded Channel', 'thumbnails' => 'https://example.test/20.jpg', 'flag_del' => null],
        ]);
        DB::table('urt_count')->insert([
            [
                'u_id' => 10,
                'viewCount' => 1000,
                'subscriberCount' => 100,
                'videoCount' => 20,
                'view_week' => 100,
                'view_month' => 500,
                'views_pred_week' => 120,
                'views_pred_month' => 700,
                'sub_week' => 5,
                'sub_month' => 12,
                'video_week' => 3,
                'video_month' => 10,
                'tags' => '[1][2]',
            ],
            [
                'u_id' => 20,
                'viewCount' => 2000,
                'subscriberCount' => 200,
                'videoCount' => 40,
                'view_week' => 200,
                'view_month' => 900,
                'views_pred_week' => 220,
                'views_pred_month' => 1000,
                'sub_week' => 10,
                'sub_month' => 24,
                'video_week' => 6,
                'video_month' => 20,
                'tags' => '[1][9]',
            ],
        ]);

        $response = $this->get('/tags/1/channels?not=9&column=fb_count_month_median');

        $response->assertOk();
        $response->assertSee('社論 排行榜');
        $response->assertSee('sort=view_month');
        $response->assertSee('Included Channel');
        $response->assertDontSee('Excluded Channel');
        $response->assertSee('700');
        $response->assertSee('200');
    }

    public function test_channel_profile_renders_stats_tags_and_ai_json(): void
    {
        $this->createChannelProfileTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
        ]);
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Profile Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
            'publishedAt' => '2020-01-01 00:00:00',
            'description' => 'Channel description',
            'flag_del' => null,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 10,
            'viewCount' => 10000,
            'subscriberCount' => 1000,
            'videoCount' => 100,
            'view_week' => 500,
            'view_month' => 1000,
            'sub_week' => 20,
            'sub_month' => 80,
            'video_week' => 5,
            'video_month' => 20,
            'tags' => '[1][2]',
        ]);
        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'data_type' => 'oneday',
                'result_json' => json_encode([
                    [
                        '事件' => '重大事件',
                        '描述' => '事件描述',
                        '關鍵字' => ['關鍵字一'],
                        '人物' => ['人物一'],
                        'videoId' => ['video123'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
                'del_flag' => null,
            ],
            [
                'pk' => 2,
                'u_id' => 10,
                'date_from' => null,
                'date_to' => null,
                'data_type' => 'topic',
                'result_json' => json_encode(['topics' => [['title' => '最近主題', 'content' => '主題內容']]], JSON_UNESCAPED_UNICODE),
                'del_flag' => null,
            ],
            [
                'pk' => 3,
                'u_id' => 10,
                'date_from' => null,
                'date_to' => null,
                'data_type' => 'people',
                'result_json' => json_encode(['people' => [['name' => '人物二', 'sentiment' => '中立', 'content' => '提及內容', 'score' => 8]]], JSON_UNESCAPED_UNICODE),
                'del_flag' => null,
            ],
            [
                'pk' => 4,
                'u_id' => 10,
                'date_from' => null,
                'date_to' => null,
                'data_type' => 'aspect',
                'result_json' => json_encode([['items' => [['項目' => '議題角度', '偏好度' => '高', '描述' => '角度描述']]]], JSON_UNESCAPED_UNICODE),
                'del_flag' => null,
            ],
        ]);

        $response = $this->get('/channels/10');

        $response->assertOk();
        $response->assertSee('Profile Channel');
        $response->assertSee('這週觀看次數');
        $response->assertSee('500');
        $response->assertSee('社論');
        $response->assertSee('本機 `urt_log` 目前沒有可用資料');
        $response->assertSee('重大事件');
        $response->assertSee('最近主題');
        $response->assertSee('人物二');
        $response->assertSee('議題角度');
    }

    public function test_channel_profile_expands_wrapped_daily_ai_payloads(): void
    {
        $this->createChannelProfileTables();

        DB::table('urt_tag')->insert(['tag_id' => 1, 'tag_name' => '社論']);
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Profile Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
            'publishedAt' => '2020-01-01 00:00:00',
            'description' => 'Channel description',
            'flag_del' => null,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 10,
            'viewCount' => 10000,
            'subscriberCount' => 1000,
            'videoCount' => 100,
            'view_week' => 500,
            'view_month' => 1000,
            'sub_week' => 20,
            'sub_month' => 80,
            'video_week' => 5,
            'video_month' => 20,
            'tags' => '[1]',
        ]);
        DB::table('urt_channel_ai')->insert([
            'pk' => 5,
            'u_id' => 10,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'data_type' => 'oneday',
            'result_json' => json_encode([
                'events' => [
                    [
                        '議題' => '包裝 profile 事件',
                        '說明' => '包裝 profile 描述',
                        'keywords' => ['包裝'],
                        'people' => ['測試人物'],
                        'video_id' => 'profile-wrapped',
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'del_flag' => null,
        ]);

        $response = $this->get('/channels/10');

        $response->assertOk();
        $response->assertSee('包裝 profile 事件');
        $response->assertSee('包裝 profile 描述');
        $response->assertSee('測試人物');
        $response->assertSee('profile-wrapped');
    }

    private function createLiveTrendTables(): void
    {
        foreach (['urt_video_live_log', 'urt_show_video_live', 'urt_video_live'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_show_video_live', function ($table): void {
            $table->integer('pk_live');
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('channelTitle');
            $table->string('title');
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video_live', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->dateTime('actualStartTime')->nullable();
            $table->dateTime('scheduledStartTime')->nullable();
            $table->dateTime('actualEndTime')->nullable();
            $table->integer('concurrentViewers')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
            $table->integer('del_flag')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });
    }

    private function createTagRankingTables(): void
    {
        foreach (['urt_count', 'urt_channel', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });
        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->text('description')->nullable();
            $table->integer('flag_del')->nullable();
        });
        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->bigInteger('viewCount')->nullable();
            $table->integer('subscriberCount')->nullable();
            $table->integer('videoCount')->nullable();
            $table->integer('view_week')->nullable();
            $table->integer('view_month')->nullable();
            $table->integer('views_pred_week')->nullable();
            $table->integer('views_pred_month')->nullable();
            $table->integer('sub_week')->nullable();
            $table->integer('sub_month')->nullable();
            $table->integer('video_week')->nullable();
            $table->integer('video_month')->nullable();
            $table->string('tags')->nullable();
        });
    }

    private function createChannelProfileTables(): void
    {
        foreach (['urt_video', 'urt_channel_ai', 'urt_count', 'urt_channel', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        $this->createTagRankingTables();
        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('data_type');
            $table->text('result_json');
            $table->integer('del_flag')->nullable();
        });
        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
        });
    }
}
