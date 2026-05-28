<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelPromptRouteTest extends TestCase
{
    public function test_channel_prompt_page_builds_ingestion_legacy_prompt_from_videos(): void
    {
        $this->createTables();

        DB::table('urt_video')->insert([
            [
                'u_id' => 10,
                'videoId' => 'low123',
                'publishedAt' => '2026-05-23 08:00:00',
                'title' => '低觀看新聞',
                'thumbnails' => 'https://example.test/low.jpg',
                'viewCount' => 100,
                'likeCount' => 2,
                'commentCount' => 3,
            ],
            [
                'u_id' => 10,
                'videoId' => 'high123',
                'publishedAt' => '2026-05-23 10:00:00',
                'title' => '高觀看新聞',
                'thumbnails' => 'https://example.test/high.jpg',
                'viewCount' => 900,
                'likeCount' => 20,
                'commentCount' => 30,
            ],
            [
                'u_id' => 10,
                'videoId' => 'otherday',
                'publishedAt' => '2026-05-22 10:00:00',
                'title' => '其他日期新聞',
                'thumbnails' => 'https://example.test/other.jpg',
                'viewCount' => 9999,
                'likeCount' => 1,
                'commentCount' => 1,
            ],
        ]);

        $response = $this->get('/channels/10/prompt?date=2026-05-23&limit=2');

        $response->assertOk();
        $response->assertSee('Example Channel 2026-05-23 AI prompt preview');
        $response->assertSee('事件數 2 - 2');
        $response->assertSee('請把下面的新聞列表');
        $response->assertSee('high123 &lt;date&gt;2026-05-23 10:00:00&lt;/date&gt; 高觀看新聞 (觀看:900)', false);
        $response->assertSee('low123 &lt;date&gt;2026-05-23 08:00:00&lt;/date&gt; 低觀看新聞 (觀看:100)', false);
        $response->assertSee('readonly', false);
        $response->assertDontSee('其他日期新聞');
        $response->assertDontSee('/redir/channel_ai.php');
    }

    private function createTables(): void
    {
        foreach (['urt_video', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('youtube_id')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title');
            $table->string('thumbnails')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'youtube_id' => 'UC10',
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);
    }
}
