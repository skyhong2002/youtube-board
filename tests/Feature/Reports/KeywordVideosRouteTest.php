<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class KeywordVideosRouteTest extends TestCase
{
    public function test_keyword_videos_page_reads_relation_cache_and_video_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_show_video_tag_date')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-25 00:00:00',
                'mtime' => '2026-05-25 01:00:00',
                'the_date' => '2026-05-25',
                'tag' => '蔡英文',
                'count_videos' => 1,
                'count_tags' => 2,
                'count_channels' => 1,
                'videos_json' => json_encode(['video-a' => 10], JSON_UNESCAPED_UNICODE),
                'tags_json' => json_encode(['政策' => 3], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'the_date' => '2026-05-24',
                'tag' => '蔡英文',
                'count_videos' => 1,
                'count_tags' => 2,
                'count_channels' => 1,
                'videos_json' => json_encode(['video-b' => 11], JSON_UNESCAPED_UNICODE),
                'tags_json' => json_encode(['國會' => 2], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'thumbnails' => 'https://example.test/a.jpg',
                'channelTitle' => 'Channel A',
                'publishedAt' => '2026-05-25 10:00:00',
                'title' => '政策說明',
                'viewCount' => 1000,
                'likeCount' => 10,
                'commentCount' => 3,
            ],
            [
                'videoId' => 'video-b',
                'u_id' => 11,
                'thumbnails' => 'https://example.test/b.jpg',
                'channelTitle' => 'Channel B',
                'publishedAt' => '2026-05-24 10:00:00',
                'title' => '國會新聞',
                'viewCount' => 3000,
                'likeCount' => 20,
                'commentCount' => 8,
            ],
        ]);

        $response = $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/videos?days=1&hours=24&limit=10');

        $response->assertOk();
        $response->assertSee('蔡英文 在 24小時內觀看最多的影片');
        $response->assertSee('蔡英文 關鍵字影片');
        $response->assertSee('Channel B');
        $response->assertSee('國會新聞');
        $response->assertSee('3,000');
        $response->assertSee('Channel A');
        $response->assertSee('政策說明');
        $response->assertSee('tag_video.php + api/tags_relation_date.php');
        $this->assertSame(2, DB::table('urt_show_video_tag_date')->count());
    }

    private function createTables(): void
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

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });
    }
}
