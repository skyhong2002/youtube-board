<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class LiveTagRouteTest extends TestCase
{
    public function test_live_tag_page_reads_legacy_cache_and_filters_stopwords(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedTagCache();

        $response = $this->get('/live/tags?tagid=1&days=1&type=tags_result');

        $response->assertOk();
        $response->assertSee('社論 在 1 天的直播熱度字');
        $response->assertSee('重要度');
        $response->assertSee('毒駕');
        $response->assertSee('500');
        $response->assertSee('川普');
        $response->assertSee('800');
        $response->assertSee('1,200');
        $response->assertDontSee('直播</th>', false);

        Carbon::setTestNow();
    }

    public function test_live_tag_page_supports_video_count_metric_and_exact_legacy_filter_key(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedTagCache();

        $response = $this->get('/live/tags?tagid=1&type=tags_video&from=2026-05-23&to=2026-05-24&limit=5');

        $response->assertOk();
        $response->assertSee('社論 從 2026-05-23 到 2026-05-24 的直播熱度字');
        $response->assertSee('影片數');
        $response->assertSee('川普');
        $response->assertSee('13');
        $response->assertSee('毒駕');
        $response->assertSee('5');
        $response->assertSee('tagid=1');

        Carbon::setTestNow();
    }

    public function test_live_tag_page_reads_stopwords_from_legacy_source(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-25 02:00:00', 'Asia/Taipei'));
        $this->useLegacyStopwords(['毒駕']);
        $this->createTables();
        $this->seedTagCache();

        $response = $this->get('/live/tags?tagid=1&days=1&type=tags_result');

        $response->assertOk();
        $response->assertSee('川普');
        $response->assertDontSee('毒駕');

        Carbon::setTestNow();
    }

    private function createTables(): void
    {
        foreach (['urt_show_live_tag_date', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_show_live_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('total_views')->nullable();
            $table->text('tags_video')->nullable();
            $table->text('tags_views')->nullable();
        });

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
        ]);
    }

    private function seedTagCache(): void
    {
        DB::table('urt_show_live_tag_date')->insert([
            [
                'pk' => 1,
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-23',
                'count_videos' => 3,
                'count_tags' => 12,
                'total_views' => 600,
                'tags_video' => json_encode([
                    '毒駕' => ['10' => 2, '11' => 1],
                    '川普' => ['10' => 6],
                    '直播' => ['10' => 99],
                ], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode([
                    '毒駕' => ['10' => 100, '11' => 200],
                    '川普' => ['10' => 50],
                    '直播' => ['10' => 9000],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'tagid' => '1',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'count_videos' => 4,
                'count_tags' => 20,
                'total_views' => 1200,
                'tags_video' => json_encode([
                    '毒駕' => ['10' => 3],
                    '川普' => ['10' => 7],
                    '直播' => ['10' => 99],
                ], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode([
                    '毒駕' => ['10' => 500],
                    '川普' => ['10' => 800],
                    '直播' => ['10' => 9000],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 3,
                'tagid' => '2',
                'tag_or' => '',
                'tag_not' => '',
                'the_date' => '2026-05-24',
                'count_videos' => 99,
                'count_tags' => 99,
                'total_views' => 99999,
                'tags_video' => json_encode(['不應顯示' => ['10' => 99]], JSON_UNESCAPED_UNICODE),
                'tags_views' => json_encode(['不應顯示' => ['10' => 99999]], JSON_UNESCAPED_UNICODE),
            ],
        ]);
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
