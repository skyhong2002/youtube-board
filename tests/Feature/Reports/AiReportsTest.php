<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AiReportsTest extends TestCase
{
    public function test_ai_daily_page_renders_collapsed_lineage_profile(): void
    {
        $response = $this->get('/ai/days/2026-05-24/all');

        $response->assertOk();
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('class="lineage-panel" hidden', false);
        $response->assertSee('data-lineage-graph', false);
        $response->assertSee('urt_ai_date');
        $response->assertSee('urt_channel_ai');
        $response->assertSee('ai:daily --execute --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000');
        $response->assertSee('OpenCode-compatible chat completions');
        $response->assertSee('AI condition rules');
        $response->assertSee('AiDailyReport');
    }

    public function test_ai_daily_page_combines_daily_topics_with_channel_ai_events(): void
    {
        $this->createAiDailyTables();

        DB::table('urt_ai_date')->insert([
            'pk' => 10,
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([
                15 => '頭條開講',
                20 => '政論頻道',
            ], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([
                [
                    '標題' => '毒駕與交通安全',
                    '媒體事件' => [
                        '頭條開講' => ['毒駕事故頻傳'],
                        '政論頻道' => ['交通法規修正'],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 100,
                'u_id' => 15,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '毒駕事故頻傳',
                        '描述' => '毒駕事故造成民眾關注。',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['卓榮泰'],
                        'videoId' => ['abc123', 'def456'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 101,
                'u_id' => 20,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '交通法規修正',
                        '描述' => '政府研擬加重刑責。',
                        '角度' => '台灣',
                        '陣營' => '國民黨',
                        '關鍵字' => ['交通', '修法'],
                        '人物' => ['王世堅'],
                        'videoId' => ['ghi789'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 15, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
        ]);
        foreach ([15 => 'green', 20 => 'blue'] as $uId => $prefix) {
            for ($index = 1; $index <= 2; $index++) {
                DB::table('urt_video')->insert([
                    'u_id' => $uId,
                    'videoId' => $prefix.'-raw-'.$index,
                    'publishedAt' => '2026-05-23 0'.$index.':00:00',
                    'title' => ucfirst($prefix).' Raw '.$index,
                ]);
            }
        }

        $response = $this->get('/ai/days/2026-05-23/all');

        $response->assertOk();
        $response->assertSee('2026-05-23 主要事件與各媒體報導');
        $response->assertSee('Raw 收錄');
        $response->assertSee('urt_video rows');
        $response->assertSee('1 / 2 channels · 1 events');
        $response->assertSee('1 topics');
        $response->assertSee('毒駕與交通安全');
        $response->assertSee('媒體數：2 個 / 影片數：3 則');
        $response->assertSee('毒駕(1)');
        $response->assertSee('卓榮泰(1)');
        $response->assertSee('頭條開講');
        $response->assertSee('毒駕事故頻傳');
        $response->assertSee('(2 則)');
        $response->assertSee('政論頻道');
        $response->assertSee('https://www.youtube.com/embed/abc123', false);
    }

    public function test_ai_daily_page_expands_wrapped_legacy_topic_payloads(): void
    {
        $this->createAiDailyTables();

        DB::table('urt_ai_date')->insert([
            'pk' => 11,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([15 => '頭條開講'], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([
                'topics' => [
                    [
                        '議題' => '包裝格式每日事件',
                        'mediaEvents' => [
                            '頭條開講' => ['包裝事件A'],
                        ],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_channel_ai')->insert([
            'pk' => 110,
            'u_id' => 15,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'del_flag' => null,
            'result_json' => json_encode([
                'events' => [
                    [
                        '議題' => '包裝事件A',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        'keywords' => ['包裝', '每日'],
                        'people' => ['測試人物'],
                        'video_id' => 'wrapped-daily',
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_count')->insert(['u_id' => 15, 'tags' => '[4]']);

        $response = $this->get('/ai/days/2026-05-24/all');

        $response->assertOk();
        $response->assertSee('包裝格式每日事件');
        $response->assertSee('包裝(1)');
        $response->assertSee('測試人物(1)');
        $response->assertSee('wrapped-daily');
    }

    public function test_ai_daily_page_regroups_fragmented_daily_rows_from_channel_ai(): void
    {
        $this->createAiDailyTables();

        DB::table('urt_channel')->insert([
            ['u_id' => 15, 'title' => '頭條開講'],
            ['u_id' => 20, 'title' => '政論頻道'],
            ['u_id' => 30, 'title' => '社會頻道'],
        ]);

        DB::table('urt_ai_date')->insert([
            'pk' => 119,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([
                15 => '頭條開講',
                20 => '政論頻道',
                30 => '社會頻道',
            ], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode(collect(range(1, 11))
                ->map(fn (int $index): array => [
                    '標題' => '碎片議題'.$index,
                    '媒體事件' => [
                        '頭條開講' => ['碎片事件'.$index],
                    ],
                ])
                ->all(), JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1190,
                'u_id' => 15,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '毒駕事故後續',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['行政院'],
                        'videoId' => ['regroup-a', 'regroup-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 1191,
                'u_id' => 20,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '交通安全與毒駕檢討',
                        '角度' => '台灣',
                        '陣營' => '國民黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['行政院'],
                        'videoId' => ['regroup-c', 'regroup-d'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 1192,
                'u_id' => 30,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => 'T-34墜機',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['T-34', '墜機'],
                        '人物' => [],
                        'videoId' => ['regroup-e', 'regroup-f'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 15, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
            ['u_id' => 30, 'tags' => '[4]'],
        ]);

        $response = $this->get('/ai/days/2026-05-24/all');

        $response->assertOk();
        $response->assertSee('毒駕事故後續');
        $response->assertSee('交通安全與毒駕檢討');
        $response->assertSee('媒體數：2 個 / 影片數：4 則');
        $response->assertSee('T-34墜機');
        $response->assertSee('媒體數：1 個 / 影片數：2 則');
        $response->assertSee('regroup-a');
        $response->assertSee('regroup-e');
        $response->assertDontSee('碎片議題1');
        $response->assertDontSee('碎片事件1');
    }

    public function test_ai_daily_page_assembles_ingestion_fallback_from_channel_ai_when_daily_summary_is_missing(): void
    {
        $this->createAiDailyTables();

        DB::table('urt_channel')->insert([
            ['u_id' => 15, 'title' => '頭條開講'],
            ['u_id' => 20, 'title' => '政論頻道'],
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 120,
                'u_id' => 15,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '毒駕事故後續',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['行政院'],
                        'videoId' => ['fallback-daily-a', 'fallback-daily-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 121,
                'u_id' => 20,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '交通安全與毒駕檢討',
                        '角度' => '台灣',
                        '陣營' => '國民黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['行政院'],
                        'videoId' => ['fallback-daily-c', 'fallback-daily-d'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 15, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
        ]);

        $response = $this->get('/ai/days/2026-05-24/all');

        $response->assertOk();
        $response->assertSee('毒駕事故後續');
        $response->assertSee('交通安全與毒駕檢討');
        $response->assertSee('媒體數：2 個 / 影片數：4 則');
        $response->assertSee('毒駕(2)');
        $response->assertSee('行政院(2)');
        $response->assertSee('fallback-daily-a');
        $response->assertDontSee('目前沒有符合條件的 AI daily summary');
    }

    public function test_ai_daily_page_uses_channel_ai_fallback_when_daily_summary_row_is_empty(): void
    {
        $this->createAiDailyTables();

        DB::table('urt_channel')->insert([
            ['u_id' => 15, 'title' => 'Fallback Channel'],
            ['u_id' => 20, 'title' => 'Second Fallback Channel'],
        ]);

        DB::table('urt_ai_date')->insert([
            'pk' => 121,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([15 => 'Fallback Channel'], JSON_UNESCAPED_UNICODE),
            'result_json' => '[]',
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1210,
                'u_id' => 15,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '空 daily row fallback',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['fallback', 'daily'],
                        '人物' => ['行政院'],
                        'videoId' => ['empty-row-fallback-a', 'empty-row-fallback-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 1211,
                'u_id' => 20,
                'date_from' => '2026-05-24 00:00:00',
                'date_to' => '2026-05-24 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => 'daily fallback 第二媒體',
                        '角度' => '台灣',
                        '陣營' => '國民黨',
                        '關鍵字' => ['fallback', 'daily'],
                        '人物' => ['行政院'],
                        'videoId' => ['empty-row-fallback-c', 'empty-row-fallback-d'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 15, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
        ]);

        $response = $this->get('/ai/days/2026-05-24/all');

        $response->assertOk();
        $response->assertSee('空 daily row fallback');
        $response->assertSee('daily fallback 第二媒體');
        $response->assertSee('媒體數：2 個 / 影片數：4 則');
        $response->assertSee('empty-row-fallback-a');
        $response->assertDontSee('目前沒有符合條件的 AI daily summary');
        $response->assertSee('pk=121');
        $response->assertSee('/ai/events/121?event=', false);
    }

    public function test_ai_daily_index_uses_latest_date_channel_ai_fallback_when_latest_daily_summary_row_is_empty(): void
    {
        $this->createAiDailyTables();

        DB::table('urt_channel')->insert([
            ['u_id' => 15, 'title' => 'Fallback Channel'],
            ['u_id' => 20, 'title' => 'Second Fallback Channel'],
        ]);

        DB::table('urt_ai_date')->insert([
            'pk' => 122,
            'date_from' => '2026-05-25 00:00:00',
            'date_to' => '2026-05-25 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([15 => 'Fallback Channel'], JSON_UNESCAPED_UNICODE),
            'result_json' => '[]',
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1220,
                'u_id' => 15,
                'date_from' => '2026-05-25 00:00:00',
                'date_to' => '2026-05-25 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => 'latest index fallback',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['latest', 'fallback'],
                        '人物' => ['行政院'],
                        'videoId' => ['latest-index-fallback-a', 'latest-index-fallback-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 1221,
                'u_id' => 20,
                'date_from' => '2026-05-25 00:00:00',
                'date_to' => '2026-05-25 23:59:59',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => 'latest fallback 第二媒體',
                        '角度' => '台灣',
                        '陣營' => '國民黨',
                        '關鍵字' => ['latest', 'fallback'],
                        '人物' => ['行政院'],
                        'videoId' => ['latest-index-fallback-c', 'latest-index-fallback-d'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 15, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
        ]);

        $response = $this->get('/ai/days');

        $response->assertOk();
        $response->assertSee('2026-05-25 主要事件與各媒體報導');
        $response->assertSee('latest index fallback');
        $response->assertSee('latest fallback 第二媒體');
        $response->assertSee('媒體數：2 個 / 影片數：4 則');
        $response->assertSee('latest-index-fallback-a');
        $response->assertDontSee('目前沒有符合條件的 AI daily summary');
        $response->assertSee('pk=122');
        $response->assertSee('/ai/events/122?event=', false);
    }

    public function test_ai_event_page_renders_summary_and_people_prompts(): void
    {
        $this->createAiEventTables();

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
        ]);
        DB::table('urt_ai_period')->insert([
            'pk' => 30,
            'date_from' => '2026-05-22 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'condition_type' => 'all',
            'del_flag' => null,
            'result_json' => json_encode([
                [
                    '2026-05-23' => ['毒駕事件'],
                    '2026-05-22' => ['交通事故修法'],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'data_json' => json_encode(['9', '10'], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/ai/events/10?event=毒駕事件');

        $response->assertOk();
        $response->assertSee('毒駕事件 到 2026-05-23 的相關報導');
        $response->assertSee('逐日事件線');
        $response->assertSee('交通事故修法');
        $response->assertSee('pk=9');
        $response->assertSee('事件分析');
        $response->assertSee('毒駕事件引起交通安全討論');
        $response->assertSee('毒駕');
        $response->assertSee('毒駕事故造成傷亡');
        $response->assertSee('應加重刑責');
        $response->assertSee('人物觀點');
        $response->assertSee('卓榮泰');
        $response->assertSee('ghi789');
    }

    public function test_ai_event_page_resolves_media_event_alias_to_canonical_event_row(): void
    {
        $this->createAiDailyTables();

        Schema::dropIfExists('urt_ai_event');
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

        DB::table('urt_ai_date')->insert([
            'pk' => 10,
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([15 => 'ETtoday新聞雲'], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([
                [
                    '標題' => '黃仁勳參加COMPUTEX展會',
                    '媒體事件' => [
                        'ETtoday新聞雲' => ['黃仁勳的高人氣與活動'],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_channel_ai')->insert([
            'pk' => 100,
            'u_id' => 15,
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'del_flag' => null,
            'result_json' => json_encode([
                [
                    '事件' => '黃仁勳的高人氣與活動',
                    '描述' => '黃仁勳參展帶動現場人氣。',
                    '關鍵字' => ['黃仁勳', 'COMPUTEX'],
                    '人物' => ['黃仁勳'],
                    'videoId' => ['nvidia123'],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);
        DB::table('urt_count')->insert(['u_id' => 15, 'tags' => '[4]']);
        DB::table('urt_video')->insert([
            'u_id' => 15,
            'videoId' => 'nvidia123',
            'publishedAt' => '2026-05-23 08:00:00',
            'title' => 'NVIDIA keynote',
        ]);

        DB::table('urt_ai_event')->insert([
            'pk' => 20,
            'aipk' => 10,
            'event_name' => '黃仁勳參加COMPUTEX展會',
            'date_from' => '2026-05-23 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'condition_type' => 'all',
            'prompt_type' => 'summary',
            'del_flag' => null,
            'result_json' => json_encode([
                'events' => [
                    [
                        'event' => '黃仁勳參加COMPUTEX展會',
                        'description' => '黃仁勳參加COMPUTEX展會帶動AI熱度。',
                        'keywords' => ['黃仁勳', 'COMPUTEX'],
                        'media' => ['ETtoday新聞雲'],
                        'fact' => [],
                        'opinion' => [],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/ai/events/10?event='.urlencode('黃仁勳的高人氣與活動'));

        $response->assertOk();
        $response->assertSee('黃仁勳參加COMPUTEX展會 到 2026-05-23 的相關報導');
        $response->assertSee('黃仁勳參加COMPUTEX展會帶動AI熱度');
        $response->assertSee('ETtoday新聞雲');
        $response->assertDontSee('目前沒有對應的 `urt_ai_event` summary/people 內容');
        $response->assertDontSee('目前沒有 event summary JSON');
    }

    public function test_ai_event_page_does_not_show_missing_period_notice_when_history_exists_without_event_ai(): void
    {
        $this->createAiEventTables();

        DB::table('urt_ai_date')->insert([
            [
                'pk' => 9,
                'date_from' => '2026-05-22 00:00:00',
                'date_to' => '2026-05-22 23:59:59',
                'condition_type' => 'all',
                'data_type' => 'oneday',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => '[]',
            ],
            [
                'pk' => 10,
                'date_from' => '2026-05-23 00:00:00',
                'date_to' => '2026-05-23 23:59:59',
                'condition_type' => 'all',
                'data_type' => 'oneday',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => '[]',
            ],
        ]);
        DB::table('urt_ai_period')->insert([
            'pk' => 30,
            'date_from' => '2026-05-22 00:00:00',
            'date_to' => '2026-05-23 23:59:59',
            'condition_type' => 'all',
            'del_flag' => null,
            'result_json' => json_encode([
                [
                    '2026-05-23' => ['黃仁勳的高人氣與活動'],
                    '2026-05-22' => ['黃仁勳參加COMPUTEX'],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'data_json' => json_encode(['9', '10'], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/ai/events/10?event='.urlencode('黃仁勳的高人氣與活動'));

        $response->assertOk();
        $response->assertSee('逐日事件線');
        $response->assertSee('黃仁勳參加COMPUTEX');
        $response->assertSee('可用的事件入口與逐日事件線');
        $response->assertDontSee('歷史追蹤待 `urt_ai_period` dump 後補齊');
        $response->assertDontSee('Legacy event history relies on `urt_ai_period`');
    }

    public function test_ai_hourly_page_renders_legacy_hour_topics(): void
    {
        $this->createAiHourTable();

        DB::table('urt_ai_hour')->insert([
            [
                'pk' => 1,
                'date_from' => '2026-05-24 17:00:00',
                'date_to' => '2026-05-24 17:59:59',
                'condition_type' => 'all',
                'ai_type' => 'qwen',
                'data_type' => 'each',
                'user_token' => 'CLI',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '毒駕事件頻傳',
                        '描述' => '多起毒駕事件引發社會關注。',
                        '分類' => '社會',
                        '角度' => '台灣',
                        '陣營' => '民進黨',
                        '關鍵字' => ['毒駕', '交通'],
                        '人物' => ['卓榮泰'],
                        '地名' => ['新北'],
                        'videoId' => ['abc123', 'def456'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'date_from' => '2026-05-24 16:00:00',
                'date_to' => '2026-05-24 16:59:59',
                'condition_type' => 'all',
                'ai_type' => 'qwen',
                'data_type' => 'each',
                'user_token' => 'CLI',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '國會改革攻防',
                        '描述' => '朝野針對法案持續攻防。',
                        '分類' => '政治',
                        '關鍵字' => ['國會', '改革'],
                        'videoId' => ['ghi789'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 3,
                'date_from' => '2026-05-24 17:00:00',
                'date_to' => '2026-05-24 17:59:59',
                'condition_type' => 'blue',
                'ai_type' => 'qwen',
                'data_type' => 'each',
                'user_token' => 'CLI',
                'del_flag' => null,
                'result_json' => json_encode([
                    ['事件' => '不應顯示', 'videoId' => ['skip123']],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/ai/hours?date=2026-05-24&condition=all');

        $response->assertOk();
        $response->assertSee('2026-05-24 當日分時事件整理');
        $response->assertSee('2026-05-24 17時');
        $response->assertSee('毒駕事件頻傳');
        $response->assertSee('2');
        $response->assertSee('毒駕');
        $response->assertSee('卓榮泰');
        $response->assertSee('https://i.ytimg.com/vi/abc123/mqdefault.jpg', false);
        $response->assertSee('國會改革攻防');
        $response->assertDontSee('不應顯示');
    }

    public function test_ai_hourly_page_defaults_to_latest_local_date(): void
    {
        $this->createAiHourTable();

        DB::table('urt_ai_hour')->insert([
            [
                'pk' => 1,
                'date_from' => '2026-05-23 10:00:00',
                'date_to' => '2026-05-23 10:59:59',
                'condition_type' => 'all',
                'ai_type' => 'qwen',
                'data_type' => 'each',
                'user_token' => 'CLI',
                'del_flag' => null,
                'result_json' => json_encode([['事件' => '舊事件', 'videoId' => ['old123']]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'date_from' => '2026-05-24 11:00:00',
                'date_to' => '2026-05-24 11:59:59',
                'condition_type' => 'all',
                'ai_type' => 'qwen',
                'data_type' => 'each',
                'user_token' => 'CLI',
                'del_flag' => null,
                'result_json' => json_encode([['事件' => '最新事件', 'videoId' => ['new123']]], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/ai/hours');

        $response->assertOk();
        $response->assertSee('2026-05-24 當日分時事件整理');
        $response->assertSee('最新事件');
        $response->assertDontSee('舊事件');
    }

    public function test_ai_hourly_page_expands_wrapped_legacy_topic_payloads(): void
    {
        $this->createAiHourTable();

        DB::table('urt_ai_hour')->insert([
            'pk' => 1,
            'date_from' => '2026-05-24 12:00:00',
            'date_to' => '2026-05-24 12:59:59',
            'condition_type' => 'all',
            'ai_type' => 'qwen',
            'data_type' => 'each',
            'user_token' => 'CLI',
            'del_flag' => null,
            'result_json' => json_encode([
                'events' => [
                    [
                        '議題' => '包裝格式事件',
                        '說明' => '這筆資料包在 events key 裡。',
                        '類型' => '政治',
                        'keywords' => ['包裝', '解析'],
                        'people' => ['測試人物'],
                        'places' => ['台北'],
                        'videos' => ['wrapped123'],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/ai/hours?date=2026-05-24');

        $response->assertOk();
        $response->assertSee('包裝格式事件');
        $response->assertSee('這筆資料包在 events key 裡');
        $response->assertSee('政治');
        $response->assertSee('包裝');
        $response->assertSee('測試人物');
        $response->assertSee('wrapped123');
    }

    private function createAiHourTable(): void
    {
        Schema::dropIfExists('urt_ai_hour');

        Schema::create('urt_ai_hour', function ($table): void {
            $table->integer('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to')->nullable();
            $table->string('condition_type')->nullable();
            $table->string('ai_type')->nullable();
            $table->string('data_type')->nullable();
            $table->string('user_token')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });
    }

    private function createAiDailyTables(): void
    {
        foreach (['urt_ai_date', 'urt_channel_ai', 'urt_channel', 'urt_count', 'urt_video'] as $table) {
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

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
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

        Schema::create('urt_video', function ($table): void {
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
        });
    }

    private function createAiEventTables(): void
    {
        foreach (['urt_ai_period', 'urt_ai_date', 'urt_ai_event'] as $table) {
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
            $table->string('condition_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
            $table->text('data_json')->nullable();
        });
    }
}
