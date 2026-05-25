<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagUnavailableRouteTest extends TestCase
{
    public function test_tag_comment_and_cloud_pages_report_empty_cache_dependencies(): void
    {
        $this->createTables();

        $this->get('/tags/1/comments?hours=72&not=9')
            ->assertOk()
            ->assertSee('社論 標籤近期留言')
            ->assertSee('Data unavailable locally')
            ->assertSee('urt_comment')
            ->assertSee('urt_comment_author')
            ->assertSee('comments_recent.php')
            ->assertSee('not=9')
            ->assertSee('empty');

        $this->get('/tags/1/cloud?days=7&not=9')
            ->assertOk()
            ->assertSee('社論 標籤文字雲')
            ->assertSee('urt_show_tag_cloud')
            ->assertSee('cloud.php + api/tags_video.php')
            ->assertSee('empty');
    }

    public function test_keyword_video_and_cloud_pages_report_missing_relation_cache(): void
    {
        $this->createTables();

        $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/videos?days=7')
            ->assertOk()
            ->assertSee('蔡英文 關鍵字影片')
            ->assertSee('urt_show_video_tag')
            ->assertSee('urt_show_video_tag_date')
            ->assertSee('tag_video.php + api/tags_relation_date.php');

        $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/cloud?tagid=13&days=7')
            ->assertOk()
            ->assertSee('蔡英文 關鍵字文字雲')
            ->assertSee('urt_show_tag_cloud_tag')
            ->assertSee('urt_video_log_history')
            ->assertSee('tag_cloud.php + api/tag_tags_days.php');
    }

    public function test_legacy_tag_gap_urls_redirect_to_unavailable_pages(): void
    {
        $this->get('/comments_recent.php?tagid=1&hours=72&not=9')
            ->assertStatus(308)
            ->assertRedirect(route('tags.comments', [
                'tagId' => 1,
                'hours' => '72',
                'not' => '9',
            ]));

        $this->get('/cloud.php?tagid=1&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('tags.cloud', [
                'tagId' => 1,
                'days' => '7',
            ]));

        $this->get('/tag_cloud.php?tag=蔡英文&tagid=13&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('keywords.cloud', [
                'keyword' => '蔡英文',
                'tagid' => '13',
                'days' => '7',
            ]));

        $this->get('/tag_video.php?tag=蔡英文&days=7')
            ->assertStatus(308)
            ->assertRedirect(route('keywords.videos', [
                'keyword' => '蔡英文',
                'days' => '7',
            ]));
    }

    private function createTables(): void
    {
        foreach ([
            'urt_tag',
            'urt_comment',
            'urt_comment_author',
            'urt_video',
            'urt_count',
            'urt_show_tag_cloud',
            'urt_show_video_tag',
            'urt_show_video_tag_date',
            'urt_show_tag_cloud_tag',
            'urt_video_log_history',
        ] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        DB::table('urt_tag')->insert([
            'tag_id' => 1,
            'tag_name' => '社論',
        ]);

        Schema::create('urt_comment', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->string('videoId')->nullable();
        });

        Schema::create('urt_comment_author', function ($table): void {
            $table->string('author_id')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->string('videoId')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->string('tags')->nullable();
        });

        Schema::create('urt_show_tag_cloud', function ($table): void {
            $table->integer('pk')->nullable();
            $table->text('tags_json')->nullable();
        });

        Schema::create('urt_show_video_tag', function ($table): void {
            $table->string('videoId')->nullable();
            $table->text('tags_json')->nullable();
        });

        Schema::create('urt_show_video_tag_date', function ($table): void {
            $table->date('the_date')->nullable();
            $table->string('tag')->nullable();
        });

        Schema::create('urt_show_tag_cloud_tag', function ($table): void {
            $table->string('tag')->nullable();
            $table->text('tags_json')->nullable();
        });

        Schema::create('urt_video_log_history', function ($table): void {
            $table->string('videoId')->nullable();
            $table->integer('viewCount')->nullable();
        });
    }
}
