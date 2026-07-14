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

class IngestionLiveTagDateCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_preview_reports_keyword_source_truncation_and_no_rows_are_written(): void
    {
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:live-tag-date:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
            '--tagid' => '1',
            '--video-limit' => 2,
            '--keyword-limit' => 2,
            '--execute' => true,
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertTrue($payload['available']);
        $this->assertSame(2, $payload['dates']);
        $this->assertSame(2, $payload['video_limit']);
        $this->assertSame(2, $payload['keyword_limit']);
        $this->assertSame('keyword_scan_limit_exceeded', $payload['blocked_reason']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(0, $payload['would_insert']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(0, DB::table('urt_show_live_tag_date')->count());
    }

    public function test_explicit_tag_list_cap_reports_source_truncation(): void
    {
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:live-tag-date:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--tagid' => implode(',', range(1, 51)),
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('tagid_list_limit_exceeded', $payload['blocked_reason']);
        $this->assertFalse($payload['source_complete']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(0, $payload['writes']);
    }

    public function test_channel_scan_cap_blocks_before_cache_publication_and_preserves_existing_row(): void
    {
        $this->createTables();
        $this->seedSources();
        $base = [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--tagid' => '1',
            '--channel-limit' => 10,
            '--video-limit' => 10,
            '--keyword-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ];

        $this->assertSame(0, Artisan::call('reports:live-tag-date:build', $base));
        $existing = (array) DB::table('urt_show_live_tag_date')->first();
        DB::table('urt_count')->insert(['u_id' => 30, 'tags' => '[1]']);

        $exitCode = Artisan::call('reports:live-tag-date:build', array_merge($base, [
            '--channel-limit' => 1,
        ]));
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('channel_scan_limit_exceeded', $payload['blocked_reason']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(1, $payload['channels_matched']);
        $this->assertSame(1, $payload['channel_limit']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame($existing, (array) DB::table('urt_show_live_tag_date')->first());
    }

    public function test_execute_builds_legacy_maps_renders_api_and_is_idempotent(): void
    {
        $this->createTables();
        $this->seedSources();
        $arguments = [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--tagid' => '1',
            '--video-limit' => 10,
            '--keyword-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ];

        $firstExit = Artisan::call('reports:live-tag-date:build', $arguments);
        $first = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExit);
        $this->assertSame('execute', $first['mode']);
        $this->assertSame(1, $first['inserted']);
        $this->assertSame(1, $first['writes']);
        $this->assertSame(0, $first['invalid_log_rows']);
        $this->assertSame(0, $first['failed_dates']);

        $row = DB::table('urt_show_live_tag_date')->first();
        $this->assertNotNull($row);
        $this->assertSame('1', $row->tagid);
        $this->assertSame('', $row->tag_or);
        $this->assertSame('', $row->tag_not);
        $this->assertSame(1, (int) $row->count_channels);
        $this->assertSame(1, (int) $row->count_videos);
        $this->assertSame(2, (int) $row->count_tags);
        $this->assertSame(2, (int) $row->tags_count);
        $this->assertSame(150, (int) $row->total_views);
        $this->assertSame([
            '10' => ['count' => 1, 'views' => 150],
            '11' => ['count' => 1, 'views' => 90],
        ], json_decode($row->hour_result, true));
        $tagsViews = json_decode($row->tags_views, true);
        $this->assertSame(['10' => 150, '11' => 90], $tagsViews['選舉']);
        $this->assertSame(['10' => 150, '11' => 90], $tagsViews['政策']);
        $this->assertArrayNotHasKey('新聞', $tagsViews);

        $response = $this->getJson('/api/api_live_tag_date.php?tagid=1&date=2026-05-21');
        $response->assertOk();
        $response->assertJsonPath('meta.available', true);
        $response->assertJsonPath('meta.counts.videos', 1);
        $response->assertJsonPath('result.hour.10.views', 150);
        $response->assertJsonPath('result.views.選舉.11', 90);

        $mtime = $row->mtime;
        $secondExit = Artisan::call('reports:live-tag-date:build', $arguments);
        $second = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExit);
        $this->assertSame(0, $second['inserted']);
        $this->assertSame(0, $second['updated']);
        $this->assertSame(1, $second['unchanged']);
        $this->assertSame(0, $second['writes']);
        $this->assertSame(1, DB::table('urt_show_live_tag_date')->count());
        $this->assertSame($mtime, DB::table('urt_show_live_tag_date')->value('mtime'));
    }

    public function test_empty_channel_match_does_not_fall_back_to_all_logs(): void
    {
        $this->createTables();
        $this->seedSources();

        $exitCode = Artisan::call('reports:live-tag-date:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--tagid' => '99',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);
        $row = DB::table('urt_show_live_tag_date')->first();

        $this->assertSame(0, $exitCode);
        $this->assertSame(0, $payload['channels_matched']);
        $this->assertSame(0, $payload['videos_scanned']);
        $this->assertSame(0, (int) $row->count_videos);
        $this->assertSame([], json_decode($row->hour_result, true));
    }

    public function test_execute_isolates_one_date_failure_continues_and_logs_summary(): void
    {
        $this->createTables();
        $this->seedSources();
        Log::spy();
        DB::statement("CREATE TRIGGER reject_first_live_date BEFORE INSERT ON urt_show_live_tag_date WHEN NEW.the_date = '2026-05-21' BEGIN SELECT RAISE(FAIL, 'sensitive database detail'); END");

        $exitCode = Artisan::call('reports:live-tag-date:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
            '--tagid' => '1',
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_dates']);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame(['2026-05-22'], DB::table('urt_show_live_tag_date')->pluck('the_date')->all());
        $this->assertStringNotContainsString('sensitive database detail', $output);
        Log::shouldHaveReceived('warning')->once()->withArgs(
            fn (string $message, array $context): bool => $message === 'Live tag-date cache build completed with gaps.'
                && $context['failed_dates'] === 1,
        );
    }

    public function test_video_cap_blocks_only_incomplete_date_and_preserves_existing_cache(): void
    {
        $this->createTables();
        $this->seedSources();
        DB::table('urt_video')->insert(['videoId' => 'video-extra', 'u_id' => 10, 'title' => '選舉政策']);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'video-extra',
            'u_id' => 10,
            'the_date' => '2026-05-21',
            'max_current' => 80,
            'log_json' => json_encode(['12:00' => 80]),
        ]);
        $base = [
            '--tagid' => '1',
            '--keyword-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ];

        $this->assertSame(0, Artisan::call('reports:live-tag-date:build', $base + [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--video-limit' => 10,
        ]));
        $existing = DB::table('urt_show_live_tag_date')->where('the_date', '2026-05-21')->value('videos_result');

        $exitCode = Artisan::call('reports:live-tag-date:build', $base + [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
            '--video-limit' => 1,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('source_incomplete', $payload['blocked_reason']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(1, $payload['blocked_dates']);
        $this->assertSame('blocked', $payload['rows'][0]['status']);
        $this->assertSame('video_scan_limit_exceeded', $payload['rows'][0]['reason']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame($existing, DB::table('urt_show_live_tag_date')->where('the_date', '2026-05-21')->value('videos_result'));
        $this->assertSame(1, DB::table('urt_show_live_tag_date')->where('the_date', '2026-05-22')->count());
    }

    public function test_invalid_log_blocks_only_affected_date_and_preserves_existing_cache(): void
    {
        $this->createTables();
        $this->seedSources();
        $base = [
            '--tagid' => '1',
            '--video-limit' => 10,
            '--keyword-limit' => 10,
            '--execute' => true,
            '--json' => true,
        ];

        $this->assertSame(0, Artisan::call('reports:live-tag-date:build', $base + [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
        ]));
        $existing = DB::table('urt_show_live_tag_date')->where('the_date', '2026-05-21')->first();
        DB::table('urt_video')->insert([
            ['videoId' => 'video-invalid', 'u_id' => 10, 'title' => '選舉'],
            ['videoId' => 'video-day-two', 'u_id' => 10, 'title' => '選舉政策'],
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'video-invalid',
                'u_id' => 10,
                'the_date' => '2026-05-21',
                'max_current' => 999,
                'log_json' => '{bad-json',
            ],
            [
                'videoId' => 'video-day-two',
                'u_id' => 10,
                'the_date' => '2026-05-22',
                'max_current' => 70,
                'log_json' => json_encode(['09:00' => 70]),
            ],
        ]);

        $exitCode = Artisan::call('reports:live-tag-date:build', $base + [
            '--from' => '2026-05-21',
            '--to' => '2026-05-22',
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('source_incomplete', $payload['blocked_reason']);
        $this->assertFalse($payload['source_complete']);
        $this->assertFalse($payload['source_truncated']);
        $this->assertSame(1, $payload['invalid_log_rows']);
        $this->assertSame(1, $payload['failed_dates']);
        $this->assertSame(1, $payload['blocked_dates']);
        $this->assertSame('blocked', $payload['rows'][0]['status']);
        $this->assertSame('invalid_log_rows', $payload['rows'][0]['reason']);
        $this->assertSame(1, $payload['rows'][0]['invalid_log_rows']);
        $this->assertSame('inserted', $payload['rows'][1]['status']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame((array) $existing, (array) DB::table('urt_show_live_tag_date')->where('the_date', '2026-05-21')->first());
        $this->assertSame(1, DB::table('urt_show_live_tag_date')->where('the_date', '2026-05-22')->count());
    }

    public function test_execute_requires_dates_and_reports_schema_date_and_lock_blockers_safely(): void
    {
        $missingDates = Artisan::call('reports:live-tag-date:build', ['--execute' => true]);
        $this->assertSame(1, $missingDates);
        $this->assertStringContainsString('--execute requires explicit --from and --to', Artisan::output());

        $invalidDate = Artisan::call('reports:live-tag-date:build', [
            '--from' => '2026-02-30',
            '--to' => '2026-02-30',
            '--json' => true,
        ]);
        $invalidPayload = json_decode(trim(Artisan::output()), true);
        $this->assertSame(1, $invalidDate);
        $this->assertSame('invalid_date_range', $invalidPayload['blocked_reason']);

        $missingSchema = Artisan::call('reports:live-tag-date:build', [
            '--from' => '2026-05-21',
            '--to' => '2026-05-21',
            '--execute' => true,
            '--json' => true,
        ]);
        $schemaOutput = trim(Artisan::output());
        $schemaPayload = json_decode($schemaOutput, true);
        $this->assertSame(1, $missingSchema);
        $this->assertSame('missing_table:urt_video_live_log', $schemaPayload['blocked_reason']);
        $this->assertStringNotContainsString('SQLSTATE', $schemaOutput);

        $this->createTables();
        $lock = Cache::lock('ingestion:reports.live_tag_date.build', 60);
        $this->assertTrue($lock->get());

        try {
            $locked = Artisan::call('reports:live-tag-date:build', [
                '--from' => '2026-05-21',
                '--to' => '2026-05-21',
                '--execute' => true,
                '--json' => true,
            ]);
            $lockedPayload = json_decode(trim(Artisan::output()), true);
            $this->assertSame(1, $locked);
            $this->assertSame('cache_build_locked', $lockedPayload['blocked_reason']);
        } finally {
            $lock->release();
        }
    }

    public function test_registry_entry_is_manual_and_never_scheduled_implicitly(): void
    {
        $job = app(IngestionJobRegistry::class)->find('reports.live_tag_date.build');

        $this->assertNotNull($job);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('reports:live-tag-date:build', $job['modern_command']);
        $this->assertSame('', $job['scheduled_execute_command']);
        $this->assertTrue($job['command_exists']);
        $this->assertFalse(app(IngestionJobRegistry::class)->scheduledWriteProfile($job)['allowed']);
    }

    private function createTables(): void
    {
        foreach (['urt_show_live_tag_date', 'urt_video_live_log', 'urt_video', 'urt_count', 'tags'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id')->primary();
            $table->string('tags')->nullable();
        });
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
            $table->string('title')->nullable();
        });
        Schema::create('urt_video_live_log', function ($table): void {
            $table->increments('pk');
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });
        Schema::create('urt_show_live_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->date('the_date');
            $table->integer('tags_count')->nullable();
            $table->integer('total_views')->nullable();
            $table->text('hour_result')->nullable();
            $table->text('videos_result')->nullable();
            $table->longText('all_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
    }

    private function seedSources(): void
    {
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]'],
            ['u_id' => 20, 'tags' => '[2]'],
        ]);
        DB::table('tags')->insert([
            ['tag' => '選舉', 'no_tag' => null, 'hours_count' => 100],
            ['tag' => '政策', 'no_tag' => null, 'hours_count' => 90],
            ['tag' => '新聞', 'no_tag' => null, 'hours_count' => 80],
            ['tag' => '排除詞', 'no_tag' => 1, 'hours_count' => 1000],
        ]);
        DB::table('urt_video')->insert([
            ['videoId' => 'video-a', 'u_id' => 10, 'title' => '選舉政策新聞'],
            ['videoId' => 'video-b', 'u_id' => 20, 'title' => '選舉新聞'],
        ]);
        DB::table('urt_video_live_log')->insert([
            [
                'videoId' => 'video-a',
                'u_id' => 10,
                'the_date' => '2026-05-21',
                'max_current' => 150,
                'log_json' => json_encode(['10:00' => 100, '10:30' => 150, '11:00' => 90]),
            ],
            [
                'videoId' => 'video-b',
                'u_id' => 20,
                'the_date' => '2026-05-21',
                'max_current' => 200,
                'log_json' => json_encode(['10:00' => 200]),
            ],
        ]);
    }
}
