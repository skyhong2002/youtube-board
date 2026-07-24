<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class TagCategoryReportsTest extends TestCase
{
    public function test_keyword_list_renders_legacy_tags_table_and_cached_metrics(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createKeywordTables();

        DB::table('tags')->insert([
            ['tag' => '柯文哲', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 1200, 'hours_count' => 80, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
            ['tag' => '會員', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 9999, 'hours_count' => 200, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
            ['tag' => '賴清德', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-23 12:00:00', 'max_count' => 800, 'hours_count' => 50, 'max_hours' => '2026-05-23 12:00:00', 'no_tag' => null],
        ]);
        DB::table('urt_show_data')->insert([
            'data_name' => 'tags_all',
            'the_result' => json_encode([
                '柯文哲' => ['video' => 8, 'views' => 7000, 'views_all' => 21000],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/keywords?limit=20');

        $response->assertOk();
        $response->assertSee('關鍵字列表');
        $response->assertDontSee('關鍵字工具');
        $response->assertDontSee('多關鍵字比較');
        $response->assertDontSee('aria-label="相關頁面"', false);
        $response->assertDontSee('回到分類');
        $response->assertDontSee('分類列表');
        $response->assertDontSee('/tags/cloud', false);
        $response->assertSee('柯文哲');
        $response->assertSee('/keywords/%E6%9F%AF%E6%96%87%E5%93%B2/days', false);
        $response->assertSee('/keywords/%E6%9F%AF%E6%96%87%E5%93%B2/cloud?days=3', false);
        $response->assertSee('/keywords/%E6%9F%AF%E6%96%87%E5%93%B2/live/trends', false);
        $response->assertSee('/tags/compare?tags=%E6%9F%AF%E6%96%87%E5%93%B2', false);
        $response->assertSee('7,000');
        $response->assertSee('8');
        $response->assertSee('賴清德');
        $response->assertDontSee('會員');

        Carbon::setTestNow();
    }

    public function test_keyword_list_reads_stopwords_from_legacy_source(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->useLegacyStopwords(['自訂停用詞']);
        $this->createKeywordTables();

        DB::table('tags')->insert([
            ['tag' => '自訂停用詞', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 9999, 'hours_count' => 200, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
            ['tag' => '保留關鍵字', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 100, 'hours_count' => 20, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
        ]);

        $response = $this->get('/keywords?limit=20');

        $response->assertOk();
        $response->assertSee('保留關鍵字');
        $response->assertDontSee('自訂停用詞');

        Carbon::setTestNow();
    }

    public function test_keyword_list_reads_wrapped_and_list_shaped_tags_all_metrics(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createKeywordTables();

        DB::table('tags')->insert([
            ['tag' => '柯文哲', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 1200, 'hours_count' => 80, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
            ['tag' => '賴清德', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-23 12:00:00', 'max_count' => 800, 'hours_count' => 50, 'max_hours' => '2026-05-23 12:00:00', 'no_tag' => null],
        ]);
        DB::table('urt_show_data')->insert([
            'data_name' => 'tags_all',
            'the_result' => json_encode([
                'result' => [
                    ['tag' => '柯文哲', 'video' => 8, 'views' => 7000, 'views_all' => 21000],
                    ['keyword' => '賴清德', 'video' => 4, 'views' => 3000, 'views_all' => 9000],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/keywords?limit=20');

        $response->assertOk();
        $response->assertSee('柯文哲');
        $response->assertSee('7,000');
        $response->assertSee('8');
        $response->assertSee('賴清德');
        $response->assertSee('3,000');
        $response->assertSee('4');

        Carbon::setTestNow();
    }

    public function test_keyword_list_renders_data_lineage_with_fixed_sources_and_update_times(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        Storage::fake('local');
        Storage::disk('local')->put('ingestion-runs/20260524-142010-test.json', json_encode([
            'id' => '20260524-142010-test',
            'created_at' => '2026-05-24 14:20:10 Asia/Taipei',
            'request' => ['mode' => 'execute', 'source' => 'artisan'],
            'result' => [
                'mode' => 'execute',
                'jobs' => [
                    ['key' => 'reports.keywords.build', 'executed' => true, 'failed' => false, 'exit_code' => 0],
                ],
            ],
        ], JSON_THROW_ON_ERROR));

        $this->createKeywordTables();
        Schema::table('urt_show_data', function ($table): void {
            $table->dateTime('mtime')->nullable();
        });

        DB::table('tags')->insert([
            ['tag' => '柯文哲', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-24 12:00:00', 'max_count' => 1200, 'hours_count' => 80, 'max_hours' => '2026-05-24 12:00:00', 'no_tag' => null],
        ]);
        DB::table('urt_show_data')->insert([
            'data_name' => 'tags_all',
            'mtime' => '2026-05-24 12:30:00',
            'the_result' => json_encode([
                '柯文哲' => ['video' => 8, 'views' => 7000, 'views_all' => 21000],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $response = $this->get('/keywords?limit=20');

        $response->assertOk();
        $response->assertSee('資料來源與更新狀態');
        $response->assertSee('class="lineage-panel" hidden', false);
        $response->assertSee('data-lineage-graph', false);
        $response->assertSee('tag.analysis.tw\/api\/tag_json.php?hours={hours}', false);
        $response->assertSee('urt_show_data.tags_all');
        $response->assertSee('2026-05-24 12:30:00');
        $response->assertSee('2026-05-24 14:20:10');
        $response->assertSee('關鍵字列表頁');

        Carbon::setTestNow();
    }

    public function test_tag_videos_filters_channels_and_recent_videos(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 12:00:00', 'Asia/Taipei'));
        $this->createTagVideoTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
            ['tag_id' => 9, 'tag_name' => '排除'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][2]'],
            ['u_id' => 20, 'tags' => '[1][9]'],
            ['u_id' => 30, 'tags' => '[2]'],
        ]);
        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-included',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 11:00:00',
                'channelTitle' => 'Included Channel',
                'title' => 'Included Video',
                'thumbnails' => 'https://example.test/included.jpg',
                'viewCount' => 2000,
                'likeCount' => 100,
                'commentCount' => 10,
            ],
            [
                'videoId' => 'video-excluded',
                'u_id' => 20,
                'publishedAt' => '2026-05-24 10:00:00',
                'channelTitle' => 'Excluded Channel',
                'title' => 'Excluded Video',
                'thumbnails' => 'https://example.test/excluded.jpg',
                'viewCount' => 5000,
                'likeCount' => 50,
                'commentCount' => 5,
            ],
            [
                'videoId' => 'video-old',
                'u_id' => 10,
                'publishedAt' => '2026-05-22 10:00:00',
                'channelTitle' => 'Included Channel',
                'title' => 'Old Video',
                'thumbnails' => 'https://example.test/old.jpg',
                'viewCount' => 9000,
                'likeCount' => 90,
                'commentCount' => 9,
            ],
            [
                'videoId' => 'video-low',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 09:00:00',
                'channelTitle' => 'Included Channel',
                'title' => 'Low View Video',
                'thumbnails' => 'https://example.test/low.jpg',
                'viewCount' => 99,
                'likeCount' => 1,
                'commentCount' => 1,
            ],
        ]);

        $response = $this->get('/tags/1/videos?not=9&hours=24&min=1000');

        $response->assertOk();
        $response->assertSee('社論 24小時內觀看最多的影片');
        $response->assertSee('Included Video');
        $response->assertSee('Included Channel');
        $response->assertSee('5.00');
        $response->assertDontSee('Excluded Video');
        $response->assertDontSee('Old Video');
        $response->assertDontSee('Low View Video');
        // The 比較 section link must carry the current tag into the comparison.
        $response->assertSee('/tags/compare?tagid=1');

        Carbon::setTestNow();
    }

    public function test_tag_live_videos_filters_channels_and_live_logs(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 12:00:00', 'Asia/Taipei'));
        $this->createTagLiveVideoTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 2, 'tag_name' => '新聞'],
            ['tag_id' => 9, 'tag_name' => '排除'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][2]'],
            ['u_id' => 20, 'tags' => '[1][9]'],
        ]);
        DB::table('urt_show_video_live')->insert([
            [
                'videoId' => 'live-included',
                'u_id' => 10,
                'publishedAt' => '2026-05-24 08:00:00',
                'channelTitle' => 'Included Live Channel',
                'title' => 'Included Live',
                'thumbnails' => 'https://example.test/live-included.jpg',
            ],
            [
                'videoId' => 'live-excluded',
                'u_id' => 20,
                'publishedAt' => '2026-05-24 08:00:00',
                'channelTitle' => 'Excluded Live Channel',
                'title' => 'Excluded Live',
                'thumbnails' => 'https://example.test/live-excluded.jpg',
            ],
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'live-included',
                'u_id' => 10,
                'the_date' => '2026-05-24',
                'max_current' => 5000,
                'log_json' => json_encode(['10:00' => 100, '10:10' => 5000]),
            ],
            [
                'videoId' => 'live-excluded',
                'u_id' => 20,
                'the_date' => '2026-05-24',
                'max_current' => 9000,
                'log_json' => json_encode(['10:00' => 9000]),
            ],
            [
                'videoId' => 'live-old',
                'u_id' => 10,
                'the_date' => '2026-05-23',
                'max_current' => 8000,
                'log_json' => json_encode(['10:00' => 8000]),
            ],
        ]);

        $response = $this->get('/tags/1/live/videos?date=2026-05-24&not=9');

        $response->assertOk();
        $response->assertSee('社論 在 2026-05-24 直播觀看人數排行');
        $response->assertSee('Included Live');
        $response->assertSee('5,000');
        $response->assertSee('100, 5000');
        $response->assertDontSee('Excluded Live');
        $response->assertDontSee('live-old');

        Carbon::setTestNow();
    }

    private function createKeywordTables(): void
    {
        foreach (['urt_show_data', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->dateTime('ctime');
            $table->dateTime('mtime');
            $table->integer('max_count');
            $table->integer('hours_count');
            $table->dateTime('max_hours');
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_show_data', function ($table): void {
            $table->string('data_name');
            $table->text('the_result')->nullable();
        });
    }

    private function createTagVideoTables(): void
    {
        foreach (['urt_video', 'urt_count', 'urt_tag'] as $table) {
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
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('channelTitle');
            $table->string('title');
            $table->string('thumbnails')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });
    }

    private function createTagLiveVideoTables(): void
    {
        foreach (['urt_video_live_log', 'urt_show_video_live', 'urt_count', 'urt_tag'] as $table) {
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

        Schema::create('urt_show_video_live', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('channelTitle');
            $table->string('title');
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });
    }

    /**
     * @param list<string> $words
     */
    private function useLegacyStopwords(array $words): void
    {
        $root = storage_path('framework/testing/legacy-stopwords-'.spl_object_id($this));
        File::ensureDirectoryExists($root.'/urtube');

        $body = collect($words)
            ->map(fn (string $word): string => '$stopwords[]="'.addslashes($word).'";')
            ->implode("\n");

        File::put($root.'/urtube/stopwords.php', "<?php\n".$body."\n");
        config(['legacy.ground_truth_path' => $root]);
    }
}
