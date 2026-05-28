<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LiveAdditionalReportsTest extends TestCase
{
    public function test_continuous_live_page_renders_legacy_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();
        $this->seedBaseRows('cont123', 10);

        for ($day = 18; $day <= 24; $day++) {
            DB::table('urt_video_live_log')->insert([
                'videoId' => 'cont123',
                'u_id' => 10,
                'the_date' => sprintf('2026-05-%02d', $day),
                'max_current' => ($day - 17) * 100,
                'log_json' => json_encode(['10:00' => ($day - 17) * 100]),
            ]);
        }

        $response = $this->get('/live/continuous?or=1');

        $response->assertOk();
        $response->assertSee('現在帶狀直播排行');
        $response->assertSee('Example Channel');
        $response->assertSee('Example Live Title');
        $response->assertSee('777');
        $response->assertSee('400');
        $response->assertSee('700');

        Carbon::setTestNow();
    }

    public function test_continuous_live_page_renders_active_long_running_rows_with_partial_logs(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 10,
            'tags' => '[1][2]',
        ]);
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC-example',
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
            'flag_del' => null,
        ]);
        DB::table('urt_video_live')->insert([
            [
                'videoId' => 'long-running',
                'u_id' => 10,
                'publishedAt' => '2026-05-22 11:00:00',
                'actualStartTime' => '2026-05-22 11:00:00',
                'scheduledStartTime' => null,
                'actualEndTime' => null,
                'concurrentViewers' => 321,
                'mtime' => '2026-05-24 17:50:00',
                'max_current' => 456,
            ],
            [
                'videoId' => 'fresh-live',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 12:00:00',
                'actualStartTime' => '2026-05-24 12:00:00',
                'scheduledStartTime' => null,
                'actualEndTime' => null,
                'concurrentViewers' => 9999,
                'mtime' => '2026-05-24 17:50:00',
                'max_current' => 9999,
            ],
        ]);
        DB::table('urt_show_video_live')->insert([
            [
                'pk_live' => 1,
                'videoId' => 'long-running',
                'u_id' => 10,
                'publishedAt' => '2026-05-22 11:00:00',
                'channelTitle' => 'Example Channel',
                'title' => 'Long Running Live',
                'thumbnails' => 'https://example.test/long-running.jpg',
            ],
            [
                'pk_live' => 2,
                'videoId' => 'fresh-live',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 12:00:00',
                'channelTitle' => 'Example Channel',
                'title' => 'Fresh Live',
                'thumbnails' => 'https://example.test/fresh-live.jpg',
            ],
        ]);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'long-running',
            'u_id' => 10,
            'the_date' => '2026-05-24',
            'max_current' => 456,
            'log_json' => json_encode(['17:50' => 321]),
        ]);

        $response = $this->get('/live/continuous?or=1');

        $response->assertOk();
        $response->assertSee('Long Running Live');
        $response->assertSee('321');
        $response->assertSee('456');
        $response->assertDontSee('Fresh Live');
        $response->assertDontSee('9,999');

        Carbon::setTestNow();
    }

    public function test_live_day_page_renders_legacy_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();
        $this->seedBaseRows('day123', 10);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'day123',
            'u_id' => 10,
            'the_date' => '2026-05-23',
            'max_current' => 888,
            'log_json' => json_encode(['12:00' => 300, '12:30' => 888]),
        ]);

        $response = $this->get('/live/days/2026-05-23?or=1');

        $response->assertOk();
        $response->assertSee('單日直播排行');
        $response->assertSee('Example Channel');
        $response->assertSee('Example Live Title');
        $response->assertSee('888');
        $response->assertSee('社論');

        Carbon::setTestNow();
    }

    public function test_live_daily_trend_page_renders_group_series_and_summary(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
            ['tag_id' => 5, 'tag_name' => '泛紅'],
            ['tag_id' => 6, 'tag_name' => '泛白'],
            ['tag_id' => 48, 'tag_name' => '台灣立場'],
            ['tag_id' => 49, 'tag_name' => '中國立場'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[3]'],
            ['u_id' => 20, 'tags' => '[4]'],
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'blue-a',
                'u_id' => 10,
                'the_date' => '2026-05-17',
                'max_current' => 700,
                'log_json' => json_encode(['10:00' => 700]),
            ],
            [
                'videoId' => 'blue-b',
                'u_id' => 10,
                'the_date' => '2026-05-18',
                'max_current' => 1400,
                'log_json' => json_encode(['10:00' => 1400]),
            ],
            [
                'videoId' => 'green-a',
                'u_id' => 20,
                'the_date' => '2026-05-17',
                'max_current' => 140,
                'log_json' => json_encode(['10:00' => 140]),
            ],
            [
                'videoId' => 'green-b',
                'u_id' => 20,
                'the_date' => '2026-05-24',
                'max_current' => 280,
                'log_json' => json_encode(['10:00' => 280]),
            ],
        ]);

        $response = $this->get('/live/trends/daily?group=party&type=total_views&from=2026-05-17&to=2026-05-24&today=1');

        $response->assertOk();
        $response->assertSee('立場陣營 從 2026-05-17 到 2026-05-24 的每日直播線上人數');
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('2,100');
        $response->assertSee('1,050.0');
        $response->assertSee('420');
        $response->assertSee('210.0');

        Carbon::setTestNow();
    }

    public function test_live_channels_page_renders_channel_aggregates_with_tag_filters(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
            ['tag_id' => 9, 'tag_name' => '排除'],
        ]);
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
                'flag_del' => null,
            ],
            [
                'u_id' => 20,
                'youtube_id' => 'UC-excluded',
                'title' => 'Excluded Channel',
                'thumbnails' => 'https://example.test/excluded.jpg',
                'flag_del' => null,
            ],
        ]);
        DB::table('urt_show_video_live')->insert([
            [
                'pk_live' => 1,
                'videoId' => 'included-a',
                'u_id' => 10,
                'publishedAt' => '2026-05-20 12:00:00',
                'channelTitle' => 'Included Channel',
                'title' => 'Included Warmup Video',
                'thumbnails' => 'https://example.test/included-a.jpg',
            ],
            [
                'pk_live' => 2,
                'videoId' => 'included-peak',
                'u_id' => 10,
                'publishedAt' => '2026-05-21 12:00:00',
                'channelTitle' => 'Included Channel',
                'title' => 'Included Peak Video',
                'thumbnails' => 'https://example.test/included-peak.jpg',
            ],
            [
                'pk_live' => 3,
                'videoId' => 'excluded-peak',
                'u_id' => 20,
                'publishedAt' => '2026-05-21 12:00:00',
                'channelTitle' => 'Excluded Channel',
                'title' => 'Excluded Peak Video',
                'thumbnails' => 'https://example.test/excluded-peak.jpg',
            ],
        ]);
        DB::table('urt_video_live_log')->insert([
            ['videoId' => 'included-a', 'u_id' => 10, 'the_date' => '2026-05-20', 'max_current' => 300, 'log_json' => json_encode(['12:00' => 300])],
            ['videoId' => 'included-peak', 'u_id' => 10, 'the_date' => '2026-05-21', 'max_current' => 900, 'log_json' => json_encode(['12:00' => 900])],
            ['videoId' => 'included-b', 'u_id' => 10, 'the_date' => '2026-05-22', 'max_current' => 600, 'log_json' => json_encode(['12:00' => 600])],
            ['videoId' => 'excluded-peak', 'u_id' => 20, 'the_date' => '2026-05-21', 'max_current' => 3000, 'log_json' => json_encode(['12:00' => 3000])],
        ]);

        $response = $this->get('/live/channels?tagid=1&not=9&from=2026-05-20&to=2026-05-24&limit=10');

        $response->assertOk();
        $response->assertSee('社論 從 2026-05-20 到 2026-05-24 直播觀看人數排行');
        $response->assertSee('Included Channel');
        $response->assertSee('Included Peak Video');
        $response->assertSee('1,800');
        $response->assertSee('3');
        $response->assertSee('900');
        $response->assertSee('社論');
        $response->assertDontSee('Excluded Channel');

        Carbon::setTestNow();
    }

    public function test_live_hours_page_expands_log_json_into_hourly_heatmap(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 9, 'tag_name' => '排除'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]'],
            ['u_id' => 20, 'tags' => '[1][9]'],
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'hour-a',
                'u_id' => 10,
                'the_date' => '2026-05-20',
                'max_current' => 150,
                'log_json' => json_encode(['10:00' => 100, '10:30' => 150, '11:00' => 50]),
            ],
            [
                'videoId' => 'hour-b',
                'u_id' => 10,
                'the_date' => '2026-05-20',
                'max_current' => 200,
                'log_json' => json_encode(['10:05' => 200, '12:00' => 90]),
            ],
            [
                'videoId' => 'hour-c',
                'u_id' => 10,
                'the_date' => '2026-05-21',
                'max_current' => 300,
                'log_json' => json_encode(['10:00' => 300]),
            ],
            [
                'videoId' => 'hour-excluded',
                'u_id' => 20,
                'the_date' => '2026-05-20',
                'max_current' => 9999,
                'log_json' => json_encode(['10:00' => 9999]),
            ],
        ]);

        $response = $this->get('/live/hours?tagid=1&not=9&from=2026-05-20&to=2026-05-21');

        $response->assertOk();
        $response->assertSee('社論 從 2026-05-20 到 2026-05-21 的直播小時熱度');
        $response->assertSee('10 時');
        $response->assertSee('350');
        $response->assertSee('300');
        $response->assertSee('2 部');
        $response->assertDontSee('9,999');

        Carbon::setTestNow();
    }

    public function test_live_hours_page_prefers_legacy_hour_cache_when_available(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();
        $this->createLiveTagCacheTable();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]'],
        ]);
        DB::table('urt_show_live_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-20 00:00:00',
            'mtime' => '2026-05-20 01:00:00',
            'stime' => '2026-05-20 00:30:00',
            'tagid' => '1',
            'tag_or' => null,
            'tag_not' => null,
            'count_channels' => 1,
            'count_videos' => 3,
            'count_tags' => 1,
            'the_date' => '2026-05-20',
            'tags_count' => 1,
            'total_views' => 1234,
            'hour_result' => json_encode([
                '10' => ['count' => 3, 'views' => 1234],
                '11' => ['count' => 1, 'views' => 456],
            ], JSON_UNESCAPED_UNICODE),
            'videos_result' => '{}',
            'all_result' => '{}',
            'tags_video' => '{}',
            'tags_views' => '{}',
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'raw-hour',
                'u_id' => 10,
                'the_date' => '2026-05-20',
                'max_current' => 9999,
                'log_json' => json_encode(['10:00' => 9999]),
            ],
        ]);

        $response = $this->get('/live/hours?tagid=1&from=2026-05-20&to=2026-05-20');

        $response->assertOk();
        $response->assertSee('社論 從 2026-05-20 到 2026-05-20 的直播小時熱度');
        $response->assertSee('1,234');
        $response->assertSee('3 部');
        $response->assertSee('456');
        $response->assertDontSee('9,999');

        Carbon::setTestNow();
    }

    public function test_live_period_page_renders_range_video_ranking(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();
        $this->seedBaseRows('period-a', 10);
        DB::table('urt_show_video_live')->insert([
            'pk_live' => 2,
            'videoId' => 'period-b',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 12:00:00',
            'channelTitle' => 'Example Channel',
            'title' => 'Second Period Live',
            'thumbnails' => 'https://example.test/period-b.jpg',
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'period-a',
                'u_id' => 10,
                'the_date' => '2026-05-23',
                'max_current' => 800,
                'log_json' => json_encode(['12:00' => 800]),
            ],
            [
                'videoId' => 'period-b',
                'u_id' => 10,
                'the_date' => '2026-05-24',
                'max_current' => 1300,
                'log_json' => json_encode(['12:00' => 1300]),
            ],
        ]);

        $response = $this->get('/live/periods?from=2026-05-23&to=2026-05-24&or=1');

        $response->assertOk();
        $response->assertSee('期間直播排行');
        $response->assertSee('Example Channel');
        $response->assertSee('Example Live Title');
        $response->assertSee('Second Period Live');
        $response->assertSee('1,300');
        $response->assertSee('800');

        Carbon::setTestNow();
    }

    private function seedBaseRows(string $videoId, int $uId): void
    {
        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
        ]);
        DB::table('urt_count')->insert([
            'u_id' => $uId,
            'tags' => '[1][2]',
        ]);
        DB::table('urt_channel')->insert([
            'u_id' => $uId,
            'youtube_id' => 'UC-example',
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
            'flag_del' => null,
        ]);
        DB::table('urt_video_live')->insert([
            'videoId' => $videoId,
            'u_id' => $uId,
            'publishedAt' => '2026-05-23 12:00:00',
            'actualStartTime' => '2026-05-23 12:00:00',
            'scheduledStartTime' => null,
            'actualEndTime' => null,
            'concurrentViewers' => 777,
            'mtime' => '2026-05-24 17:50:00',
            'max_current' => 1200,
        ]);
        DB::table('urt_show_video_live')->insert([
            'pk_live' => 1,
            'videoId' => $videoId,
            'u_id' => $uId,
            'publishedAt' => '2026-05-23 12:00:00',
            'channelTitle' => 'Example Channel',
            'title' => 'Example Live Title',
            'thumbnails' => 'https://example.test/thumb.jpg',
        ]);
    }

    private function createLegacyLiveTables(): void
    {
        foreach (['urt_show_live_tag_date', 'urt_video_live_log', 'urt_show_video_live', 'urt_video_live', 'urt_channel', 'urt_count', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->integer('flag_del')->nullable();
        });

        Schema::create('urt_video_live', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->dateTime('actualStartTime')->nullable();
            $table->dateTime('scheduledStartTime')->nullable();
            $table->dateTime('actualEndTime')->nullable();
            $table->integer('concurrentViewers')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
        });

        Schema::create('urt_show_video_live', function ($table): void {
            $table->integer('pk_live');
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('channelTitle');
            $table->string('title');
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });
    }

    private function createLiveTagCacheTable(): void
    {
        Schema::create('urt_show_live_tag_date', function ($table): void {
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
            $table->text('hour_result')->nullable();
            $table->text('videos_result')->nullable();
            $table->longText('all_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
    }
}
