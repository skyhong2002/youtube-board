<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelVideosRouteTest extends TestCase
{
    public function test_channel_videos_renders_recent_videos_and_comment_summary(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Profile Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);
        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-included',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 11:00:00',
                'channelTitle' => 'Profile Channel',
                'title' => 'Included Channel Video',
                'thumbnails' => 'https://example.test/included.jpg',
                'viewCount' => 2000,
                'likeCount' => 100,
                'dislikeCount' => 0,
                'commentCount' => 5,
            ],
            [
                'videoId' => 'video-old',
                'u_id' => 10,
                'publishedAt' => '2026-05-22 11:00:00',
                'channelTitle' => 'Profile Channel',
                'title' => 'Old Channel Video',
                'thumbnails' => 'https://example.test/old.jpg',
                'viewCount' => 9000,
                'likeCount' => 90,
                'dislikeCount' => 0,
                'commentCount' => 9,
            ],
            [
                'videoId' => 'video-low',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 10:00:00',
                'channelTitle' => 'Profile Channel',
                'title' => 'Low Channel Video',
                'thumbnails' => 'https://example.test/low.jpg',
                'viewCount' => 10,
                'likeCount' => 1,
                'dislikeCount' => 0,
                'commentCount' => 1,
            ],
        ]);
        DB::table('urt_comment')->insert([
            'videoId' => 'video-included',
            'comments_count' => 20,
            'authors_count' => 8,
            'replies_count' => 3,
            'likes_count' => 12,
        ]);

        $response = $this->get('/channels/10/videos?hours=24&min=1000');

        $response->assertOk();
        $response->assertSee('Profile Channel 24小時內觀看最多的影片');
        $response->assertSee('Included Channel Video');
        $response->assertSee('2,000');
        $response->assertSee('20');
        $response->assertSee('83.3%');
        $response->assertSee('8');
        $response->assertDontSee('Old Channel Video');
        $response->assertDontSee('Low Channel Video');

        Carbon::setTestNow();
    }

    private function createTables(): void
    {
        foreach (['urt_comment', 'urt_video', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('channelTitle');
            $table->string('title');
            $table->string('thumbnails')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('dislikeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_comment', function ($table): void {
            $table->string('videoId');
            $table->integer('comments_count')->nullable();
            $table->integer('authors_count')->nullable();
            $table->integer('replies_count')->nullable();
            $table->integer('likes_count')->nullable();
        });
    }
}
