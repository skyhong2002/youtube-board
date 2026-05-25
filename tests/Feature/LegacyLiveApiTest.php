<?php

namespace Tests\Feature;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LegacyLiveApiTest extends TestCase
{
    public function test_legacy_live_day_api_returns_video_log_series(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveLogTable();

        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'live-a',
                'u_id' => 10,
                'the_date' => '2026-05-23',
                'max_current' => 300,
                'log_json' => json_encode(['10:00' => 120, '10:30' => 300]),
            ],
            [
                'videoId' => 'live-a',
                'u_id' => 10,
                'the_date' => '2026-05-24',
                'max_current' => 700,
                'log_json' => json_encode(['11:00' => 400, '11:30' => 700]),
            ],
        ]);

        $response = $this->getJson('/api/api_live_day.php?videoId=live-a&from=2026-05-23&to=2026-05-24');

        $response->assertOk();
        $response->assertJsonPath('meta.available', true);
        $response->assertJsonPath('meta.read_only', true);
        $this->assertSame(300, $response->json('result')['2026-05-23']['10:30']);
        $this->assertSame(700, $response->json('result')['2026-05-24']['11:30']);

        Carbon::setTestNow();
    }

    public function test_legacy_live_date_api_uses_cache_or_derives_without_writes(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveDateTables();

        DB::table('urt_show_live_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'the_date' => '2026-05-24',
            'return_json' => json_encode([
                'result' => [
                    'tag' => ['max' => ['1' => 900], 'count' => ['1' => 1]],
                    'video' => [['videoId' => 'cached-live', 'title' => 'Cached Live']],
                    'hour' => ['10' => ['cached-live' => 900]],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $cached = $this->getJson('/api/api_live_date.php?date=2026-05-24');
        $cached->assertOk();
        $cached->assertJsonPath('meta.source', 'urt_show_live_date.return_json');
        $cached->assertJsonPath('result.video.0.videoId', 'cached-live');

        DB::table('urt_count')->insert([
            'u_id' => 10,
            'tags' => '[1][13]',
        ]);
        DB::table('urt_show_video_live')->insert([
            'videoId' => 'derived-live',
            'u_id' => 10,
            'channelTitle' => 'Derived Channel',
            'title' => 'Derived Live',
            'thumbnails' => 'https://example.test/derived.jpg',
            'publishedAt' => '2026-05-23 10:00:00',
        ]);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'derived-live',
            'u_id' => 10,
            'the_date' => '2026-05-23',
            'max_current' => 500,
            'log_json' => json_encode(['10:00' => 120, '10:30' => 500, '11:00' => 300]),
        ]);

        $derived = $this->getJson('/api/api_live_date.php?date=2026-05-23');

        $derived->assertOk();
        $derived->assertJsonPath('meta.source', 'urt_video_live_log derived read-only');
        $derived->assertJsonPath('result.video.0.videoId', 'derived-live');
        $derived->assertJsonPath('result.hour.10.derived-live', 500);
        $this->assertSame(500, $derived->json('result')['tag']['max'][1]);
        $this->assertSame(1, DB::table('urt_show_live_date')->count());

        Carbon::setTestNow();
    }

    public function test_legacy_live_hour_api_expands_log_json_hourly_peaks(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveLogTable();

        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'hour-a',
                'u_id' => 10,
                'the_date' => '2026-05-24',
                'max_current' => 900,
                'log_json' => json_encode(['10:00' => 100, '10:30' => 500, '11:00' => 900]),
            ],
            [
                'videoId' => 'hour-b',
                'u_id' => 20,
                'the_date' => '2026-05-24',
                'max_current' => 300,
                'log_json' => json_encode(['10:10' => 300]),
            ],
        ]);

        $response = $this->getJson('/api/api_live_hour.php?date=2026-05-24');

        $response->assertOk();
        $response->assertJsonPath('meta.available', true);
        $this->assertSame(500, $response->json('result')['2026-05-24 10']['hour-a']);
        $this->assertSame(300, $response->json('result')['2026-05-24 10']['hour-b']);
        $this->assertSame(900, $response->json('result')['2026-05-24 11']['hour-a']);

        Carbon::setTestNow();
    }

    public function test_legacy_live_tag_date_api_reads_cache_and_does_not_generate_missing_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveTagCacheTable();

        DB::table('urt_show_live_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tagid' => '1,13',
            'tag_or' => '',
            'tag_not' => '9',
            'the_date' => '2026-05-24',
            'count_channels' => 2,
            'count_videos' => 3,
            'count_tags' => 4,
            'tags_count' => 2,
            'total_views' => 1200,
            'hour_result' => json_encode(['10' => ['count' => 2, 'views' => 900]], JSON_UNESCAPED_UNICODE),
            'videos_result' => json_encode(['live-a' => ['10' => 900]], JSON_UNESCAPED_UNICODE),
            'all_result' => json_encode(['videos' => ['10' => 2], 'views' => ['10' => 900]], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['川普' => ['10' => 2]], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['川普' => ['10' => 900]], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_live_tag_date.php?tagid=13,1&not=9&date=2026-05-24');

        $response->assertOk();
        $response->assertJsonPath('meta.available', true);
        $response->assertJsonPath('meta.filters.tagid_string', '1,13');
        $response->assertJsonPath('meta.counts.total_views', 1200);
        $this->assertSame(900, $response->json('result')['views']['川普']['10']);

        $missing = $this->getJson('/api/api_live_tag_date.php?tagid=99&date=2026-05-24');
        $missing->assertOk();
        $missing->assertJsonPath('meta.available', false);
        $this->assertSame(1, DB::table('urt_show_live_tag_date')->count());

        Carbon::setTestNow();
    }

    public function test_legacy_live_tag_date_api_reads_wrapped_cache_columns(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveTagCacheTable();

        DB::table('urt_show_live_tag_date')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => '2026-05-24 01:00:00',
            'tagid' => '',
            'tag_or' => '',
            'tag_not' => '',
            'the_date' => '2026-05-24',
            'count_channels' => 2,
            'count_videos' => 3,
            'count_tags' => 4,
            'tags_count' => 2,
            'total_views' => 1200,
            'hour_result' => json_encode(['hour' => ['10' => ['count' => 2, 'views' => 900]]], JSON_UNESCAPED_UNICODE),
            'videos_result' => json_encode(['data' => ['live-a' => ['10' => 900]]], JSON_UNESCAPED_UNICODE),
            'all_result' => json_encode(['all' => ['videos' => ['10' => 2], 'views' => ['10' => 900]]], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['tags_video' => ['川普' => ['10' => 2]]], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['tags_views' => ['川普' => ['10' => 900]]], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->getJson('/api/api_live_tag_date.php?date=2026-05-24');

        $response->assertOk();
        $this->assertSame(900, $response->json('result')['views']['川普']['10']);
        $this->assertSame(2, $response->json('result')['videos']['川普']['10']);
        $this->assertSame(900, $response->json('result')['hour']['10']['views']);
        $this->assertSame(900, $response->json('result')['data']['live-a']['10']);

        Carbon::setTestNow();
    }

    public function test_legacy_live_date_list_api_filters_logs_without_generating_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveDateTables();

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]'],
            ['u_id' => 20, 'tags' => '[1][9]'],
        ]);
        DB::table('urt_show_video_live')->insert([
            [
                'videoId' => 'included-live',
                'u_id' => 10,
                'channelTitle' => 'Included Channel',
                'title' => 'Included Live',
                'thumbnails' => 'https://example.test/included.jpg',
                'publishedAt' => '2026-05-24 10:00:00',
            ],
            [
                'videoId' => 'excluded-live',
                'u_id' => 20,
                'channelTitle' => 'Excluded Channel',
                'title' => 'Excluded Live',
                'thumbnails' => 'https://example.test/excluded.jpg',
                'publishedAt' => '2026-05-24 10:00:00',
            ],
        ]);
        DB::table('urt_video_live_log')->insert([
            ['videoId' => 'included-live', 'u_id' => 10, 'the_date' => '2026-05-24', 'max_current' => 900, 'log_json' => json_encode(['10:00' => 300, '10:30' => 900])],
            ['videoId' => 'excluded-live', 'u_id' => 20, 'the_date' => '2026-05-24', 'max_current' => 5000, 'log_json' => json_encode(['10:00' => 5000])],
        ]);

        $response = $this->getJson('/api/live_date.php?tagid=1&not=9&date=2026-05-24&sorting=1');

        $response->assertOk();
        $response->assertJsonPath('meta.read_only', true);
        $response->assertJsonPath('count_videos', 1);
        $response->assertJsonPath('result.0.videoId', 'included-live');
        $response->assertJsonPath('result.0.max_current', 900);
        $response->assertJsonMissing(['videoId' => 'excluded-live']);
        $this->assertSame(0, DB::table('urt_show_live_date')->count());

        Carbon::setTestNow();
    }

    public function test_legacy_live_tvbs_api_returns_tvbs_log_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createTvbsLogTable();

        DB::table('urt_video_live_log_tvbs')->insert([
            'videoId' => 'tvbs-live',
            'u_id' => 50,
            'the_date' => '2026-05-24',
            'max_current' => 1200,
            'log_json' => json_encode(['10:00' => 1200]),
        ]);

        $response = $this->getJson('/api/live_tvbs.php?date=2026-05-24');

        $response->assertOk();
        $response->assertJsonPath('meta.read_only', true);
        $response->assertJsonPath('count_videos', 1);
        $response->assertJsonPath('result.tvbs-live.videoId', 'tvbs-live');

        Carbon::setTestNow();
    }

    public function test_legacy_video_live_html_and_csv_live_line_are_read_only(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createLiveLogTable();
        Schema::create('urt_video_live', function ($table): void {
            $table->string('videoId');
            $table->integer('concurrentViewers')->nullable();
        });

        DB::table('urt_video_live')->insert([
            'videoId' => 'spark-live',
            'concurrentViewers' => 1234,
        ]);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'spark-live',
            'u_id' => 10,
            'the_date' => '2026-05-24',
            'max_current' => 900,
            'log_json' => json_encode(['10:00' => 300, '10:30' => 500, '11:00' => 900]),
        ]);

        $html = $this->get('/api/video_live.php?videoId=spark-live&date=2026-05-24');
        $html->assertOk();
        $html->assertSee('目前：1,234 人');
        $html->assertSee('最高：900 人');
        $html->assertSee('var myvalues = [300,500,900]', false);

        $csv = $this->get('/api/csv_live_line.php?videoId=spark-live&limit=1');
        $csv->assertOk();
        $csv->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('"2026-05-24 10:00:00",500', $csv->getContent());
        $this->assertStringContainsString('"2026-05-24 11:00:00",900', $csv->getContent());

        Carbon::setTestNow();
    }

    private function createLiveDateTables(): void
    {
        $this->createLiveLogTable();

        Schema::create('urt_show_live_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('the_date');
            $table->longText('return_json')->nullable();
        });

        Schema::create('urt_show_video_live', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('channelTitle')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->text('tags')->nullable();
        });
    }

    private function createLiveLogTable(): void
    {
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

    private function createTvbsLogTable(): void
    {
        Schema::create('urt_video_live_log_tvbs', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });
    }
}
