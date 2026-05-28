<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GroupLiveRouteTest extends TestCase
{
    public function test_group_live_page_rebuilds_legacy_weekly_live_rank_from_cache(): void
    {
        $this->createLiveTagDateTable();

        foreach (range(18, 24) as $index => $day) {
            $date = sprintf('2026-05-%02d', $day);
            $blueValue = ($index + 1) * 10;
            $greenValue = ($index + 1) * 8;

            DB::table('urt_show_live_tag_date')->insert([
                [
                    'pk' => $index + 1,
                    'tagid' => '3',
                    'tag_or' => '',
                    'tag_not' => '',
                    'the_date' => $date,
                    'tags_views' => json_encode([
                        '賴清德' => ['00' => $blueValue - 4, '12' => $blueValue],
                        '柯文哲' => ['00' => 5],
                    ], JSON_UNESCAPED_UNICODE),
                    'tags_video' => json_encode([
                        '賴清德' => ['00' => 1, '12' => 2],
                        '柯文哲' => ['00' => 1],
                    ], JSON_UNESCAPED_UNICODE),
                ],
                [
                    'pk' => $index + 20,
                    'tagid' => '4',
                    'tag_or' => '',
                    'tag_not' => '',
                    'the_date' => $date,
                    'tags_views' => json_encode([
                        '賴清德' => ['00' => $greenValue],
                        '柯文哲' => ['00' => 3],
                    ], JSON_UNESCAPED_UNICODE),
                    'tags_video' => json_encode([
                        '賴清德' => ['00' => 1],
                        '柯文哲' => ['00' => 1],
                    ], JSON_UNESCAPED_UNICODE),
                ],
            ]);
        }

        $response = $this->get('/groups/tags_president2024/live?view=position&from=2026-05-22&to=2026-05-24&type=tags_views');

        $response->assertOk();
        $response->assertSee('總統候選人 分 政治立場 的直播排行');
        $response->assertSee('live cache');
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('賴清德');
        $response->assertSee('柯文哲');
        $response->assertSee('280');
        $response->assertSee('cache rows 7');
    }

    public function test_group_live_page_supports_video_count_metric(): void
    {
        $this->createLiveTagDateTable();

        DB::table('urt_show_live_tag_date')->insert([
            'pk' => 1,
            'tagid' => '3',
            'tag_or' => '',
            'tag_not' => '',
            'the_date' => '2026-05-24',
            'tags_views' => json_encode(['賴清德' => ['00' => 100]], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['賴清德' => ['00' => 4, '01' => 6]], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/groups/tags_president2024/live?view=position&from=2026-05-24&to=2026-05-24&type=tags_video');

        $response->assertOk();
        $response->assertSee('直播影片數');
        $response->assertSee('6');
    }

    public function test_group_live_page_reports_missing_cache_refresh_guidance(): void
    {
        Schema::dropIfExists('urt_show_live_tag_date');

        $response = $this->get('/groups/tags_president2024/live?view=position&days=7');

        $response->assertOk();
        $response->assertSee('沒有足夠的');
        $response->assertSee('live tag ingestion');
        $response->assertSee('cache refresh');
    }

    public function test_legacy_group_live_url_redirects_to_clean_live_report(): void
    {
        $this->get('/group_live.php?group=tags_president2024&view=position&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('groups.live', [
                'groupName' => 'tags_president2024',
                'view' => 'position',
                'days' => '7',
            ]));
    }

    private function createLiveTagDateTable(): void
    {
        Schema::dropIfExists('urt_show_live_tag_date');

        Schema::create('urt_show_live_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->longText('tags_views')->nullable();
            $table->longText('tags_video')->nullable();
        });
    }
}
