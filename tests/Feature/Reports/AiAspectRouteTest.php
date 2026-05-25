<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AiAspectRouteTest extends TestCase
{
    public function test_ai_aspect_page_renders_latest_channel_aspect_rows_with_tag_filters(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'data_type' => 'aspect',
                'result_json' => json_encode([
                    '政治傾向' => [
                        ['項目' => '泛藍', '偏好度' => 1, '描述' => '藍描述'],
                        ['項目' => '泛綠', '偏好度' => 8, '描述' => '綠描述'],
                        ['項目' => '泛紅', '偏好度' => 0, '描述' => '紅描述'],
                        ['項目' => '泛白', '偏好度' => 2, '描述' => '白描述'],
                    ],
                    '兩岸角度' => [
                        ['項目' => '台灣', '偏好度' => 9, '描述' => '台灣描述'],
                        ['項目' => '中國', '偏好度' => 2, '描述' => '中國描述'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'u_id' => 20,
                'data_type' => 'aspect',
                'result_json' => json_encode([
                    '政治' => [
                        ['項目' => '泛藍', '偏好度' => 9],
                        ['項目' => '泛綠', '偏好度' => 1],
                        ['項目' => '泛紅', '偏好度' => 3],
                        ['項目' => '泛白', '偏好度' => 1],
                    ],
                    '兩岸' => [
                        ['項目' => '台灣', '偏好度' => 2],
                        ['項目' => '中國', '偏好度' => 8],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/ai/aspects?tagid=1&not=9');

        $response->assertOk();
        $response->assertSee('社論 立場分布表');
        $response->assertSee('Included Channel');
        $response->assertSee('泛綠');
        $response->assertSee('8');
        $response->assertSee('9');
        $response->assertSee('16');
        $response->assertSee('台灣描述');
        $response->assertDontSee('Excluded Channel');
    }

    public function test_ai_aspect_condition_maps_to_legacy_tag_filters(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'data_type' => 'aspect',
                'result_json' => json_encode([
                    '政治' => [
                        ['項目' => '泛藍', '偏好度' => 1],
                        ['項目' => '泛綠', '偏好度' => 8],
                        ['項目' => '泛紅', '偏好度' => 0],
                        ['項目' => '泛白', '偏好度' => 2],
                    ],
                    '兩岸' => [
                        ['項目' => '台灣', '偏好度' => 9],
                        ['項目' => '中國', '偏好度' => 2],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/ai/aspects?condition=green');

        $response->assertOk();
        $response->assertSee('泛綠 立場分布表');
        $response->assertSee('condition=green');
        $response->assertSee('tagid=4');
        $response->assertSee('Included Channel');
    }

    public function test_ai_aspect_page_expands_wrapped_and_flat_legacy_payloads(): void
    {
        $this->createTables();

        DB::table('urt_channel_ai')->insert([
            'pk' => 3,
            'u_id' => 10,
            'data_type' => 'aspect',
            'result_json' => json_encode([
                'aspects' => [
                    ['分類' => '政治傾向', '項目' => '泛藍', '偏好度' => 2, '描述' => 'wrapped blue'],
                    ['分類' => '政治傾向', '項目' => '泛綠', '偏好度' => 7, '描述' => 'wrapped green'],
                    ['分類' => '政治傾向', '項目' => '泛紅', '偏好度' => 1],
                    ['分類' => '政治傾向', '項目' => '泛白', '偏好度' => 3],
                    ['分類' => '兩岸角度', '項目' => '台灣', '偏好度' => 8, '描述' => 'wrapped taiwan'],
                    ['分類' => '兩岸角度', '項目' => '中國', '偏好度' => 1, '描述' => 'wrapped china'],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/ai/aspects?tagid=1');

        $response->assertOk();
        $response->assertSee('Included Channel');
        $response->assertSee('wrapped green');
        $response->assertSee('wrapped taiwan');
        $response->assertSee('14');
    }

    private function createTables(): void
    {
        foreach (['urt_channel_ai', 'urt_count', 'urt_channel', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->integer('flag_del')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->string('data_type');
            $table->text('result_json')->nullable();
        });

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
            ['tag_id' => 5, 'tag_name' => '泛紅'],
            ['tag_id' => 6, 'tag_name' => '泛白'],
            ['tag_id' => 9, 'tag_name' => '排除'],
            ['tag_id' => 48, 'tag_name' => '台灣立場'],
            ['tag_id' => 49, 'tag_name' => '中國立場'],
        ]);

        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'youtube_id' => 'UC-included', 'title' => 'Included Channel', 'thumbnails' => 'https://example.test/included.jpg', 'flag_del' => null],
            ['u_id' => 20, 'youtube_id' => 'UC-excluded', 'title' => 'Excluded Channel', 'thumbnails' => 'https://example.test/excluded.jpg', 'flag_del' => null],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][4][48]'],
            ['u_id' => 20, 'tags' => '[1][9][3][49]'],
        ]);
    }
}
