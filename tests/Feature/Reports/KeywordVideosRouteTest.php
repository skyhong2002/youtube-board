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

    public function test_keyword_videos_page_reads_wrapped_and_list_relation_payloads(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_show_video_tag_date')->insert([
            [
                'pk' => 3,
                'ctime' => '2026-05-25 00:00:00',
                'mtime' => '2026-05-25 01:00:00',
                'the_date' => '2026-05-25',
                'tag' => '蔡英文',
                'count_videos' => 2,
                'count_tags' => 2,
                'count_channels' => 1,
                'videos_json' => json_encode([
                    'videos' => [
                        ['videoId' => 'video-list-a'],
                        'video-list-b',
                    ],
                ], JSON_UNESCAPED_UNICODE),
                'tags_json' => json_encode(['政策' => 3], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-list-a',
                'u_id' => 10,
                'thumbnails' => 'https://example.test/list-a.jpg',
                'channelTitle' => 'Channel A',
                'publishedAt' => '2026-05-25 10:00:00',
                'title' => '列表影片 A',
                'viewCount' => 1000,
                'likeCount' => 10,
                'commentCount' => 3,
            ],
            [
                'videoId' => 'video-list-b',
                'u_id' => 11,
                'thumbnails' => 'https://example.test/list-b.jpg',
                'channelTitle' => 'Channel B',
                'publishedAt' => '2026-05-25 11:00:00',
                'title' => '列表影片 B',
                'viewCount' => 3000,
                'likeCount' => 20,
                'commentCount' => 8,
            ],
        ]);

        $response = $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/videos?days=1&hours=24&limit=10');

        $response->assertOk();
        $response->assertSee('列表影片 B');
        $response->assertSee('列表影片 A');
    }

    public function test_keyword_videos_page_derives_from_raw_video_titles_when_relation_cache_is_empty(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video')->insert([
            [
                'videoId' => 'birthrate-video',
                'u_id' => 10,
                'thumbnails' => 'https://example.test/birthrate.jpg',
                'channelTitle' => 'Policy Channel',
                'publishedAt' => '2026-05-25 09:00:00',
                'title' => '少子化政策說明',
                'viewCount' => 4500,
                'likeCount' => 30,
                'commentCount' => 9,
            ],
            [
                'videoId' => 'other-video',
                'u_id' => 11,
                'thumbnails' => 'https://example.test/other.jpg',
                'channelTitle' => 'Other Channel',
                'publishedAt' => '2026-05-25 09:30:00',
                'title' => '其他政策說明',
                'viewCount' => 9000,
                'likeCount' => 40,
                'commentCount' => 10,
            ],
        ]);

        $response = $this->get('/keywords/%E5%B0%91%E5%AD%90%E5%8C%96/videos?days=1&hours=24&limit=10');

        $response->assertOk();
        $response->assertSee('少子化 在 24小時內觀看最多的影片');
        $response->assertSee('urt_video title/description derived real-time YouTube dashboard');
        $response->assertSee('Policy Channel');
        $response->assertSee('少子化政策說明');
        $response->assertSee('4,500');
        $response->assertDontSee('Data unavailable locally');
        $response->assertDontSee('Other Channel');
        $this->assertSame(0, DB::table('urt_show_video_tag_date')->count());

        Carbon::setTestNow();
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
