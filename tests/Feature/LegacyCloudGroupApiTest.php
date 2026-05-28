<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyCloudGroupApiTest extends TestCase
{
    public function test_channel_cloud_api_reads_local_cache_in_preview_mode(): void
    {
        $this->createChannelCloudTable();
        DB::table('urt_show_cloud')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'days' => 30,
            'keywords_json' => json_encode(['川普' => '8.500', '白宮' => '3.000'], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/cloud.php?uid=10&days=30');

        $response->assertOk();
        $response->assertJsonPath('meta.source', 'urt_show_cloud.keywords_json');
        $response->assertJsonPath('meta.realtime_dashboard', true);
        $this->assertSame('8.500', $response->json('result')['川普']);
        $this->assertSame(1, DB::table('urt_show_cloud')->count());
    }

    public function test_cloud_tag_date_apis_read_cached_tag_day_rows_with_sorted_filters(): void
    {
        $this->createTagDateTable();
        DB::table('urt_show_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'stime' => null,
            'tagid' => '1,3',
            'tag_or' => '2',
            'tag_not' => '9',
            'count_channels' => 4,
            'count_videos' => 5,
            'count_tags' => 6,
            'the_date' => '2026-05-24',
            'tags_count' => 2,
            'total_views' => 7000,
            'tags_result' => json_encode(['川普' => '9.500'], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['川普' => 3], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['川普' => 7000], JSON_UNESCAPED_UNICODE),
        ]);

        $all = $this->getJson('/api/cloud_tag_date.php?tagid=3,1&or=2&not=9&date=2026-05-24&type=all');
        $noApi = $this->getJson('/api/cloud_tag_date_noapi.php?tagid=1,3&or=2&not=9&date=2026-05-24');

        $all->assertOk();
        $all->assertJsonPath('meta.source', 'urt_show_tag_date');
        $all->assertJsonPath('total_views', 7000);
        $this->assertSame('9.500', $all->json('result')['川普']);
        $this->assertSame(3, $all->json('tags_video')['川普']);
        $this->assertSame(7000, $all->json('tags_views')['川普']);

        $noApi->assertOk();
        $noApi->assertJsonPath('meta.source', 'urt_show_tag_date.noapi');
        $this->assertSame('9.500', $noApi->json('result')['川普']);
        $this->assertSame(1, DB::table('urt_show_tag_date')->count());
    }

    public function test_cloud_apis_read_wrapped_and_list_shaped_payloads(): void
    {
        $this->createChannelCloudTable();
        $this->createTagDateTable();

        DB::table('urt_show_cloud')->insert([
            'pk' => 1,
            'u_id' => 10,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'days' => 30,
            'keywords_json' => json_encode([
                'keywords' => [
                    ['word' => '白宮', 'weight' => '3.000'],
                    ['keyword' => '川普', 'score' => '8.500'],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);
        DB::table('urt_show_tag_date')->insert([
            'pk' => 2,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'stime' => null,
            'tagid' => '',
            'tag_or' => '',
            'tag_not' => '',
            'count_channels' => 4,
            'count_videos' => 5,
            'count_tags' => 6,
            'the_date' => '2026-05-24',
            'tags_count' => 2,
            'total_views' => 7000,
            'tags_result' => json_encode([
                'tags_result' => [
                    ['tag' => '交通', 'count' => 9],
                    ['word' => '政策', 'value' => 4],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['result' => [['tag' => '交通', 'count' => 3]]], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['data' => [['tag' => '交通', 'value' => 7000]]], JSON_UNESCAPED_UNICODE),
        ]);

        $cloud = $this->getJson('/api/cloud.php?uid=10&days=30');
        $tagDate = $this->getJson('/api/cloud_tag_date.php?date=2026-05-24&type=all');

        $cloud->assertOk();
        $this->assertSame('8.500', $cloud->json('result')['川普']);
        $this->assertSame('3.000', $cloud->json('result')['白宮']);

        $tagDate->assertOk();
        $this->assertSame(9, $tagDate->json('result')['交通']);
        $this->assertSame(4, $tagDate->json('result')['政策']);
        $this->assertSame(3, $tagDate->json('tags_video')['交通']);
        $this->assertSame(7000, $tagDate->json('tags_views')['交通']);
    }

    public function test_group_view_api_derives_membership_shell_when_legacy_cache_is_missing(): void
    {
        $this->createTagGroupTable();
        DB::table('tag_group')->insert([
            ['group_name' => '政治人物', 'tag' => '賴清德', 'latest_time' => '2026-05-20 00:00:00', 'del_flag' => 0],
            ['group_name' => '政治人物', 'tag' => '柯文哲', 'latest_time' => '2026-05-21 00:00:00', 'del_flag' => 0],
            ['group_name' => '政治人物', 'tag' => '已刪除', 'latest_time' => '2026-05-22 00:00:00', 'del_flag' => 1],
        ]);

        $response = $this->getJson('/api/group_view.php?group=政治人物&view=politician');

        $response->assertOk();
        $response->assertJsonPath('meta.cache_available', false);
        $response->assertJsonPath('meta.realtime_dashboard', true);
        $this->assertSame(['柯文哲', '賴清德'], $response->json('result.tag_array'));
        $this->assertSame('新聞', $response->json('result.group_array.0.name'));
        $response->assertJsonMissing(['已刪除']);
        $this->assertSame(3, DB::table('tag_group')->count());
    }

    public function test_group_view_api_preserves_cached_legacy_payload_when_available(): void
    {
        $this->createGroupCacheTable();
        DB::table('urt_show_group')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'stime' => null,
            'the_group' => '政治人物',
            'the_view' => 'politician',
            'the_result' => json_encode([
                'result' => [
                    'tag_array' => ['賴清德'],
                    'group_array' => [['name' => '新聞', 'tag_para' => 'tagid=13']],
                    'group_data' => [['total_views' => 100]],
                    'data_array' => [['新聞' => ['2026-05-24' => ['tags_views' => 100]]]],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/group_view.php?group=政治人物&view=politician');

        $response->assertOk();
        $response->assertJsonPath('meta.source', 'urt_show_group.the_result');
        $this->assertSame(['賴清德'], $response->json('result.tag_array'));
        $this->assertSame(1, DB::table('urt_show_group')->count());
    }

    private function createChannelCloudTable(): void
    {
        Schema::create('urt_show_cloud', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime');
            $table->integer('days');
            $table->longText('keywords_json');
        });
    }

    private function createTagDateTable(): void
    {
        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->date('the_date');
            $table->integer('tags_count')->nullable();
            $table->integer('total_views')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
    }

    private function createTagGroupTable(): void
    {
        Schema::create('tag_group', function ($table): void {
            $table->string('group_name');
            $table->string('tag');
            $table->dateTime('latest_time')->nullable();
            $table->integer('del_flag')->nullable();
        });
    }

    private function createGroupCacheTable(): void
    {
        Schema::create('urt_show_group', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('the_group');
            $table->string('the_view');
            $table->longText('the_result')->nullable();
        });
    }
}
