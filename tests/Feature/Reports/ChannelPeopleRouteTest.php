<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelPeopleRouteTest extends TestCase
{
    public function test_channel_people_page_aggregates_legacy_channel_ai_oneday_people(): void
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
                        '事件' => '毒駕事件',
                        '人物' => ['卓榮泰', '王世堅', '無'],
                        'videoId' => ['a', 'b'],
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
                        '事件' => '國會事件',
                        '人物' => ['卓榮泰'],
                        'videoId' => ['c'],
                    ],
                    [
                        '事件' => '交通事件',
                        '人物' => ['王世堅'],
                        'videoId' => ['d', 'e', 'f'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/channels/10/people?days=7&limit=2');

        $response->assertOk();
        $response->assertSee('Example Channel 最近 7 天人物排行');
        $response->assertSee('卓榮泰');
        $response->assertSee('3 部 / 2 則');
        $response->assertSee('王世堅');
        $response->assertSee('5 部 / 2 則');
        $response->assertSee('2026-05-23');
        $response->assertSee('2026-05-22');
        $response->assertDontSee('無</span>', false);
    }

    private function createTables(): void
    {
        foreach (['urt_channel', 'urt_channel_ai'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to')->nullable();
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);
    }
}
