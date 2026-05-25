<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelAiDailyRouteTest extends TestCase
{
    public function test_channel_ai_daily_page_renders_latest_legacy_oneday_topics(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'date_from' => '2026-05-22 00:00:00',
                'date_to' => '2026-05-22 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '舊事件',
                        '描述' => '不應該被預設最新頁顯示。',
                        'videoId' => ['old123'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'u_id' => 10,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '毒駕事件',
                        '描述' => '毒駕事件引起交通安全討論。',
                        '分類' => '社會',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['卓榮泰'],
                        '地名' => ['新北'],
                        'videoId' => ['abc123', 'def456'],
                    ],
                    [
                        'topic' => '英文 fallback 事件',
                        'description' => 'English-key fallback content.',
                        'keywords' => ['fallback'],
                        'people' => ['王世堅'],
                        'places' => ['台北'],
                        'videos' => ['ghi789'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/channels/10/ai/days');

        $response->assertOk();
        $response->assertSee('Example Channel 2026-05-23 每日重點整理');
        $response->assertSee('2026-05-23 00:00:00 - 2026-05-23 23:59:59');
        $response->assertSee('毒駕事件');
        $response->assertSee('毒駕事件引起交通安全討論');
        $response->assertSee('毒駕');
        $response->assertSee('卓榮泰');
        $response->assertSee('影片數：2');
        $response->assertSee('https://i.ytimg.com/vi/abc123/default.jpg', false);
        $response->assertSee('英文 fallback 事件');
        $response->assertSee('fallback');
        $response->assertDontSee('舊事件');
    }

    public function test_channel_ai_daily_page_supports_legacy_date_and_week_type(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'date_from' => '2026-05-22 00:00:00',
                'date_to' => '2026-05-22 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    ['事件' => '指定日期事件', '描述' => '指定日期內容', 'videoId' => ['date123']],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'u_id' => 10,
                'date_from' => '2026-05-20 00:00:00',
                'date_to' => '2026-05-26 23:59:59',
                'data_type' => 'week',
                'del_flag' => null,
                'result_json' => json_encode([
                    ['事件' => '本週事件', '描述' => '本週內容', 'videoId' => ['week123']],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $this->get('/channels/10/ai/days/2026-05-22')
            ->assertOk()
            ->assertSee('指定日期事件')
            ->assertDontSee('本週事件');

        $this->get('/channels/10/ai/days?type=week')
            ->assertOk()
            ->assertSee('本週事件')
            ->assertSee('2026-05-20 00:00:00 - 2026-05-26 23:59:59')
            ->assertDontSee('指定日期事件');
    }

    public function test_channel_ai_daily_page_expands_wrapped_legacy_topic_payloads(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            'pk' => 3,
            'u_id' => 10,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'data_type' => 'oneday',
            'del_flag' => null,
            'result_json' => json_encode([
                'events' => [
                    [
                        '議題' => '包裝頻道事件',
                        '說明' => '這筆頻道 AI 資料包在 events key 裡。',
                        '類型' => '政治',
                        'keywords' => ['包裝', '頻道'],
                        'people' => ['測試人物'],
                        'places' => ['台中'],
                        'video_id' => 'channel-wrapped',
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/channels/10/ai/days/2026-05-24');

        $response->assertOk();
        $response->assertSee('包裝頻道事件');
        $response->assertSee('這筆頻道 AI 資料包在 events key 裡');
        $response->assertSee('政治');
        $response->assertSee('包裝');
        $response->assertSee('測試人物');
        $response->assertSee('台中');
        $response->assertSee('channel-wrapped');
    }

    private function createTables(): void
    {
        foreach (['urt_channel', 'urt_channel_ai'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);
    }
}
