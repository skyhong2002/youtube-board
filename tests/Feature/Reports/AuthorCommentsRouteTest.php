<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AuthorCommentsRouteTest extends TestCase
{
    public function test_author_comments_page_rebuilds_legacy_author_comment_analysis(): void
    {
        $this->createTables();
        $this->seedAuthorComments();

        $response = $this->get('/comments/authors/466?limit=10');

        $response->assertOk();
        $response->assertSee('留言王 的留言');
        $response->assertSee('留言時間');
        $response->assertSee('留言頻道');
        $response->assertSee('留言標籤');
        $response->assertSee('測試頻道 A');
        $response->assertSee('測試頻道 B');
        $response->assertSee('泛藍');
        $response->assertSee('泛綠');
        $response->assertSee('第一則留言');
        $response->assertSee('回應留言');
        $response->assertSee('另一部影片');
        $response->assertSee('符合留言 3');
    }

    public function test_author_comments_page_supports_channel_id_lookup(): void
    {
        $this->createTables();
        $this->seedAuthorComments();

        $this->get('/comments/authors/UC-author?lookup=ChannelId&limit=10')
            ->assertOk()
            ->assertSee('留言王 的留言')
            ->assertSee('ChannelId=UC-author')
            ->assertSee('第一則留言');
    }

    public function test_author_comments_page_reports_missing_local_data(): void
    {
        $this->createTables();

        $this->get('/comments/authors/466')
            ->assertOk()
            ->assertSee('Data unavailable locally')
            ->assertSee('urt_comment_author')
            ->assertSee('urt_comment_rev')
            ->assertSee('urt_comment')
            ->assertSee('author_comments_bak.php')
            ->assertSee('empty');
    }

    public function test_legacy_author_comments_url_redirects_to_clean_route(): void
    {
        $this->get('/author_comments_bak.php?author_id=466&limit=10')
            ->assertStatus(308)
            ->assertRedirect(route('comments.authors.show', [
                'authorKey' => '466',
                'limit' => '10',
            ]));

        $this->get('/author_comments_bak.php?ChannelId=UC-author&hours=72')
            ->assertStatus(308)
            ->assertRedirect(route('comments.authors.show', [
                'authorKey' => 'UC-author',
                'lookup' => 'ChannelId',
                'hours' => '72',
            ]));
    }

    private function createTables(): void
    {
        foreach (['urt_comment_author', 'urt_comment_rev', 'urt_comment', 'urt_channel', 'urt_count', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_comment_author', function ($table): void {
            $table->integer('author_id');
            $table->string('ChannelId');
            $table->string('DisplayName')->nullable();
            $table->string('ImageUrl')->nullable();
            $table->string('ChannelUrl')->nullable();
        });

        Schema::create('urt_comment_rev', function ($table): void {
            $table->integer('author_id');
            $table->text('index_json')->nullable();
        });

        Schema::create('urt_comment', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->text('comments_json')->nullable();
        });

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });
    }

    private function seedAuthorComments(): void
    {
        DB::table('urt_comment_author')->insert([
            'author_id' => 466,
            'ChannelId' => 'UC-author',
            'DisplayName' => '留言王',
            'ImageUrl' => 'https://example.test/author.jpg',
            'ChannelUrl' => 'https://youtube.test/author',
        ]);

        DB::table('urt_comment_rev')->insert([
            'author_id' => 466,
            'index_json' => json_encode(['video-a', 'video-b'], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_comment')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'comments_json' => json_encode([
                    'c1' => [
                        'authorChannelId' => 'UC-author',
                        'publishedAt' => '2026-05-24 08:10:00',
                        'textOriginal' => '第一則留言',
                        'likeCount' => 7,
                        'replies' => [
                            [
                                'authorChannelId' => 'UC-author',
                                'publishedAt' => '2026-05-24 09:15:00',
                                'textOriginal' => '回應留言',
                                'likeCount' => 2,
                            ],
                        ],
                    ],
                    'c2' => [
                        'authorChannelId' => 'UC-other',
                        'publishedAt' => '2026-05-24 10:15:00',
                        'textOriginal' => '不應出現',
                        'likeCount' => 99,
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'videoId' => 'video-b',
                'u_id' => 20,
                'comments_json' => json_encode([
                    'c3' => [
                        'authorChannelId' => 'UC-author',
                        'publishedAt' => '2026-05-24 08:30:00',
                        'textOriginal' => '另一部影片',
                        'likeCount' => 3,
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'youtube_id' => 'UC10', 'title' => '測試頻道 A', 'thumbnails' => 'https://example.test/a.jpg'],
            ['u_id' => 20, 'youtube_id' => 'UC20', 'title' => '測試頻道 B', 'thumbnails' => 'https://example.test/b.jpg'],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[3][4]'],
            ['u_id' => 20, 'tags' => '[4]'],
        ]);

        DB::table('urt_tag')->insert([
            ['tag_id' => 3, 'tag_name' => '泛藍'],
            ['tag_id' => 4, 'tag_name' => '泛綠'],
            ['tag_id' => 9, 'tag_name' => '不顯示'],
        ]);
    }
}
