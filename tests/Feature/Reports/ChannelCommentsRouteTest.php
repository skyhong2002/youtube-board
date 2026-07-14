<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelCommentsRouteTest extends TestCase
{
    public function test_channel_comments_page_renders_legacy_author_ranking(): void
    {
        $this->createTables();
        $this->seedChannelComments();

        $response = $this->get('/channels/10/comments?hours=72&limit=10');

        $response->assertOk();
        $response->assertSee('頻道留言');
        $response->assertSee('Example Channel 在 72 小時內最多留言者');
        $response->assertSee('留言者排行');
        $response->assertSee('來源影片');
        $response->assertSee('留言王');
        $response->assertSee('路人甲');
        $response->assertSee('頻道影片 A');
        $response->assertSee('hours=72');
    }

    public function test_channel_comments_page_uses_authors_json_when_count_columns_are_empty(): void
    {
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);
        DB::table('urt_video')->insert([
            'videoId' => 'video-json-only',
            'u_id' => 10,
            'title' => 'JSON-only comments video',
            'thumbnails' => 'https://example.test/video-json-only.jpg',
            'viewCount' => 3000,
            'publishedAt' => now('Asia/Taipei')->subHours(2)->format('Y-m-d H:i:s'),
        ]);
        DB::table('urt_comment')->insert([
            'videoId' => 'video-json-only',
            'u_id' => 10,
            'authors_count' => null,
            'comments_count' => null,
            'latest_time' => now('Asia/Taipei')->subHour()->format('Y-m-d H:i:s'),
            'authors_json' => json_encode([
                [
                    'ChannelId' => 'UC-list-author',
                    'DisplayName' => '列表留言者',
                    'ImageUrl' => 'https://example.test/list-author.jpg',
                    'ChannelUrl' => 'https://youtube.test/list-author',
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/channels/10/comments?hours=72&limit=10');

        $response->assertOk();
        $response->assertSee('列表留言者');
        $response->assertSee('JSON-only comments video');
    }

    public function test_channel_comments_page_hides_incomplete_comment_staging_rows(): void
    {
        $this->createTables();

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);
        DB::table('urt_video')->insert([
            'videoId' => 'video-partial',
            'u_id' => 10,
            'title' => 'Partial comments video',
            'thumbnails' => 'https://example.test/video-partial.jpg',
            'viewCount' => 3000,
            'publishedAt' => now('Asia/Taipei')->subHour()->format('Y-m-d H:i:s'),
        ]);
        DB::table('urt_comment')->insert([
            'videoId' => 'video-partial',
            'u_id' => 10,
            'authors_count' => 1,
            'comments_count' => 1,
            'latest_time' => now('Asia/Taipei')->subMinutes(30)->format('Y-m-d H:i:s'),
            'pageToken' => 'NEXT-PAGE',
            'authors_json' => json_encode([
                'UC-partial' => ['DisplayName' => 'Partial Author'],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $this->get('/channels/10/comments?hours=72&limit=10')
            ->assertOk()
            ->assertDontSee('Partial Author')
            ->assertDontSee('Partial comments video');
    }

    private function createTables(): void
    {
        foreach (['urt_channel', 'urt_video', 'urt_comment', 'urt_comment_author'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->integer('viewCount')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_comment', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->integer('authors_count')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->string('pageToken')->nullable();
            $table->text('authors_json')->nullable();
        });

        Schema::create('urt_comment_author', function ($table): void {
            $table->integer('author_id')->nullable();
            $table->string('ChannelId')->nullable();
        });
    }

    private function seedChannelComments(): void
    {
        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);

        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'title' => '頻道影片 A',
                'thumbnails' => 'https://example.test/video-a.jpg',
                'viewCount' => 3000,
                'publishedAt' => now('Asia/Taipei')->subHours(2)->format('Y-m-d H:i:s'),
            ],
            [
                'videoId' => 'old-video',
                'u_id' => 10,
                'title' => '太舊影片',
                'thumbnails' => 'https://example.test/old.jpg',
                'viewCount' => 5000,
                'publishedAt' => now('Asia/Taipei')->subDays(10)->format('Y-m-d H:i:s'),
            ],
        ]);

        DB::table('urt_comment')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'authors_count' => 2,
                'comments_count' => 8,
                'latest_time' => now('Asia/Taipei')->subHour()->format('Y-m-d H:i:s'),
                'authors_json' => json_encode([
                    'UC-author' => [
                        'DisplayName' => '留言王',
                        'ImageUrl' => 'https://example.test/author.jpg',
                        'ChannelUrl' => 'https://youtube.test/author',
                    ],
                    'UC-other' => [
                        'DisplayName' => '路人甲',
                        'ImageUrl' => 'https://example.test/other.jpg',
                        'ChannelUrl' => 'https://youtube.test/other',
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'videoId' => 'old-video',
                'u_id' => 10,
                'authors_count' => 1,
                'comments_count' => 1,
                'latest_time' => now('Asia/Taipei')->subDays(9)->format('Y-m-d H:i:s'),
                'authors_json' => json_encode([
                    'UC-old' => ['DisplayName' => '不應出現'],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
