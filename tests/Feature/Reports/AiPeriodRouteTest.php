<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AiPeriodRouteTest extends TestCase
{
    public function test_ai_period_page_renders_cached_daily_topic_stats(): void
    {
        $this->createTable();

        DB::table('urt_ai_date')->insert([
            [
                'pk' => 10,
                'ctime' => '2026-05-22 01:00:00',
                'date_from' => '2026-05-22 00:00:00',
                'date_to' => '2026-05-22 23:59:59',
                'ai_type' => 'qwen',
                'data_type' => 'oneday',
                'condition_type' => 'all',
                'user_token' => 'CLI',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => json_encode([['標題' => '毒駕事件', '媒體事件' => []]], JSON_UNESCAPED_UNICODE),
                'data_json' => json_encode([
                    '毒駕事件' => [
                        '媒體數' => 2,
                        '影片數' => 5,
                        '關鍵字次數' => ['毒駕' => 3, '交通' => 2],
                        '人物' => ['卓榮泰' => 2],
                        '關鍵字' => ['毒駕' => 3, '交通' => 1],
                    ],
                ], JSON_UNESCAPED_UNICODE),
                'video_json' => null,
            ],
            [
                'pk' => 11,
                'ctime' => '2026-05-23 01:00:00',
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'ai_type' => 'qwen',
                'data_type' => 'oneday',
                'condition_type' => 'all',
                'user_token' => 'CLI',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => json_encode([['標題' => '國會改革', '媒體事件' => ['媒體A' => ['事件A'], '媒體B' => ['事件B']]]], JSON_UNESCAPED_UNICODE),
                'data_json' => null,
                'video_json' => null,
            ],
        ]);

        $response = $this->get('/ai/periods?from=2026-05-22&to=2026-05-23&condition=all');

        $response->assertOk();
        $response->assertSee('2026-05-22 - 2026-05-23 主要事件與各媒體報導');
        $response->assertSee('事件 2');
        $response->assertSee('毒駕事件');
        $response->assertSee('卓榮泰');
        $response->assertSee('5');
        $response->assertSee('國會改革');
        $response->assertSee('dashboard cache source');
    }

    public function test_ai_period_page_supports_month_query(): void
    {
        $this->createTable();

        DB::table('urt_ai_date')->insert([
            [
                'pk' => 20,
                'ctime' => '2026-05-01 01:00:00',
                'date_from' => '2026-05-01 00:00:00',
                'date_to' => '2026-05-01 23:59:59',
                'ai_type' => 'qwen',
                'data_type' => 'oneday',
                'condition_type' => 'all',
                'user_token' => 'CLI',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => json_encode([['標題' => '五月事件', '媒體事件' => []]], JSON_UNESCAPED_UNICODE),
                'data_json' => null,
                'video_json' => null,
            ],
        ]);

        $response = $this->get('/ai/periods?month=2026-05');

        $response->assertOk();
        $response->assertSee('2026年05月 的所有事件');
        $response->assertSee('五月事件');
        $response->assertSee('from=2026-05-01');
        $response->assertSee('to=2026-05-31');
    }

    public function test_ai_period_page_derives_wrapped_legacy_topic_payloads(): void
    {
        $this->createTable();

        DB::table('urt_ai_date')->insert([
            'pk' => 30,
            'ctime' => '2026-05-24 01:00:00',
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'ai_type' => 'qwen',
            'data_type' => 'oneday',
            'condition_type' => 'all',
            'user_token' => 'CLI',
            'del_flag' => null,
            'channel_id' => '{}',
            'result_json' => json_encode([
                'topics' => [
                    [
                        '議題' => '包裝期間事件',
                        'mediaEvents' => [
                            '媒體A' => ['事件A', '事件B'],
                        ],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'data_json' => null,
            'video_json' => null,
        ]);

        $response = $this->get('/ai/periods?from=2026-05-24&to=2026-05-24&condition=all');

        $response->assertOk();
        $response->assertSee('包裝期間事件');
        $response->assertSee('2026-05-24');
        $response->assertSee('2');
    }

    public function test_legacy_ai_period_url_redirects_to_period_report(): void
    {
        $this->get('/ai_period.php?from=2026-05-22&to=2026-05-23&condition=all')
            ->assertStatus(308)
            ->assertRedirect(route('ai.periods', [
                'from' => '2026-05-22',
                'to' => '2026-05-23',
                'condition' => 'all',
            ]));
    }

    private function createTable(): void
    {
        Schema::dropIfExists('urt_ai_date');

        Schema::create('urt_ai_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('condition_type')->nullable();
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('channel_id');
            $table->text('result_json');
            $table->text('data_json')->nullable();
            $table->longText('video_json')->nullable();
        });
    }
}
