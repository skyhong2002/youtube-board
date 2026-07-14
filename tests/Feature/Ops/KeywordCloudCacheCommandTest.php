<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionJobRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class KeywordCloudCacheCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_preview_blocks_explicit_subject_list_over_cap_and_does_not_write(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();

        $exitCode = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化,托育,育兒',
            '--days' => '0,7,400',
            '--subject-limit' => 2,
            '--video-limit' => 50000,
            '--execute' => true,
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('dry-run', $payload['mode']);
        $this->assertSame(['少子化', '托育', '育兒'], $payload['subjects']);
        $this->assertSame([1, 7, 365], $payload['days_list']);
        $this->assertSame(10000, $payload['video_limit_per_subject']);
        $this->assertSame('subject_list_limit_exceeded', $payload['blocked_reason']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(0, $payload['rows_planned']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(0, DB::table('urt_show_tag_cloud_tag')->count());

        $periodExit = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化',
            '--days' => implode(',', range(1, 11)),
            '--json' => true,
        ]);
        $periodPayload = json_decode(trim(Artisan::output()), true);
        $filterExit = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化',
            '--tagid' => implode(',', range(1, 51)),
            '--json' => true,
        ]);
        $filterPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $periodExit);
        $this->assertSame('period_list_limit_exceeded', $periodPayload['blocked_reason']);
        $this->assertSame(1, $filterExit);
        $this->assertSame('tagid_list_limit_exceeded', $filterPayload['blocked_reason']);
    }

    public function test_execute_writes_idempotent_cache_consumed_by_page_and_api(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();
        Log::spy();

        $firstExit = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化',
            '--tagid' => '13',
            '--days' => '7,30',
            '--execute' => true,
            '--json' => true,
        ]);
        $first = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExit);
        $this->assertSame(2, $first['inserted']);
        $this->assertSame(2, $first['writes']);
        $this->assertSame(2, DB::table('urt_show_tag_cloud_tag')->count());

        $short = DB::table('urt_show_tag_cloud_tag')->where('tag', '少子化')->where('days', 7)->first();
        $tags = json_decode($short->tags_result, true);
        $videos = json_decode($short->videos_json, true);

        $this->assertSame('13', $short->tagid);
        $this->assertSame(1, (int) $short->count_channels);
        $this->assertSame(1, (int) $short->count_videos);
        $this->assertArrayHasKey('托育', $tags);
        $this->assertArrayHasKey('育兒', $tags);
        $this->assertSame(100, $tags['托育']['views']);
        $this->assertSame(10, $videos['matching-video']['u_id']);
        $firstMtime = $short->mtime;

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-27 12:00:00', 'Asia/Taipei'));
        $secondExit = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化',
            '--tagid' => '13',
            '--days' => '7,30',
            '--execute' => true,
            '--json' => true,
        ]);
        $second = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExit);
        $this->assertSame(0, $second['writes']);
        $this->assertSame(2, $second['unchanged']);
        $this->assertSame(2, DB::table('urt_show_tag_cloud_tag')->count());
        $this->assertSame($firstMtime, DB::table('urt_show_tag_cloud_tag')->where('tag', '少子化')->where('days', 7)->value('mtime'));

        $page = $this->get('/keywords/%E5%B0%91%E5%AD%90%E5%8C%96/cloud?tagid=13&days=7&limit=10');
        $page->assertOk();
        $page->assertSee('urt_show_tag_cloud_tag');
        $page->assertSee('托育');
        $page->assertDontSee('Data unavailable locally');

        $api = $this->getJson('/api/tag_tags_days.php?tag=%E5%B0%91%E5%AD%90%E5%8C%96&tagid=13&days=7');
        $api->assertOk();
        $api->assertJsonPath('meta.source', 'urt_show_tag_cloud_tag');
        $api->assertJsonPath('meta.available', true);
        $api->assertJsonPath('count_videos', 1);
        $this->assertSame(100, $api->json('result')['托育']['views']);
        $this->assertSame(10, $api->json('videos')['matching-video']['u_id']);
        Log::shouldHaveReceived('info')->withArgs(
            fn (string $message, array $context): bool => $message === 'Keyword cloud cache build completed.'
                && $context['subjects_selected'] === 1,
        )->twice();
    }

    public function test_execute_isolates_failed_rows_and_redacts_database_errors(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();
        DB::table('tags')->insert([
            'tag' => '故障詞',
            'hours_count' => 90,
            'no_tag' => 0,
        ]);
        DB::table('urt_video')->insert([
            'videoId' => 'failing-video',
            'u_id' => 10,
            'publishedAt' => '2026-05-25 09:00:00',
            'title' => '故障詞 托育',
            'description' => '故障詞',
            'viewCount' => 50,
        ]);
        DB::statement("CREATE TRIGGER reject_failed_keyword BEFORE INSERT ON urt_show_tag_cloud_tag WHEN NEW.tag = '故障詞' BEGIN SELECT RAISE(FAIL, 'sensitive database detail'); END");

        $exitCode = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '故障詞,少子化',
            '--days' => '7',
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_cache_rows']);
        $this->assertSame('cache_row_failed', $payload['rows'][0]['reason']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertStringNotContainsString('sensitive database detail', $output);
        $this->assertSame(0, DB::table('urt_show_tag_cloud_tag')->where('tag', '故障詞')->count());
        $this->assertSame(1, DB::table('urt_show_tag_cloud_tag')->where('tag', '少子化')->count());
    }

    public function test_video_cap_blocks_only_incomplete_subject_and_preserves_existing_cache(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();

        $this->assertSame(0, Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化',
            '--days' => '7',
            '--video-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ]));
        $existing = DB::table('urt_show_tag_cloud_tag')->where('tag', '少子化')->value('videos_json');

        $exitCode = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化,育兒',
            '--days' => '7',
            '--video-limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('source_incomplete', $payload['blocked_reason']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(1, $payload['blocked_subjects']);
        $this->assertSame('blocked', $payload['rows'][0]['status']);
        $this->assertSame('video_scan_limit_exceeded', $payload['rows'][0]['reason']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame($existing, DB::table('urt_show_tag_cloud_tag')->where('tag', '少子化')->value('videos_json'));
        $this->assertSame(1, DB::table('urt_show_tag_cloud_tag')->where('tag', '育兒')->count());
    }

    public function test_channel_scan_cap_blocks_before_cache_publication_and_preserves_existing_row(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();
        $base = [
            '--keywords' => '少子化',
            '--tagid' => '13',
            '--days' => '7',
            '--channel-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ];

        $this->assertSame(0, Artisan::call('reports:keyword-cloud:build', $base));
        $existing = (array) DB::table('urt_show_tag_cloud_tag')->first();
        DB::table('urt_count')->insert(['u_id' => 30, 'tags' => '[13]']);

        $exitCode = Artisan::call('reports:keyword-cloud:build', array_merge($base, [
            '--channel-limit' => 1,
        ]));
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('channel_scan_limit_exceeded', $payload['blocked_reason']);
        $this->assertFalse($payload['source_complete']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(1, $payload['channels_matched']);
        $this->assertSame(1, $payload['channel_limit']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame($existing, (array) DB::table('urt_show_tag_cloud_tag')->first());
    }

    public function test_video_cap_isolates_short_complete_period_from_long_incomplete_period(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRows();
        DB::table('urt_video')->where('videoId', 'filtered-video')->update(['publishedAt' => '2026-05-23 11:00:00']);

        $exitCode = Artisan::call('reports:keyword-cloud:build', [
            '--keywords' => '少子化',
            '--days' => '1,7',
            '--video-limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame('inserted', $payload['rows'][0]['status']);
        $this->assertSame('blocked', $payload['rows'][1]['status']);
        $this->assertSame('video_scan_limit_exceeded', $payload['rows'][1]['reason']);
        $this->assertSame([1], DB::table('urt_show_tag_cloud_tag')->pluck('days')->map(fn (mixed $days): int => (int) $days)->all());
    }

    public function test_execute_fails_safely_when_another_rebuild_holds_the_lock(): void
    {
        $this->createTables();
        $this->seedRows();
        $lock = Cache::lock('ingestion:reports.keyword_cloud.build', 60);
        $this->assertTrue($lock->get());

        try {
            $exitCode = Artisan::call('reports:keyword-cloud:build', [
                '--keywords' => '少子化',
                '--days' => '7',
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('lock_busy', $payload['blocked_reason']);
            $this->assertSame(0, DB::table('urt_show_tag_cloud_tag')->count());
        } finally {
            $lock->release();
        }
    }

    public function test_command_requires_at_least_one_valid_keyword(): void
    {
        $exitCode = Artisan::call('reports:keyword-cloud:build', ['--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('missing_valid_keywords', $payload['blocked_reason']);
    }

    public function test_registry_entry_is_planned_manual_only_and_never_scheduled(): void
    {
        $job = app(IngestionJobRegistry::class)->find('reports.keyword_cloud.build');

        $this->assertNotNull($job);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('reports:keyword-cloud:build', $job['modern_command']);
        $this->assertSame('', $job['scheduled_execute_command']);
        $this->assertTrue($job['command_exists']);
        $this->assertFalse(app(IngestionJobRegistry::class)->scheduledWriteProfile($job)['allowed']);
    }

    private function createTables(): void
    {
        foreach (['urt_tag', 'urt_show_tag_cloud_tag', 'urt_video', 'urt_count', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->increments('pk');
            $table->string('tag');
            $table->integer('hours_count')->default(0);
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

        Schema::create('urt_show_tag_cloud_tag', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag', 32);
            $table->string('tagid', 64)->nullable();
            $table->string('tag_or', 64)->nullable();
            $table->string('tag_not', 64)->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('days');
            $table->integer('tags_count')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('videos_json')->nullable();
        });

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });
    }

    private function seedRows(): void
    {
        DB::table('tags')->insert([
            ['tag' => '少子化', 'hours_count' => 100, 'no_tag' => 0],
            ['tag' => '托育', 'hours_count' => 80, 'no_tag' => 0],
            ['tag' => '育兒', 'hours_count' => 70, 'no_tag' => 0],
            ['tag' => '政策', 'hours_count' => 60, 'no_tag' => 0],
            ['tag' => '排除詞', 'hours_count' => 1000, 'no_tag' => 1],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[13]'],
            ['u_id' => 20, 'tags' => '[9]'],
        ]);
        DB::table('urt_tag')->insert(['tag_id' => 13, 'tag_name' => '新聞']);
        DB::table('urt_video')->insert([
            [
                'videoId' => 'matching-video',
                'u_id' => 10,
                'publishedAt' => '2026-05-25 10:00:00',
                'title' => '少子化與托育政策',
                'description' => '少子化需要育兒支持',
                'viewCount' => 100,
            ],
            [
                'videoId' => 'filtered-video',
                'u_id' => 20,
                'publishedAt' => '2026-05-25 11:00:00',
                'title' => '少子化與托育',
                'description' => '少子化政策',
                'viewCount' => 900,
            ],
        ]);
    }
}
