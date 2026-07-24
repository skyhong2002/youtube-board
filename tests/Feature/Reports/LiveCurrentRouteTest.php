<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LiveCurrentRouteTest extends TestCase
{
    public function test_live_current_page_renders_collapsed_lineage_profile(): void
    {
        $response = $this->get('/live/current?or=1,2,12&not=9');

        $response->assertOk();
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('class="lineage-panel" hidden', false);
        $response->assertSee('data-lineage-graph', false);
        $response->assertSee('urt_video_live');
        $response->assertSee('youtube:live:poll --execute --limit=50');
        $response->assertSee('YouTube Data API videos.list(part=liveStreamingDetails)');
        $response->assertSee('reports:live:build --execute --hours=24 --limit=100');
        $response->assertSee('固定規則：隨部署更新');
    }

    public function test_live_current_page_loads_with_legacy_filters(): void
    {
        $response = $this->get('/live/current?or=1,2,12&not=9');

        $response->assertOk();
        $response->assertSee('目前直播排行');
        $response->assertSee('or');
        $response->assertSee('1,2,12');
        $response->assertSee('not');
        $response->assertSee('9');
    }

    public function test_live_current_page_renders_imported_legacy_rows(): void
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
        DB::table('urt_video_live')->insert([
            'videoId' => 'abc123',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 17:00:00',
            'actualStartTime' => '2026-05-24 17:10:00',
            'scheduledStartTime' => null,
            'actualEndTime' => null,
            'concurrentViewers' => 1234,
            'mtime' => '2026-05-24 17:50:00',
            'max_current' => 2400,
        ]);
        DB::table('urt_show_video_live')->insert([
            'pk_live' => 1,
            'videoId' => 'abc123',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 17:00:00',
            'channelTitle' => 'Example Channel',
            'title' => 'Example Live Title',
            'thumbnails' => 'https://example.test/thumb.jpg',
        ]);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'abc123',
            'u_id' => 10,
            'the_date' => '2026-05-24',
            'max_current' => 2000,
            'log_json' => json_encode(['17:40' => 800, '17:50' => 1234]),
        ]);

        $response = $this->get('/live/current?or=1');

        $response->assertOk();
        $response->assertSee('Example Channel');
        $response->assertSee('Example Live Title');
        $response->assertSee('1,234');
        $response->assertSee('2,000');
        $response->assertSee('社論');

        Carbon::setTestNow();
    }

    public function test_live_current_page_keeps_active_stream_without_a_same_day_log_row(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();

        DB::table('urt_tag')->insert(['tag_id' => 1, 'tag_name' => '社論']);
        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '[1]']);
        // Newly discovered stream: actively live with viewers, but polling has
        // not written today's urt_video_live_log row yet.
        DB::table('urt_video_live')->insert([
            'videoId' => 'fresh99',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 17:40:00',
            'actualStartTime' => '2026-05-24 17:45:00',
            'scheduledStartTime' => null,
            'actualEndTime' => null,
            'concurrentViewers' => 500,
            'mtime' => '2026-05-24 17:55:00',
            'max_current' => null,
        ]);
        DB::table('urt_show_video_live')->insert([
            'pk_live' => 1,
            'videoId' => 'fresh99',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 17:40:00',
            'channelTitle' => 'Fresh Channel',
            'title' => 'Fresh Live Title',
            'thumbnails' => 'https://example.test/fresh.jpg',
        ]);

        $response = $this->get('/live/current?or=1');

        $response->assertOk();
        $response->assertSee('Fresh Channel');
        $response->assertSee('Fresh Live Title');
        $response->assertSee('500');

        Carbon::setTestNow();
    }

    private function createLegacyLiveTables(): void
    {
        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
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
}
