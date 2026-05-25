<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagCloudRouteTest extends TestCase
{
    public function test_tag_cloud_reads_short_and_long_cache_without_writing(): void
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
        $this->assertSame(2, DB::table('urt_show_tag_cloud_tag')->count());
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
