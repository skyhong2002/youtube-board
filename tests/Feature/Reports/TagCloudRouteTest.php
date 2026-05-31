<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagCloudRouteTest extends TestCase
{
    public function test_tag_cloud_reads_short_and_long_cache_through_dynamic_routes(): void
    {
        $this->createTagTable();
        $this->createTagCloudTable();

        DB::table('urt_show_tag_cloud')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 4,
                'days' => 3,
                'tags_count' => 3,
                'tags_result' => json_encode(['選舉' => '30.000', '政策' => '20.000', '新聞' => '100.000'], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 4,
                'count_videos' => 5,
                'count_tags' => 6,
                'days' => 7,
                'tags_count' => 3,
                'tags_result' => json_encode(['選舉' => '14.000', '政策' => '7.000', '新聞' => '200.000'], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/tags/1/cloud?days=3&limit=10');

        $response->assertOk();
        $response->assertSee('社論 在 3 天的文字雲');
        $response->assertSee('選舉');
        $response->assertSee('政策');
        $response->assertSee('23.000');
        $response->assertSee('16.500');
        $response->assertSee('3 天原始資料');
        $response->assertSee('7 天原始資料');
        $response->assertSee('cloud.php + api/tags_video.php');
        $response->assertSee('data-d3-word-cloud', false);
        $response->assertSee('d3.layout.cloud.min.js', false);
        $response->assertSee(route('keywords.days', ['keyword' => '選舉']), false);
        $this->assertSame(2, DB::table('urt_show_tag_cloud')->count());
    }

    public function test_keyword_cloud_reads_relation_cache_and_preserves_legacy_filters(): void
    {
        $this->createTagTable();
        $this->createTagCloudTagTable();

        DB::table('urt_show_tag_cloud_tag')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tag' => '蔡英文',
                'tagid' => '13',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 4,
                'days' => 3,
                'tags_count' => 2,
                'tags_result' => json_encode([
                    '國會' => ['weight' => '20.00'],
                    '政策' => ['weight' => '12.00'],
                ], JSON_UNESCAPED_UNICODE),
                'videos_json' => json_encode(['video-a' => ['views' => 100]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tag' => '蔡英文',
                'tagid' => '13',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 2,
                'count_videos' => 5,
                'count_tags' => 6,
                'days' => 7,
                'tags_count' => 2,
                'tags_result' => json_encode([
                    '國會' => ['weight' => '4.00'],
                    '政策' => ['weight' => '2.00'],
                ], JSON_UNESCAPED_UNICODE),
                'videos_json' => json_encode(['video-b' => ['views' => 200]], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/keywords/%E8%94%A1%E8%8B%B1%E6%96%87/cloud?tagid=13&days=3&limit=10');

        $response->assertOk();
        $response->assertSee('蔡英文 用 新聞 在 3 天的文字雲');
        $response->assertSee('tag=蔡英文');
        $response->assertSee('tagid=13');
        $response->assertSee('國會');
        $response->assertSee('18.000');
        $response->assertSee('政策');
        $response->assertSee('11.000');
        $response->assertSee('tag_cloud.php + api/tag_tags_days.php');
        $response->assertSee('data-d3-word-cloud', false);
        $response->assertSee(route('keywords.days', ['keyword' => '國會']), false);
        $this->assertSame(2, DB::table('urt_show_tag_cloud_tag')->count());
    }

    public function test_keyword_cloud_derives_from_raw_video_keywords_when_cache_is_empty(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTagTable();
        $this->createTagCloudTagTable();
        $this->createRawKeywordTables();

        DB::table('tags')->insert([
            ['tag' => '少子化', 'no_tag' => null, 'hours_count' => 50],
            ['tag' => '托育', 'no_tag' => null, 'hours_count' => 40],
            ['tag' => '育兒', 'no_tag' => null, 'hours_count' => 30],
        ]);
        DB::table('urt_video')->insert([
            [
                'videoId' => 'birthrate-a',
                'u_id' => 10,
                'publishedAt' => '2026-05-20 10:00:00',
                'title' => '少子化 托育政策',
                'description' => '育兒補助',
                'viewCount' => 2000,
            ],
            [
                'videoId' => 'other-a',
                'u_id' => 11,
                'publishedAt' => '2026-05-24 11:00:00',
                'title' => '其他政策',
                'description' => '托育補助',
                'viewCount' => 4000,
            ],
        ]);

        $response = $this->get('/keywords/%E5%B0%91%E5%AD%90%E5%8C%96/cloud?limit=10');

        $response->assertOk();
        $response->assertSee('少子化 用 全部標籤 在 7 天的文字雲');
        $response->assertSee('urt_video + tags derived real-time YouTube dashboard');
        $response->assertSee('托育');
        $response->assertSee('育兒');
        $response->assertDontSee('Data unavailable locally');
        $this->assertSame(0, DB::table('urt_show_tag_cloud_tag')->count());

        Carbon::setTestNow();
    }

    public function test_tag_cloud_filters_stopwords_from_legacy_source(): void
    {
        $this->useLegacyStopwords(['自訂停用詞']);
        $this->createTagTable();
        $this->createTagCloudTable();

        DB::table('urt_show_tag_cloud')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 4,
                'days' => 3,
                'tags_count' => 2,
                'tags_result' => json_encode(['自訂停用詞' => '999.000', '政策' => '20.000'], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 4,
                'days' => 7,
                'tags_count' => 2,
                'tags_result' => json_encode(['自訂停用詞' => '10.000', '政策' => '4.000'], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/tags/1/cloud?days=3&limit=10');

        $response->assertOk();
        $response->assertSee('政策');
        $response->assertDontSee('自訂停用詞');
    }

    public function test_tag_cloud_reads_wrapped_and_list_shaped_cache_payloads(): void
    {
        $this->createTagTable();
        $this->createTagCloudTable();

        DB::table('urt_show_tag_cloud')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 2,
                'count_videos' => 3,
                'count_tags' => 4,
                'days' => 3,
                'tags_count' => 2,
                'tags_result' => json_encode([
                    'result' => [
                        ['word' => '包裝標籤', 'weight' => '30.000'],
                        ['keyword' => '列表標籤', 'score' => '20.000'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'count_channels' => 4,
                'count_videos' => 5,
                'count_tags' => 6,
                'days' => 7,
                'tags_count' => 2,
                'tags_result' => json_encode([
                    'tags_result' => [
                        '包裝標籤' => ['weight' => '14.000'],
                        '列表標籤' => ['count' => '7.000'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/tags/1/cloud?days=3&limit=10');

        $response->assertOk();
        $response->assertSee('包裝標籤');
        $response->assertSee('列表標籤');
        $response->assertSee('23.000');
        $response->assertSee('16.500');
    }

    private function createTagTable(): void
    {
        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
            ['tag_id' => 13, 'tag_name' => '新聞'],
        ]);
    }

    private function createTagCloudTable(): void
    {
        Schema::create('urt_show_tag_cloud', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('days');
            $table->integer('tags_count')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    private function createTagCloudTagTable(): void
    {
        Schema::create('urt_show_tag_cloud_tag', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('days');
            $table->integer('tags_count')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('videos_json')->nullable();
        });
    }

    private function createRawKeywordTables(): void
    {
        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->integer('no_tag')->nullable();
            $table->integer('hours_count')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->nullable();
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
