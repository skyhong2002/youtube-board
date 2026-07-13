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

class IngestionKeywordRelationCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_keyword_relation_preview_is_capped_and_does_not_write(): void
    {
        $this->setTestTime();
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:keyword-relations:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
            '--keywords' => '少子化',
            '--keyword-limit' => 3,
            '--video-limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertTrue($payload['available']);
        $this->assertSame(2, $payload['dates']);
        $this->assertSame(1, $payload['keywords_selected']);
        $this->assertSame(3, $payload['videos_scanned']);
        $this->assertSame(2, $payload['rows_planned']);
        $this->assertSame(2, $payload['would_insert']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(0, DB::table('urt_show_video_tag_date')->count());
    }

    public function test_keyword_relation_execute_builds_legacy_maps_renders_routes_and_is_idempotent(): void
    {
        $this->setTestTime();
        $this->createTables();
        $this->seedSources();
        Log::spy();

        $arguments = [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
            '--keywords' => '少子化',
            '--keyword-limit' => 10,
            '--video-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ];
        $firstExitCode = Artisan::call('reports:keyword-relations:build', $arguments);
        $first = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('execute', $first['mode']);
        $this->assertSame(2, $first['inserted']);
        $this->assertSame(2, $first['writes']);
        $this->assertSame(0, $first['failed_cache_rows']);

        $firstDay = DB::table('urt_show_video_tag_date')
            ->where('tag', '少子化')
            ->where('the_date', '2026-05-21')
            ->first();
        $secondDay = DB::table('urt_show_video_tag_date')
            ->where('tag', '少子化')
            ->where('the_date', '2026-05-22')
            ->first();

        $this->assertNotNull($firstDay);
        $this->assertNotNull($secondDay);
        $this->assertSame(1, (int) $firstDay->count_channels);
        $this->assertSame(2, (int) $firstDay->count_videos);
        $this->assertSame(3, (int) $firstDay->count_tags);
        $this->assertSame([
            'video-a' => 10,
            'video-b' => 10,
        ], json_decode($firstDay->videos_json, true));
        $this->assertSame([
            '少子化' => 2,
            '托育' => 2,
            '育兒' => 1,
        ], json_decode($firstDay->tags_json, true));
        $this->assertSame(['video-c' => 11], json_decode($secondDay->videos_json, true));

        $videos = $this->get('/keywords/%E5%B0%91%E5%AD%90%E5%8C%96/videos?days=3&hours=96&limit=10');
        $videos->assertOk();
        $videos->assertSee('Keyword Channel A');
        $videos->assertSee('少子化與育兒支持');
        $videos->assertSee('2 cache rows');

        $days = $this->get('/keywords/%E5%B0%91%E5%AD%90%E5%8C%96/days?from=2026-05-21&to=2026-05-22&diff=0');
        $days->assertOk();
        $days->assertSee('托育');
        $days->assertSee('育兒');
        $days->assertSee('cache rows 2');

        $mtime = $firstDay->mtime;
        $secondExitCode = Artisan::call('reports:keyword-relations:build', $arguments);
        $second = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(0, $second['inserted']);
        $this->assertSame(0, $second['updated']);
        $this->assertSame(2, $second['unchanged']);
        $this->assertSame(0, $second['writes']);
        $this->assertSame(2, DB::table('urt_show_video_tag_date')->count());
        $this->assertSame($mtime, DB::table('urt_show_video_tag_date')->where('pk', $firstDay->pk)->value('mtime'));
        Log::shouldHaveReceived('info')->withArgs(
            fn (string $message, array $context): bool => $message === 'Keyword relation cache build completed.'
                && $context['keywords_selected'] === 1,
        )->twice();
    }

    public function test_keyword_and_video_limits_bound_source_processing(): void
    {
        $this->setTestTime();
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:keyword-relations:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
            '--keywords' => '少子化,托育',
            '--keyword-limit' => 1,
            '--video-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['keyword_limit']);
        $this->assertSame(1, $payload['video_limit']);
        $this->assertSame(['少子化'], $payload['selected_keywords']);
        $this->assertSame(1, $payload['keywords_scanned']);
        $this->assertSame(1, $payload['videos_scanned']);
        $this->assertSame(2, $payload['rows_planned']);
        $this->assertSame(0, DB::table('urt_show_video_tag_date')->count());
    }

    public function test_execute_requires_explicit_dates_and_reports_missing_schema_safely(): void
    {
        foreach (['urt_show_video_tag_date', 'urt_video', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        $missingDates = Artisan::call('reports:keyword-relations:build', [
            '--execute' => true,
        ]);

        $this->assertSame(1, $missingDates);
        $this->assertStringContainsString('--execute requires explicit --from and --to', Artisan::output());

        $missingSchema = Artisan::call('reports:keyword-relations:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $missingSchema);
        $this->assertFalse($payload['available']);
        $this->assertSame('missing_table:urt_video', $payload['blocked_reason']);
        $this->assertSame(0, $payload['writes']);
        $this->assertStringNotContainsString('SQLSTATE', $output);
        $this->assertStringNotContainsString('Connection:', $output);
    }

    public function test_execute_reports_lock_contention_without_writing(): void
    {
        $this->setTestTime();
        $this->createTables();
        $this->seedSources();
        $lock = Cache::lock('ingestion:reports.keyword_relations.build', 60);
        $this->assertTrue($lock->get());

        try {
            $exitCode = Artisan::call('reports:keyword-relations:build', [
                '--from' => '2026-05-21',
                '--to' => '2026-05-21',
                '--keywords' => '少子化',
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertTrue($payload['available']);
            $this->assertSame('lock_busy', $payload['blocked_reason']);
            $this->assertFalse($payload['lock']['acquired']);
            $this->assertSame(0, $payload['writes']);
            $this->assertSame(0, DB::table('urt_show_video_tag_date')->count());
        } finally {
            $lock->release();
        }
    }

    public function test_execute_isolates_one_cache_row_failure_and_continues(): void
    {
        $this->setTestTime();
        $this->createTables();
        Schema::drop('urt_show_video_tag_date');
        $this->createConstrainedCacheTable();

        DB::table('tags')->insert([
            ['tag' => '失敗詞', 'no_tag' => null, 'hours_count' => 100],
            ['tag' => '托育', 'no_tag' => null, 'hours_count' => 90],
        ]);
        DB::table('urt_video')->insert([
            'videoId' => 'isolated-video',
            'u_id' => 10,
            'publishedAt' => '2026-05-21 10:00:00',
            'title' => '失敗詞與托育',
            'description' => '',
        ]);

        $exitCode = Artisan::call('reports:keyword-relations:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--keywords' => '失敗詞,托育',
            '--keyword-limit' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_cache_rows']);
        $this->assertSame(1, $payload['inserted']);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('cache_row_processing_failed', $payload['rows'][0]['reason']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertSame(1, DB::table('urt_show_video_tag_date')->count());
        $this->assertSame('托育', DB::table('urt_show_video_tag_date')->value('tag'));
    }

    public function test_keyword_relation_registry_entry_remains_manual_and_planned(): void
    {
        $job = app(IngestionJobRegistry::class)->find('reports.keyword_relations.build');

        $this->assertNotNull($job);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('reports:keyword-relations:build', $job['modern_command']);
        $this->assertSame('', $job['scheduled_execute_command']);
        $this->assertTrue($job['command_exists']);
        $this->assertFalse(app(IngestionJobRegistry::class)->scheduledWriteProfile($job)['allowed']);
    }

    private function setTestTime(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-23 12:00:00', 'Asia/Taipei'));
    }

    private function createTables(): void
    {
        foreach (['urt_show_video_tag_date', 'urt_video', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('tags', function ($table): void {
            $table->increments('pk');
            $table->string('tag');
            $table->integer('no_tag')->nullable();
            $table->integer('hours_count')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->string('videoId')->unique();
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('title');
            $table->text('description');
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->unsignedBigInteger('viewCount')->nullable();
            $table->unsignedInteger('likeCount')->nullable();
            $table->unsignedInteger('commentCount')->nullable();
        });

        Schema::create('urt_show_video_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->date('the_date');
            $table->string('tag');
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('count_channels')->nullable();
            $table->text('videos_json')->nullable();
            $table->text('tags_json')->nullable();
        });
    }

    private function seedSources(): void
    {
        DB::table('tags')->insert([
            ['tag' => '少子化', 'no_tag' => null, 'hours_count' => 100],
            ['tag' => '托育', 'no_tag' => null, 'hours_count' => 90],
            ['tag' => '育兒', 'no_tag' => null, 'hours_count' => 80],
            ['tag' => '排除詞', 'no_tag' => 1, 'hours_count' => 1000],
        ]);
        DB::table('urt_video')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'publishedAt' => '2026-05-21 10:00:00',
                'title' => '少子化與托育政策',
                'description' => '育兒支持',
                'thumbnails' => 'https://example.test/a.jpg',
                'channelTitle' => 'Keyword Channel A',
                'viewCount' => 1000,
                'likeCount' => 10,
                'commentCount' => 2,
            ],
            [
                'videoId' => 'video-b',
                'u_id' => 10,
                'publishedAt' => '2026-05-21 11:00:00',
                'title' => '少子化托育現況',
                'description' => '',
                'thumbnails' => 'https://example.test/b.jpg',
                'channelTitle' => 'Keyword Channel A',
                'viewCount' => 2000,
                'likeCount' => 20,
                'commentCount' => 3,
            ],
            [
                'videoId' => 'video-c',
                'u_id' => 11,
                'publishedAt' => '2026-05-22 09:00:00',
                'title' => '少子化與育兒支持',
                'description' => '托育名額',
                'thumbnails' => 'https://example.test/c.jpg',
                'channelTitle' => 'Keyword Channel B',
                'viewCount' => 3000,
                'likeCount' => 30,
                'commentCount' => 4,
            ],
        ]);
    }

    private function createConstrainedCacheTable(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE urt_show_video_tag_date (
                pk INTEGER PRIMARY KEY AUTOINCREMENT,
                ctime DATETIME NOT NULL,
                mtime DATETIME NULL,
                the_date DATE NOT NULL,
                tag VARCHAR(255) NOT NULL CHECK (tag <> '失敗詞'),
                count_videos INTEGER NULL,
                count_tags INTEGER NULL,
                count_channels INTEGER NULL,
                videos_json TEXT NULL,
                tags_json TEXT NULL
            )
            SQL);
    }
}
