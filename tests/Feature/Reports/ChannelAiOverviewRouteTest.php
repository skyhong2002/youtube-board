<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelAiOverviewRouteTest extends TestCase
{
    public function test_channel_ai_overview_renders_cached_topic_people_aspect_and_prompt(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'ctime' => '2026-05-23 12:00:00',
                'ai_type' => 'legacy',
                'data_type' => 'topic',
                'del_flag' => null,
                'result_json' => json_encode([
                    ['標題' => '宜蘭縣政府的政策和活動', '內容' => '頻道經常報導地方政策。', '強弱' => '強'],
                    ['title' => 'English fallback topic', 'content' => 'Fallback content.', 'strength' => '中'],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'u_id' => 10,
                'ctime' => '2026-05-23 12:00:00',
                'ai_type' => 'legacy',
                'data_type' => 'people',
                'del_flag' => null,
                'result_json' => json_encode([
                    'persons' => [
                        [
                            'name' => '韓國瑜',
                            'role' => '政治人物',
                            'content' => '多次出現在報導中。',
                            'evaluation' => '正面',
                            'score' => 8,
                        ],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 3,
                'u_id' => 10,
                'ctime' => '2026-05-23 12:00:00',
                'ai_type' => 'legacy',
                'data_type' => 'aspect',
                'del_flag' => null,
                'result_json' => json_encode([
                    '政治傾向' => [
                        ['項目' => '泛藍', '描述' => '報導較常提到藍營政治人物。', '偏好度' => 7],
                    ],
                    '兩岸角度' => [
                        ['項目' => '台灣', '描述' => '以台灣地方議題為主。', '偏好度' => 8],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 4,
                'u_id' => 99,
                'ctime' => '2026-05-23 12:00:00',
                'ai_type' => 'legacy',
                'data_type' => 'topic',
                'del_flag' => null,
                'result_json' => json_encode([['標題' => '其他頻道']], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/channels/10/ai');

        $response->assertOk();
        $response->assertSee('Example Channel GPT / AI');
        $response->assertSee('宜蘭縣政府的政策和活動');
        $response->assertSee('English fallback topic');
        $response->assertSee('韓國瑜');
        $response->assertSee('8/10');
        $response->assertSee('政治傾向');
        $response->assertSee('泛藍');
        $response->assertSee('https://www.youtube.com/channel/UC10', false);
        $response->assertSee('請把上面的回答轉成兩個 JSON');
        $response->assertDontSee('其他頻道');
        $response->assertDontSee('<form', false);
        $response->assertDontSee('/redir/channel_gpt.php');
    }

    public function test_channel_ai_overview_renders_unavailable_sections_when_cached_rows_are_missing(): void
    {
        $this->createTables();

        $response = $this->get('/channels/10/ai');

        $response->assertOk();
        $response->assertSee('目前沒有 topic 類型的頻道 AI 資料');
        $response->assertSee('目前沒有 people 類型的頻道 AI 資料');
        $response->assertSee('目前沒有 aspect 類型的頻道 AI 資料');
    }

    private function createTables(): void
    {
        foreach (['urt_channel_ai', 'urt_channel'] as $table) {
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
            $table->dateTime('ctime')->nullable();
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('ai_type')->nullable();
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
