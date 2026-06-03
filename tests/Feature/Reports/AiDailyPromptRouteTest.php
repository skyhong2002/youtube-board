<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AiDailyPromptRouteTest extends TestCase
{
    public function test_ai_daily_prompt_preview_builds_ingestion_legacy_prompt(): void
    {
        $this->createTables();
        $this->seedPromptRows();

        $response = $this->get('/ai/days/2026-05-23/all/prompt?limit=20');

        $response->assertOk();
        $response->assertSee('2026-05-23 all AI daily prompt preview');
        $response->assertSee('媒體 3');
        $response->assertSee('事件數 8 - 10');
        $response->assertSee('Green Channel');
        $response->assertSee('Blue Channel');
        $response->assertSee('Finance Channel');
        $response->assertSee('毒駕事件');
        $response->assertSee('藍營事件');
        $response->assertSee('財經事件');
        $response->assertDontSee('單一事件');
        $response->assertDontSee('/redir/ai_day.php');
        $response->assertSee('readonly', false);
    }

    public function test_ai_daily_prompt_default_excludes_legacy_finance_and_world_tags(): void
    {
        $this->createTables();
        $this->seedPromptRows();

        $response = $this->get('/ai/days/2026-05-23/prompt');

        $response->assertOk();
        $response->assertSee('not=31,41');
        $response->assertSee('Green Channel');
        $response->assertSee('Blue Channel');
        $response->assertDontSee('Finance Channel');
    }

    public function test_ai_daily_prompt_condition_filters_channels_and_keeps_single_video_events(): void
    {
        $this->createTables();
        $this->seedPromptRows();

        $response = $this->get('/ai/days/2026-05-23/green/prompt?limit=20');

        $response->assertOk();
        $response->assertSee('condition=green');
        $response->assertSee('tagid=4');
        $response->assertSee('事件數 5 - 8');
        $response->assertSee('Green Channel');
        $response->assertSee('毒駕事件');
        $response->assertSee('單一事件');
        $response->assertDontSee('Blue Channel');
        $response->assertDontSee('Finance Channel');
    }

    public function test_ai_daily_prompt_preview_expands_wrapped_legacy_topic_payloads(): void
    {
        $this->createTables();

        DB::table('urt_channel')->insert(['u_id' => 40, 'title' => 'Wrapped Channel']);
        DB::table('urt_count')->insert(['u_id' => 40, 'tags' => '[4]']);
        DB::table('urt_channel_ai')->insert([
            'pk' => 103,
            'u_id' => 40,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'data_type' => 'oneday',
            'del_flag' => null,
            'result_json' => json_encode([
                'events' => [
                    [
                        '議題' => '包裝 prompt 事件',
                        '說明' => '包裝 prompt 描述。',
                        'keywords' => ['包裝', 'prompt'],
                        'video_id' => ['wrapped-a', 'wrapped-b'],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/ai/days/2026-05-24/all/prompt');

        $response->assertOk();
        $response->assertSee('Wrapped Channel');
        $response->assertSee('包裝 prompt 事件');
        $response->assertSee('包裝 prompt 描述');
        $response->assertSee('包裝, prompt');
    }

    private function createTables(): void
    {
        foreach (['urt_channel_ai', 'urt_channel', 'urt_count'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });
    }

    private function seedPromptRows(): void
    {
        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'title' => 'Green Channel'],
            ['u_id' => 20, 'title' => 'Blue Channel'],
            ['u_id' => 30, 'title' => 'Finance Channel'],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
            ['u_id' => 30, 'tags' => '[31]'],
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 100,
                'u_id' => 10,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '毒駕事件',
                        '描述' => '毒駕事件引起交通安全討論。',
                        '關鍵字' => ['毒駕', '交通'],
                        'videoId' => ['a', 'b'],
                    ],
                    [
                        '事件' => '單一事件',
                        '描述' => '單一影片事件只在非 all condition 保留。',
                        '關鍵字' => ['單一'],
                        'videoId' => ['c'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 101,
                'u_id' => 20,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '藍營事件',
                        '描述' => '藍營事件描述。',
                        '關鍵字' => ['藍營'],
                        'videoId' => ['d', 'e'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 102,
                'u_id' => 30,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '財經事件',
                        '描述' => '財經事件描述。',
                        '關鍵字' => ['財經'],
                        'videoId' => ['f', 'g'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
