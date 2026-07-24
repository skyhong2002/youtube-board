<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class VideoDetailRouteTest extends TestCase
{
    public function test_video_detail_renders_legacy_video_metadata_and_live_summary(): void
    {
        $this->createTables();
        $this->insertVideoFixture();

        $response = $this->get('/videos/video-a');

        $response->assertOk();
        $response->assertSee('測試影片');
        $response->assertSee('測試頻道');
        $response->assertSee('觀看 1,200');
        $response->assertSee('直播 log 2');
        $response->assertSee('直播趨勢');
        $response->assertSee('影片統計歷史');
        $response->assertSee('2026-05-21');
        $response->assertDontSee('/maint/get_comment.php');
    }

    public function test_video_analytics_renders_comment_and_history_data_ingestion(): void
    {
        $this->createTables();
        $this->insertVideoFixture();

        $response = $this->get('/videos/video-a/analytics?limit=10');

        $response->assertOk();
        $response->assertSee('測試影片 留言分析');
        $response->assertSee('留言 2');
        $response->assertSee('留言者 1');
        $response->assertSee('Alice');
        $response->assertSee('第一則留言');
        $response->assertSee('回覆留言');
        $response->assertSee('2026-05-21');
        // Comments published 12:00Z/12:30Z bucket into the Asia/Taipei hour (20:00),
        // not the UTC hour (12:00). Locks the timezone-correct comment bucketing.
        $response->assertSee('05-21 20');
        $response->assertDontSee('/maint/get_comment.php');
    }

    public function test_video_detail_reports_missing_local_rows_with_ingestion_guidance(): void
    {
        $this->createTables();

        $response = $this->get('/videos/missing-video');

        $response->assertOk();
        $response->assertSee('找不到這支影片的本機 legacy 資料');
        $response->assertDontSee('/maint/get_comment.php');

        $analytics = $this->get('/videos/missing-video/analytics');

        $analytics->assertOk();
        $analytics->assertSee('Laravel 不會提供 legacy 留言抓取連結');
        $analytics->assertDontSee('/maint/get_comment.php');
    }

    public function test_legacy_video_urls_redirect_to_clean_video_pages(): void
    {
        $this->get('/video.php?videoId=video-a&debug=0')
            ->assertStatus(308)
            ->assertRedirect(route('videos.show', [
                'videoId' => 'video-a',
                'debug' => '0',
            ]));

        $this->get('/video_data_att.php?videoId=video-a&limit=20')
            ->assertStatus(308)
            ->assertRedirect(route('videos.analytics', [
                'videoId' => 'video-a',
                'limit' => '20',
            ]));

        $this->get('/video_data.php?videoId=video-a')
            ->assertStatus(308)
            ->assertRedirect(route('videos.analytics', [
                'videoId' => 'video-a',
            ]));
    }

    public function test_video_detail_treats_statistics_history_as_local_data(): void
    {
        $this->createTables();

        // Only the monthly statistics history exists — no urt_video metadata row.
        DB::table('urt_video_log')->insert([
            'pk' => 1,
            'ctime' => '2026-05-21 00:00:00',
            'videoId' => 'history-only',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-20' => ['view' => 900, 'like' => 20, 'comment' => 1],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/videos/history-only');

        $response->assertOk();
        $response->assertSee('本機有其他影片相關資料');
        $response->assertDontSee('找不到這支影片的本機 legacy 資料');
        $response->assertSee('影片統計歷史');
    }

    public function test_video_analytics_counts_reflect_totals_not_the_display_limit_when_aggregates_missing(): void
    {
        $this->createTables();
        $this->insertVideoFixture();

        // Legacy row without stored aggregates: 5 comments from 3 authors.
        DB::table('urt_comment')->where('videoId', 'video-a')->update([
            'comments_count' => null,
            'authors_count' => null,
            'authors_json' => json_encode([
                'author-a' => ['DisplayName' => 'Alice'],
                'author-b' => ['DisplayName' => 'Bob'],
                'author-c' => ['DisplayName' => 'Carol'],
            ], JSON_UNESCAPED_UNICODE),
            'comments_json' => json_encode([
                'c1' => ['publishedAt' => '2026-05-21T12:00:00Z', 'authorChannelId' => 'author-a', 'textDisplay' => 'a1', 'likeCount' => 5],
                'c2' => ['publishedAt' => '2026-05-21T12:01:00Z', 'authorChannelId' => 'author-a', 'textDisplay' => 'a2', 'likeCount' => 4],
                'c3' => ['publishedAt' => '2026-05-21T12:02:00Z', 'authorChannelId' => 'author-b', 'textDisplay' => 'b1', 'likeCount' => 3],
                'c4' => ['publishedAt' => '2026-05-21T12:03:00Z', 'authorChannelId' => 'author-b', 'textDisplay' => 'b2', 'likeCount' => 2],
                'c5' => ['publishedAt' => '2026-05-21T12:04:00Z', 'authorChannelId' => 'author-c', 'textDisplay' => 'c1', 'likeCount' => 1],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        // limit=2 truncates the displayed lists, but the fallback counts must
        // reflect the true totals (5 comments / 3 authors), not the limit.
        $response = $this->get('/videos/video-a/analytics?limit=2');

        $response->assertOk();
        $response->assertSee('留言 5');
        $response->assertSee('留言者 3');
    }

    private function insertVideoFixture(): void
    {
        DB::table('urt_video')->insert([
            'pk' => 1,
            'ctime' => '2026-05-21 10:00:00',
            'u_id' => 10,
            'id' => 'playlist-item-a',
            'publishedAt' => '2026-05-21 09:00:00',
            'channelId' => 'channel-a',
            'title' => '測試影片',
            'thumbnails' => 'https://example.test/thumb.jpg',
            'channelTitle' => '測試頻道',
            'playlistId' => 'uploads',
            'position' => 1,
            'videoId' => 'video-a',
            'viewCount' => 1200,
            'likeCount' => 34,
            'dislikeCount' => 0,
            'favoriteCount' => 0,
            'commentCount' => 2,
            'description' => '影片說明',
        ]);

        DB::table('urt_video_duration')->insert([
            'pk_video' => 1,
            'ctime' => '2026-05-21 10:00:00',
            'u_id' => 10,
            'videoId' => 'video-a',
            'duration' => 125,
            'caption' => 'true',
        ]);

        DB::table('urt_video_live_log')->insert([
            [
                'pk' => 1,
                'videoId' => 'video-a',
                'u_id' => 10,
                'the_date' => '2026-05-20',
                'ctime' => '2026-05-20 00:00:00',
                'max_current' => 140,
                'log_json' => json_encode(['10:00' => 100, '11:00' => 140], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'videoId' => 'video-a',
                'u_id' => 10,
                'the_date' => '2026-05-21',
                'ctime' => '2026-05-21 00:00:00',
                'max_current' => 220,
                'log_json' => json_encode(['10:00' => 180, '11:00' => 220], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_video_log')->insert([
            'pk' => 1,
            'ctime' => '2026-05-21 00:00:00',
            'videoId' => 'video-a',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-20' => ['view' => 900, 'like' => 20, 'comment' => 1],
                '2026-05-21' => ['view' => 1200, 'like' => 34, 'comment' => 2],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_comment')->insert([
            'pk' => 1,
            'videoId' => 'video-a',
            'ctime' => '2026-05-21 12:00:00',
            'mtime' => '2026-05-21 13:00:00',
            'comments_count' => 2,
            'latest_time' => '2026-05-21 12:30:00',
            'likes_count' => 7,
            'threads_count' => 1,
            'replies_count' => 1,
            'authors_count' => 1,
            'authors_json' => json_encode([
                'author-a' => [
                    'DisplayName' => 'Alice',
                    'ChannelUrl' => 'https://youtube.test/author-a',
                    'ImageUrl' => 'https://example.test/a.jpg',
                ],
            ], JSON_UNESCAPED_UNICODE),
            'comments_json' => json_encode([
                'comment-a' => [
                    'publishedAt' => '2026-05-21T12:00:00Z',
                    'authorChannelId' => 'author-a',
                    'textDisplay' => '第一則留言',
                    'likeCount' => 5,
                    'replies' => [
                        [
                            'publishedAt' => '2026-05-21T12:30:00Z',
                            'authorChannelId' => 'author-a',
                            'textDisplay' => '回覆留言',
                            'likeCount' => 2,
                        ],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);
    }

    private function createTables(): void
    {
        foreach (['urt_comment', 'urt_video_log', 'urt_video_live_log', 'urt_video_duration', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('u_id');
            $table->string('id');
            $table->dateTime('publishedAt');
            $table->string('channelId');
            $table->string('title');
            $table->string('thumbnails');
            $table->string('channelTitle');
            $table->string('playlistId');
            $table->integer('position');
            $table->string('videoId');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('dislikeCount')->nullable();
            $table->integer('favoriteCount')->nullable();
            $table->integer('commentCount')->nullable();
            $table->text('description');
        });

        Schema::create('urt_video_duration', function ($table): void {
            $table->integer('pk_video');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->integer('u_id')->nullable();
            $table->string('videoId');
            $table->integer('duration')->nullable();
            $table->string('caption')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->integer('pk');
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });

        Schema::create('urt_video_log', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('videoId');
            $table->date('themonth');
            $table->text('thedata')->nullable();
        });

        Schema::create('urt_comment', function ($table): void {
            $table->integer('pk');
            $table->string('videoId');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->integer('likes_count')->nullable();
            $table->integer('threads_count')->nullable();
            $table->integer('replies_count')->nullable();
            $table->integer('authors_count')->nullable();
            $table->string('pageToken')->nullable();
            $table->string('channelId')->nullable();
            $table->integer('u_id')->nullable();
            $table->text('authors_json')->nullable();
            $table->text('comments_json')->nullable();
        });
    }
}
