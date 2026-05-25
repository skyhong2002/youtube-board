<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagCommentsRouteTest extends TestCase
{
    public function test_tag_comments_page_renders_recent_comment_videos_and_author_ranking(): void
    {
        $this->createTables();
        $this->seedCommentRows();

        $response = $this->get('/tags/1/comments?limit=5&not=9');

        $response->assertOk();
        $response->assertSee('社論 標籤近期留言');
        $response->assertSee('近期留言影片');
        $response->assertSee('留言者排行');
        $response->assertSee('頻道 A');
        $response->assertSee('影片 A');
        $response->assertSee('留言王');
        $response->assertSee('路人甲');
        $response->assertSee('not=9');
        $response->assertDontSee('/maint/get_comment.php', false);
    }

    public function test_tag_comments_page_supports_or_filter_without_route_tag(): void
    {
        $this->createTables();
        $this->seedCommentRows();

        $this->get('/tags/comments?or=1&limit=5')
            ->assertOk()
            ->assertSee('社論 標籤近期留言')
            ->assertSee('影片 A')
            ->assertSee('or=1');
    }

    private function createTables(): void
    {
        foreach (['urt_tag', 'urt_count', 'urt_video', 'urt_comment', 'urt_comment_author'] as $table) {
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

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
            $table->string('thumbnails')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_comment', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->integer('authors_count')->nullable();
            $table->integer('likes_count')->nullable();
            $table->integer('threads_count')->nullable();
            $table->integer('replies_count')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->text('authors_json')->nullable();
        });

        Schema::create('urt_comment_author', function ($table): void {
            $table->integer('author_id')->nullable();
            $table->string('ChannelId')->nullable();
        });
    }

    private function seedCommentRows(): void
    {
        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 9, 'tag_name' => '排除'],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][3]'],
            ['u_id' => 20, 'tags' => '[9]'],
        ]);

        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'title' => '影片 A',
                'channelTitle' => '頻道 A',
                'thumbnails' => 'https://example.test/video-a.jpg',
                'publishedAt' => '2026-05-24 08:00:00',
            ],
            [
                'videoId' => 'video-excluded',
                'u_id' => 20,
                'title' => '不應出現',
                'channelTitle' => '排除頻道',
                'thumbnails' => 'https://example.test/excluded.jpg',
                'publishedAt' => '2026-05-24 08:00:00',
            ],
        ]);

        DB::table('urt_comment')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'authors_count' => 2,
                'likes_count' => 11,
                'threads_count' => 3,
                'replies_count' => 4,
                'comments_count' => 7,
                'latest_time' => '2026-05-24 10:00:00',
                'ctime' => '2026-05-24 10:05:00',
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
                'videoId' => 'video-excluded',
                'u_id' => 20,
                'authors_count' => 1,
                'likes_count' => 1,
                'threads_count' => 1,
                'replies_count' => 0,
                'comments_count' => 1,
                'latest_time' => '2026-05-24 11:00:00',
                'ctime' => '2026-05-24 11:05:00',
                'authors_json' => json_encode([
                    'UC-excluded' => ['DisplayName' => '排除留言者'],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
