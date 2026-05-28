<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyTagChannelApiTest extends TestCase
{
    public function test_tags_list_api_returns_legacy_tag_map(): void
    {
        $this->createUrtTagTable();
        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
        ]);

        $response = $this->getJson('/api/tags_list.php');

        $response->assertOk();
        $response->assertJsonPath('meta.source', 'urt_tag');
        $this->assertSame('社論', $response->json('result')['1']);
        $this->assertSame('新聞', $response->json('result')['2']);
    }

    public function test_tags_index_api_rebuilds_keyword_weight_from_local_tags_table(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createTagsTable();
        DB::table('tags')->insert([
            [
                'pk' => 1,
                'tag' => '高熱度',
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => '2026-05-24 00:00:00',
                'max_count' => 900,
                'hours_count' => 120,
                'max_hours' => '2026-05-24 20:00:00',
                'no_tag' => 0,
            ],
            [
                'pk' => 2,
                'tag' => '低熱度',
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => '2026-05-21 00:00:00',
                'max_count' => 20,
                'hours_count' => 4,
                'max_hours' => '2026-05-20 00:00:00',
                'no_tag' => 0,
            ],
        ]);

        $response = $this->getJson('/api/tags_index.php?limit=1');

        $response->assertOk();
        $response->assertJsonPath('meta.realtime_dashboard', true);
        $this->assertSame(['高熱度'], array_keys($response->json('result')));
        $this->assertGreaterThan(0, $response->json('result')['高熱度']['weight']);

        Carbon::setTestNow();
    }

    public function test_tags_all_api_reports_empty_cache_in_preview_mode(): void
    {
        Schema::create('urt_show_data', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('data_name');
            $table->string('api')->nullable();
            $table->string('para')->nullable();
            $table->longText('the_result')->nullable();
        });

        $response = $this->getJson('/api/tags_all.php');

        $response->assertOk();
        $response->assertJsonPath('meta.available', false);
        $response->assertJsonPath('meta.realtime_dashboard', true);
        $this->assertSame(0, DB::table('urt_show_data')->count());
    }

    public function test_tags_all_api_reads_wrapped_and_list_shaped_cache(): void
    {
        Schema::create('urt_show_data', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('data_name');
            $table->string('api')->nullable();
            $table->string('para')->nullable();
            $table->longText('the_result')->nullable();
        });

        DB::table('urt_show_data')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'stime' => null,
            'data_name' => 'tags_all',
            'api' => null,
            'para' => null,
            'the_result' => json_encode([
                'result' => [
                    ['tag' => '柯文哲', 'video' => 8, 'views' => 7000, 'views_all' => 21000],
                    ['keyword' => '賴清德', 'video' => 4, 'views' => 3000, 'views_all' => 9000],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/tags_all.php');

        $response->assertOk();
        $response->assertJsonPath('meta.available', true);
        $response->assertJsonPath('result.柯文哲.video', 8);
        $response->assertJsonPath('result.賴清德.views_all', 9000);
        $this->assertSame(1, DB::table('urt_show_data')->count());
    }

    public function test_video_tags_apis_compute_keywords_ingestion_when_cache_is_empty(): void
    {
        $this->createTagsTable();
        $this->createVideoTable();
        $this->createVideoTagCacheTables();

        DB::table('tags')->insert([
            ['pk' => 1, 'tag' => '川普', 'ctime' => now(), 'mtime' => now(), 'max_count' => 100, 'hours_count' => 10, 'max_hours' => now(), 'no_tag' => 0],
            ['pk' => 2, 'tag' => '白宮', 'ctime' => now(), 'mtime' => now(), 'max_count' => 90, 'hours_count' => 9, 'max_hours' => now(), 'no_tag' => 0],
            ['pk' => 3, 'tag' => '不會出現', 'ctime' => now(), 'mtime' => now(), 'max_count' => 1, 'hours_count' => 1, 'max_hours' => now(), 'no_tag' => 0],
        ]);
        DB::table('urt_video')->insert([
            'pk' => 77,
            'u_id' => 10,
            'videoId' => 'video-keyword',
            'publishedAt' => '2026-05-24 10:00:00',
            'channelId' => 'UC-test',
            'title' => '川普白宮最新消息',
            'description' => '川普在白宮發表談話，白宮外媒體很多。',
            'channelTitle' => 'Test Channel',
            'thumbnails' => 'https://example.test/thumb.jpg',
            'viewCount' => 1000,
        ]);

        $full = $this->getJson('/api/video_tags.php?pk=77');
        $title = $this->getJson('/api/video_tags_title.php?videoId=video-keyword');

        $full->assertOk();
        $full->assertJsonPath('meta.source', 'tags table computed real-time YouTube dashboard');
        $this->assertSame(3, $full->json('result')['川普']);
        $this->assertSame(4, $full->json('result')['白宮']);
        $title->assertOk();
        $this->assertSame(1, $title->json('result')['川普']);
        $this->assertSame(1, $title->json('result')['白宮']);
        $this->assertSame(0, DB::table('urt_show_video_tag')->count());
        $this->assertSame(0, DB::table('urt_show_video_tag_title')->count());
    }

    public function test_channels_list_and_videos_apis_apply_legacy_tag_filters(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createChannelTables();
        $this->createVideoTable();

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][2]'],
            ['u_id' => 20, 'tags' => '[1][9]'],
        ]);
        DB::table('urt_channel')->insert([
            [
                'u_id' => 10,
                'youtube_id' => 'UC-included',
                'title' => 'Included Channel',
                'thumbnails' => 'https://example.test/included.jpg',
                'viewCount' => 5000,
                'subscriberCount' => 100,
                'videoCount' => 20,
            ],
            [
                'u_id' => 20,
                'youtube_id' => 'UC-excluded',
                'title' => 'Excluded Channel',
                'thumbnails' => 'https://example.test/excluded.jpg',
                'viewCount' => 9000,
                'subscriberCount' => 200,
                'videoCount' => 30,
            ],
        ]);
        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'u_id' => 10,
                'videoId' => 'included-video',
                'publishedAt' => '2026-05-24 12:00:00',
                'channelId' => 'UC-included',
                'title' => 'Included Video',
                'description' => 'included',
                'channelTitle' => 'Included Channel',
                'thumbnails' => 'https://example.test/included-video.jpg',
                'viewCount' => 1200,
            ],
            [
                'pk' => 2,
                'u_id' => 20,
                'videoId' => 'excluded-video',
                'publishedAt' => '2026-05-24 12:00:00',
                'channelId' => 'UC-excluded',
                'title' => 'Excluded Video',
                'description' => 'excluded',
                'channelTitle' => 'Excluded Channel',
                'thumbnails' => 'https://example.test/excluded-video.jpg',
                'viewCount' => 5000,
            ],
        ]);

        $channels = $this->getJson('/api/channels_list.php?tagid=1&not=9');
        $videos = $this->getJson('/api/channels_videos.php?tagid=1&not=9&hours=72&min=100');
        $channelVideos = $this->getJson('/api/channel_videos.php?u_id=10&hours=72&min=100');

        $channels->assertOk();
        $channels->assertJsonPath('count_channels', 1);
        $channels->assertJsonPath('result.0.title', 'Included Channel');
        $channels->assertJsonMissing(['title' => 'Excluded Channel']);

        $videos->assertOk();
        $videos->assertJsonPath('count_videos', 1);
        $videos->assertJsonPath('result.0.videoId', 'included-video');
        $videos->assertJsonMissing(['videoId' => 'excluded-video']);

        $channelVideos->assertOk();
        $channelVideos->assertJsonPath('count_videos', 1);
        $channelVideos->assertJsonPath('result.0.videoId', 'included-video');

        Carbon::setTestNow();
    }

    public function test_api_tag_returns_legacy_bare_tag_map(): void
    {
        $this->createUrtTagTable();
        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 13, 'tag_name' => '政治'],
        ]);

        $response = $this->getJson('/api/api_tag.php');

        $response->assertOk();
        $this->assertSame('社論', $response->json('1'));
        $this->assertSame('政治', $response->json('13'));
    }

    public function test_tag_cloud_cache_apis_ingestion_and_report_misses(): void
    {
        $this->createTagCloudTable();
        DB::table('urt_show_tag_cloud')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tagid' => '1',
            'tag_or' => '',
            'tag_not' => '',
            'count_channels' => 2,
            'count_videos' => 3,
            'count_tags' => 4,
            'days' => 3,
            'tags_count' => 1,
            'tags_result' => json_encode(['川普' => '9.500'], JSON_UNESCAPED_UNICODE),
        ]);

        $hit = $this->getJson('/api/tags_day.php?tagid=1&days=3');
        $miss = $this->getJson('/api/tags_video.php?tagid=99&days=3');

        $hit->assertOk();
        $hit->assertJsonPath('meta.source', 'urt_show_tag_cloud');
        $this->assertSame('9.500', $hit->json('result')['川普']);
        $miss->assertOk();
        $miss->assertJsonPath('meta.available', false);
        $this->assertSame(1, DB::table('urt_show_tag_cloud')->count());
    }

    public function test_tag_cloud_cache_api_reads_wrapped_and_list_payloads(): void
    {
        $this->createTagCloudTable();
        DB::table('urt_show_tag_cloud')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tagid' => '1',
            'tag_or' => '',
            'tag_not' => '',
            'count_channels' => 2,
            'count_videos' => 3,
            'count_tags' => 4,
            'days' => 3,
            'tags_count' => 2,
            'tags_result' => json_encode([
                'tags_result' => [
                    ['tag' => '川普', 'weight' => '9.500'],
                    ['word' => '白宮', 'score' => 4],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/tags_day.php?tagid=1&days=3');

        $response->assertOk();
        $this->assertSame('9.500', $response->json('result')['川普']);
        $this->assertSame(4, $response->json('result')['白宮']);
    }

    public function test_tag_relation_month_period_and_tags_days_cache_apis_are_ingestion(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createTagRelationDateTable();
        $this->createTagMonthTable();
        $this->createTagCloudTagTable();

        DB::table('urt_show_video_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'the_date' => '2026-05-24',
            'tag' => '蔡英文',
            'count_videos' => 2,
            'count_tags' => 3,
            'count_channels' => 1,
            'videos_json' => json_encode(['video-a' => 10], JSON_UNESCAPED_UNICODE),
            'tags_json' => json_encode(['川普' => 2], JSON_UNESCAPED_UNICODE),
        ]);
        DB::table('urt_show_tag_month')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tag' => '蔡英文',
                'tagid' => '',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-05-01',
                'count_videos' => 2,
                'total_views' => 2000,
                'tags_result' => json_encode(['2026-05-24' => ['tags_video' => 2, 'tags_views' => 2000]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-04-01 00:00:00',
                'mtime' => '2026-04-30 01:00:00',
                'tag' => '蔡英文',
                'tagid' => '',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-04-01',
                'count_videos' => 1,
                'total_views' => 1000,
                'tags_result' => json_encode(['2026-04-30' => ['tags_video' => 1, 'tags_views' => 1000]], JSON_UNESCAPED_UNICODE),
            ],
        ]);
        DB::table('urt_show_tag_cloud_tag')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tag' => '蔡英文',
            'tagid' => '',
            'tag_or' => '',
            'tag_not' => '',
            'count_channels' => 1,
            'count_videos' => 2,
            'count_tags' => 3,
            'days' => 3,
            'tags_count' => 1,
            'tags_result' => json_encode(['川普' => ['videos' => 1, 'views' => 100, 'weight' => '10.00']], JSON_UNESCAPED_UNICODE),
            'videos_json' => json_encode(['video-a' => ['u_id' => 10]], JSON_UNESCAPED_UNICODE),
        ]);

        $relation = $this->getJson('/api/tags_relation_date.php?tag=蔡英文&date=2026-05-24');
        $month = $this->getJson('/api/tag_month.php?tag=蔡英文&month=2026-05-01');
        $period = $this->getJson('/api/tag_period.php?tag=蔡英文&days=60');
        $tagsDays = $this->getJson('/api/tag_tags_days.php?tag=蔡英文&days=3');

        $relation->assertOk();
        $relation->assertJsonPath('count_videos', 2);
        $this->assertSame(2, $relation->json('result')['川普']);
        $this->assertSame(10, $relation->json('videos')['video-a']);

        $month->assertOk();
        $month->assertJsonPath('meta.source', 'urt_show_tag_month');
        $this->assertSame(2, $month->json('result')['2026-05-24']['tags_video']);

        $period->assertOk();
        $this->assertSame(1, $period->json('result')['2026-04-30']['tags_video']);
        $this->assertSame(2, $period->json('result')['2026-05-24']['tags_video']);

        $tagsDays->assertOk();
        $tagsDays->assertJsonPath('count_videos', 2);
        $this->assertSame('10.00', $tagsDays->json('result')['川普']['weight']);
        $this->assertSame(1, DB::table('urt_show_video_tag_date')->count());
        $this->assertSame(2, DB::table('urt_show_tag_month')->count());
        $this->assertSame(1, DB::table('urt_show_tag_cloud_tag')->count());

        Carbon::setTestNow();
    }

    public function test_tag_relation_date_api_reads_wrapped_and_list_shaped_payloads(): void
    {
        $this->createTagRelationDateTable();

        DB::table('urt_show_video_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'the_date' => '2026-05-24',
            'tag' => '蔡英文',
            'count_videos' => 2,
            'count_tags' => 3,
            'count_channels' => 1,
            'videos_json' => json_encode([
                'videos' => [
                    ['videoId' => 'video-a', 'count' => 10],
                    ['video_id' => 'video-b', 'value' => 7],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'tags_json' => json_encode([
                'tags' => [
                    ['tag' => '川普', 'count' => 2],
                    ['word' => '白宮', 'score' => 5],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/tags_relation_date.php?tag=蔡英文&date=2026-05-24');

        $response->assertOk();
        $this->assertSame(2, $response->json('result')['川普']);
        $this->assertSame(5, $response->json('result')['白宮']);
        $this->assertSame(10, $response->json('videos')['video-a']);
        $this->assertSame(7, $response->json('videos')['video-b']);
    }

    public function test_tag_month_period_and_tags_days_apis_read_wrapped_payloads(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createTagMonthTable();
        $this->createTagCloudTagTable();

        DB::table('urt_show_tag_month')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tag' => '蔡英文',
                'tagid' => '',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-05-01',
                'count_videos' => 2,
                'total_views' => 2000,
                'tags_result' => json_encode([
                    'result' => [
                        ['date' => '2026-05-24', 'tags_video' => 2, 'tags_views' => 2000],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-04-01 00:00:00',
                'mtime' => '2026-04-30 01:00:00',
                'tag' => '蔡英文',
                'tagid' => '',
                'tag_or' => '',
                'tag_not' => '',
                'the_month' => '2026-04-01',
                'count_videos' => 1,
                'total_views' => 1000,
                'tags_result' => json_encode([
                    'tags_result' => [
                        '2026-04-30' => ['tags_video' => 1, 'tags_views' => 1000],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
        DB::table('urt_show_tag_cloud_tag')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tag' => '蔡英文',
            'tagid' => '',
            'tag_or' => '',
            'tag_not' => '',
            'count_channels' => 1,
            'count_videos' => 2,
            'count_tags' => 3,
            'days' => 3,
            'tags_count' => 1,
            'tags_result' => json_encode([
                'tags_result' => [
                    '川普' => ['videos' => 1, 'views' => 100, 'weight' => '10.00'],
                ],
            ], JSON_UNESCAPED_UNICODE),
            'videos_json' => json_encode([
                'videos' => [
                    'video-a' => ['u_id' => 10],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $month = $this->getJson('/api/tag_month.php?tag=蔡英文&month=2026-05-01');
        $period = $this->getJson('/api/tag_period.php?tag=蔡英文&days=60');
        $tagsDays = $this->getJson('/api/tag_tags_days.php?tag=蔡英文&days=3');

        $month->assertOk();
        $this->assertSame(2, $month->json('result')['2026-05-24']['tags_video']);

        $period->assertOk();
        $this->assertSame(1, $period->json('result')['2026-04-30']['tags_video']);
        $this->assertSame(2, $period->json('result')['2026-05-24']['tags_video']);

        $tagsDays->assertOk();
        $this->assertSame('10.00', $tagsDays->json('result')['川普']['weight']);
        $this->assertSame(10, $tagsDays->json('videos')['video-a']['u_id']);

        Carbon::setTestNow();
    }

    private function createUrtTagTable(): void
    {
        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });
    }

    private function createTagsTable(): void
    {
        Schema::create('tags', function ($table): void {
            $table->integer('pk');
            $table->string('tag');
            $table->dateTime('ctime');
            $table->dateTime('mtime');
            $table->integer('max_count');
            $table->integer('hours_count');
            $table->dateTime('max_hours');
            $table->integer('no_tag')->nullable();
        });
    }

    private function createChannelTables(): void
    {
        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->text('tags')->nullable();
        });

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('subscriberCount')->nullable();
            $table->integer('videoCount')->nullable();
        });
    }

    private function createVideoTable(): void
    {
        Schema::create('urt_video', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('channelId');
            $table->string('title');
            $table->text('description');
            $table->string('channelTitle');
            $table->string('thumbnails');
            $table->bigInteger('viewCount')->nullable();
        });
    }

    private function createVideoTagCacheTables(): void
    {
        foreach (['urt_show_video_tag', 'urt_show_video_tag_title'] as $tableName) {
            Schema::create($tableName, function ($table): void {
                $table->integer('pk_video');
                $table->dateTime('ctime');
                $table->dateTime('mtime')->nullable();
                $table->dateTime('publishedAt')->nullable();
                $table->integer('u_id');
                $table->string('videoId');
                $table->integer('tags_num')->nullable();
                $table->integer('tags_count')->nullable();
                $table->text('tags_json')->nullable();
            });
        }
    }

    private function createTagCloudTable(): void
    {
        Schema::create('urt_show_tag_cloud', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('days');
            $table->integer('tags_count')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    private function createTagRelationDateTable(): void
    {
        Schema::create('urt_show_video_tag_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('the_date');
            $table->string('tag');
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('count_channels')->nullable();
            $table->text('videos_json')->nullable();
            $table->text('tags_json')->nullable();
        });
    }

    private function createTagMonthTable(): void
    {
        Schema::create('urt_show_tag_month', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_month');
            $table->integer('count_videos')->nullable();
            $table->integer('total_views')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    private function createTagCloudTagTable(): void
    {
        Schema::create('urt_show_tag_cloud_tag', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('days');
            $table->integer('tags_count')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('videos_json')->nullable();
        });
    }
}
