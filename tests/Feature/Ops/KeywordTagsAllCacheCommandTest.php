<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionJobRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class KeywordTagsAllCacheCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_keywords_cache_command_preview_plans_tags_all(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();

        $exitCode = Artisan::call('reports:keywords:cache', [
            '--keyword-limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('dry-run', $payload['mode']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(['urt_show_data.data_name=tags_all columns=ctime,mtime,api,para,the_result'], $payload['write_targets']);
        $this->assertSame(0, DB::table('urt_show_data')->count());
    }

    public function test_keywords_cache_command_execute_writes_idempotent_tags_all_metrics(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();

        $firstExit = Artisan::call('reports:keywords:cache', [
            '--execute' => true,
            '--keyword-limit' => 10,
            '--json' => true,
        ]);
        $secondExit = Artisan::call('reports:keywords:cache', [
            '--execute' => true,
            '--keyword-limit' => 10,
            '--json' => true,
        ]);

        $this->assertSame(0, $firstExit);
        $this->assertSame(0, $secondExit);
        $this->assertSame(1, DB::table('urt_show_data')->where('data_name', 'tags_all')->count());

        $cache = DB::table('urt_show_data')->where('data_name', 'tags_all')->first();
        $metrics = json_decode($cache->the_result, true);

        $this->assertSame('api/tags_all.php', $cache->api);
        $this->assertSame('or=1,2,13,14', $cache->para);
        $this->assertSame(['video' => 1, 'video_all' => 2, 'views' => 100, 'views_all' => 400], $metrics['柯文哲']);
        $this->assertSame(['video' => 1, 'video_all' => 1, 'views' => 100, 'views_all' => 100], $metrics['賴清德']);
        $this->assertArrayNotHasKey('排除詞', $metrics);

        $response = $this->get('/keywords?limit=10');
        $response->assertOk();
        $response->assertDontSee('尚無快取');
        $response->assertSee('柯文哲');
        $response->assertSee('100');
        $response->assertSee('1');
    }

    public function test_tags_all_cache_write_failure_is_sanitized_and_returns_nonzero_summary(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();
        Log::spy();

        DB::statement(<<<'SQL'
CREATE TRIGGER fail_tags_all_cache
BEFORE INSERT ON urt_show_data
WHEN NEW.data_name = 'tags_all'
BEGIN
    SELECT RAISE(FAIL, 'token=tags-all-secret');
END
SQL);

        $exitCode = Artisan::call('reports:keywords:cache', [
            '--keyword-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('failed', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame('cache_row_processing_failed', $payload['failure_reason']);
        $this->assertStringNotContainsString('tags-all-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertSame(0, DB::table('urt_show_data')->count());
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Keyword tags-all cache row failed.'
                    && $context['failure_reason'] === 'cache_row_processing_failed'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'tags-all-secret');
            });
    }

    public function test_keyword_and_video_source_caps_block_without_publishing_partial_cache(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();

        $keywordExit = Artisan::call('reports:keywords:cache', [
            '--keyword-limit' => 1,
            '--video-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ]);
        $keywordPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $keywordExit);
        $this->assertSame('blocked', $keywordPayload['status']);
        $this->assertSame('keyword_scan_limit_exceeded', $keywordPayload['blocked_reason']);
        $this->assertTrue($keywordPayload['source_truncated']);
        $this->assertSame(0, DB::table('urt_show_data')->count());

        $this->assertSame(0, Artisan::call('reports:keywords:cache', [
            '--keyword-limit' => 10,
            '--video-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ]));
        $existing = DB::table('urt_show_data')->where('data_name', 'tags_all')->value('the_result');

        $videoExit = Artisan::call('reports:keywords:cache', [
            '--keyword-limit' => 10,
            '--video-limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $videoPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $videoExit);
        $this->assertSame('blocked', $videoPayload['status']);
        $this->assertSame('video_scan_limit_exceeded', $videoPayload['blocked_reason']);
        $this->assertSame(1, $videoPayload['videos_scanned']);
        $this->assertSame(0, $videoPayload['writes']);
        $this->assertSame($existing, DB::table('urt_show_data')->where('data_name', 'tags_all')->value('the_result'));
    }

    public function test_scheduled_tags_all_rebuild_declares_keyword_and_video_caps(): void
    {
        $command = (string) app(IngestionJobRegistry::class)
            ->find('reports.keywords.cache')['scheduled_execute_command'];

        $this->assertStringContainsString('--keyword-limit=1000', $command);
        $this->assertStringContainsString('--video-limit=50000', $command);
    }

    private function createTables(): void
    {
        foreach (['urt_show_data', 'urt_video', 'urt_count', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->increments('pk');
            $table->string('tag');
            $table->dateTime('ctime');
            $table->dateTime('mtime');
            $table->integer('max_count');
            $table->integer('hours_count');
            $table->dateTime('max_hours');
            $table->tinyInteger('no_tag')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('title');
            $table->text('description')->nullable();
            $table->bigInteger('viewCount')->nullable();
        });

        Schema::create('urt_show_data', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('data_name', 16)->index();
            $table->string('api', 64)->nullable();
            $table->string('para', 64)->nullable();
            $table->longText('the_result')->nullable();
        });
    }

    private function seedRows(): void
    {
        DB::table('tags')->insert([
            ['tag' => '柯文哲', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-26 10:00:00', 'max_count' => 900, 'hours_count' => 90, 'max_hours' => '2026-05-26 10:00:00', 'no_tag' => 0],
            ['tag' => '賴清德', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-26 10:00:00', 'max_count' => 800, 'hours_count' => 80, 'max_hours' => '2026-05-26 10:00:00', 'no_tag' => 0],
            ['tag' => '排除詞', 'ctime' => '2026-05-20 00:00:00', 'mtime' => '2026-05-26 10:00:00', 'max_count' => 5000, 'hours_count' => 5000, 'max_hours' => '2026-05-26 10:00:00', 'no_tag' => 1],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1][9]'],
            ['u_id' => 20, 'tags' => '[9]'],
        ]);

        DB::table('urt_video')->insert([
            ['videoId' => 'recent-match', 'u_id' => 10, 'publishedAt' => '2026-05-26 08:00:00', 'title' => '柯文哲與賴清德', 'description' => '柯文哲', 'viewCount' => 100],
            ['videoId' => 'older-match', 'u_id' => 10, 'publishedAt' => '2026-05-12 08:00:00', 'title' => '柯文哲', 'description' => null, 'viewCount' => 300],
            ['videoId' => 'wrong-channel', 'u_id' => 20, 'publishedAt' => '2026-05-26 08:00:00', 'title' => '柯文哲', 'description' => null, 'viewCount' => 999],
        ]);
    }
}
