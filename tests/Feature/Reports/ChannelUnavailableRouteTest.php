<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelUnavailableRouteTest extends TestCase
{
    public function test_channel_comments_page_reports_missing_local_comment_data(): void
    {
        $this->createTables();

        $response = $this->get('/channels/10/comments?hours=72');

        $response->assertOk();
        $response->assertSee('頻道留言');
        $response->assertSee('Example Channel');
        $response->assertSee('Data unavailable locally');
        $response->assertSee('urt_comment');
        $response->assertSee('urt_comment_author');
        $response->assertSee('channel_comments.php');
        $response->assertSee('empty');
    }

    public function test_channel_cloud_and_trends_pages_report_empty_dependencies(): void
    {
        $this->createTables();

        $this->get('/channels/10/cloud')
            ->assertOk()
            ->assertSee('頻道文字雲')
            ->assertSee('urt_show_cloud')
            ->assertSee('reports:channel-cloud:build')
            ->assertSee('empty');

        $this->get('/channels/10/trends')
            ->assertOk()
            ->assertSee('頻道線圖')
            ->assertSee('urt_log')
            ->assertSee('channel_line.php')
            ->assertSee('empty');
    }

    private function createTables(): void
    {
        foreach (['urt_channel', 'urt_comment', 'urt_comment_author', 'urt_show_cloud', 'urt_show_tag_cloud', 'urt_log'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
        });

        DB::table('urt_channel')->insert([
            'u_id' => 10,
            'title' => 'Example Channel',
            'thumbnails' => 'https://example.test/channel.jpg',
        ]);

        Schema::create('urt_comment', function ($table): void {
            $table->string('videoId')->nullable();
            $table->text('authors_json')->nullable();
        });

        Schema::create('urt_comment_author', function ($table): void {
            $table->string('author_id')->nullable();
        });

        Schema::create('urt_show_cloud', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_show_tag_cloud', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_log', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->string('themonth')->nullable();
            $table->text('thedata')->nullable();
        });
    }
}
