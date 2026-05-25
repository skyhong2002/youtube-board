<?php

namespace Tests\Feature\Reports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelCloudRouteTest extends TestCase
{
    public function test_channel_cloud_reads_cache_and_applies_legacy_differential_weight(): void
    {
        $this->createTables();

        DB::table('urt_show_cloud')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'u_id' => 10,
                'days' => 3,
                'keywords_json' => json_encode(['選舉' => '30.00000', '政策' => '20.00000', '直播' => '100.00000'], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'u_id' => 10,
                'days' => 7,
                'keywords_json' => json_encode(['選舉' => '14.00000', '政策' => '7.00000', '直播' => '200.00000'], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/channels/10/cloud?days=3&limit=10');

        $response->assertOk();
        $response->assertSee('Example Channel 在 3 天的文字雲');
        $response->assertSee('頻道文字雲');
        $response->assertSee('選舉');
        $response->assertSee('政策');
        $response->assertSee('23.000');
        $response->assertSee('16.500');
        $response->assertSee('3 天原始資料');
        $response->assertSee('7 天原始資料');
        $response->assertSee('channel_cloud.php + api/cloud.php');
        $this->assertSame(2, DB::table('urt_show_cloud')->count());
    }

    public function test_channel_cloud_filters_stopwords_from_legacy_source(): void
    {
        $this->useLegacyStopwords(['自訂停用詞']);
        $this->createTables();

        DB::table('urt_show_cloud')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'u_id' => 10,
                'days' => 3,
                'keywords_json' => json_encode(['自訂停用詞' => '999.00000', '政策' => '20.00000'], JSON_UNESCAPED_UNICODE),
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => '2026-05-24 01:00:00',
                'u_id' => 10,
                'days' => 7,
                'keywords_json' => json_encode(['自訂停用詞' => '10.00000', '政策' => '4.00000'], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $response = $this->get('/channels/10/cloud?days=3&limit=10');

        $response->assertOk();
        $response->assertSee('政策');
        $response->assertDontSee('自訂停用詞');
    }

    private function createTables(): void
    {
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

        Schema::create('urt_show_cloud', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->integer('u_id');
            $table->integer('days');
            $table->longText('keywords_json')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->integer('u_id')->nullable();
            $table->string('videoId')->nullable();
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
