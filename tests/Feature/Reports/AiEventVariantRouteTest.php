<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AiEventVariantRouteTest extends TestCase
{
    public function test_ai_event_people_page_renders_people_and_media_rows_ingestion(): void
    {
        $this->createTables();
        $this->insertFixture();

        $response = $this->get('/ai/events/10/people?event=毒駕事件');

        $response->assertOk();
        $response->assertSee('毒駕事件 到 2026-05-23 的相關報導 人物觀點');
        $response->assertSee('逐日人物演變需要 `urt_ai_period`');
        $response->assertSee('卓榮泰');
        $response->assertSee('支持修法');
        $response->assertSee('ghi789');
        $response->assertSee('政論頻道');
        $response->assertSee('批評政府反應太慢');
        $response->assertDontSee('/redir/');
    }

    public function test_ai_event_wall_page_builds_video_wall_from_summary_and_people_json(): void
    {
        $this->createTables();
        $this->insertFixture();

        $response = $this->get('/ai/events/10/wall?event=毒駕事件');

        $response->assertOk();
        $response->assertSee('毒駕事件 到 2026-05-23 的相關報導 影片牆');
        $response->assertSee('https://i.ytimg.com/vi/abc123/mqdefault.jpg', false);
        $response->assertSee('https://i.ytimg.com/vi/def456/mqdefault.jpg', false);
        $response->assertSee('https://i.ytimg.com/vi/ghi789/mqdefault.jpg', false);
        $response->assertSee('毒駕事故造成傷亡');
        $response->assertSee('應加重刑責');
        $response->assertDontSee('/redir/');
    }

    private function createTables(): void
    {
        foreach (['urt_ai_period', 'urt_ai_event', 'urt_ai_date'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_ai_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('channel_id')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_ai_event', function ($table): void {
            $table->integer('pk');
            $table->integer('aipk');
            $table->string('event_name');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->string('prompt_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_ai_period', function ($table): void {
            $table->integer('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
        });
    }

    private function insertFixture(): void
    {
        DB::table('urt_ai_date')->insert([
            'pk' => 10,
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => '{}',
            'result_json' => '[]',
        ]);

        DB::table('urt_ai_event')->insert([
            [
                'pk' => 20,
                'aipk' => 10,
                'event_name' => '毒駕事件',
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'condition_type' => 'all',
                'prompt_type' => 'summary',
                'del_flag' => null,
                'result_json' => json_encode([
                    'events' => [
                        [
                            'event' => '毒駕事件',
                            'description' => '毒駕事件引起交通安全討論。',
                            'keywords' => ['毒駕', '交通'],
                            'media' => ['頭條開講'],
                            'fact' => [
                                ['media' => '頭條開講', 'headline' => '毒駕事故造成傷亡', 'video_id' => 'abc123'],
                            ],
                            'opinion' => [
                                ['media' => '政論頻道', 'stance' => '批評', 'intensity' => '高', 'content' => '應加重刑責', 'video_id' => 'def456'],
                            ],
                        ],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 21,
                'aipk' => 10,
                'event_name' => '毒駕事件',
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'condition_type' => 'all',
                'prompt_type' => 'people',
                'del_flag' => null,
                'result_json' => json_encode([
                    'main_subject' => '毒駕',
                    'supporting_persons' => [
                        [
                            'person' => '卓榮泰',
                            'role' => '行政院',
                            'support_or_opposition' => '支持',
                            'strength' => '中',
                            'description' => '支持修法。',
                            'videos' => [['media' => '頭條開講', 'video_id' => 'ghi789']],
                        ],
                    ],
                    'opposing_persons' => [],
                    'other_opinions_persons' => [],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 22,
                'aipk' => 10,
                'event_name' => '毒駕事件',
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'condition_type' => 'all',
                'prompt_type' => 'media',
                'del_flag' => null,
                'result_json' => json_encode([
                    'main_subject' => '毒駕',
                    'opposing_medias' => [
                        [
                            'media' => '政論頻道',
                            'strength' => '強',
                            'description' => '批評政府反應太慢。',
                            'support_or_opposition' => '反對',
                        ],
                    ],
                    'supporting_medias' => [],
                    'all_medias' => ['頭條開講', '政論頻道'],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
