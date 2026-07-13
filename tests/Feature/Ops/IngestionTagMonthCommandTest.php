<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionJobRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionTagMonthCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_preview_is_explicit_capped_and_dry_run_wins_without_writes(): void
    {
        $this->createTables();
        $this->seedDailyRow('3', '2026-04-30', ['甲' => 100, '乙' => 50], ['甲' => 2, '乙' => 1]);
        $this->seedDailyRow('3', '2026-05-24', ['甲' => 200, '乙' => 80], ['甲' => 4, '乙' => 2]);

        $exitCode = Artisan::call('reports:tag-month:build', [
            '--months' => '2026-05,2026-04',
            '--subjects' => '甲,乙',
            '--tagid' => '3',
            '--month-limit' => 1,
            '--subject-limit' => 1,
            '--source-row-limit' => 1,
            '--execute' => true,
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(['2026-04-01'], $payload['months']);
        $this->assertSame(['甲'], $payload['subjects']);
        $this->assertSame(2, $payload['months_requested']);
        $this->assertSame(1, $payload['months_ignored']);
        $this->assertSame(2, $payload['subjects_requested']);
        $this->assertSame(1, $payload['subjects_ignored']);
        $this->assertSame(1, $payload['source_row_limit']);
        $this->assertSame(1, $payload['rows_planned']);
        $this->assertSame(1, $payload['would_insert']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(0, DB::table('urt_show_tag_month')->count());
    }

    public function test_execute_builds_actual_cache_apis_and_keyword_group_trend_then_is_idempotent(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 04:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyRow('3', '2026-05-23', ['毒駕' => 100], ['毒駕' => 2], ['毒駕' => '4.500']);
        $this->seedDailyRow('3', '2026-05-24', ['毒駕' => 200], ['毒駕' => 4], ['毒駕' => '8.500']);
        $this->seedDailyRow('4', '2026-05-23', ['毒駕' => 50], ['毒駕' => 1], ['毒駕' => '2.500']);
        $this->seedDailyRow('4', '2026-05-24', ['毒駕' => 80], ['毒駕' => 2], ['毒駕' => '3.500']);

        $first = $this->runExecute('3');
        $secondGroup = $this->runExecute('4');

        $this->assertSame(1, $first['inserted']);
        $this->assertSame(1, $secondGroup['inserted']);
        $this->assertSame(2, DB::table('urt_show_tag_month')->count());

        $row = DB::table('urt_show_tag_month')->where('tagid', '3')->first();
        $this->assertNotNull($row);
        $this->assertSame('毒駕', $row->tag);
        $this->assertSame('2026-05-01', $row->the_month);
        $this->assertSame(6, (int) $row->count_videos);
        $this->assertSame(300, (int) $row->total_views);
        $this->assertSame([
            '2026-05-23' => [
                'tags_views' => 100,
                'tags_video' => 2,
                'total_views' => 100,
                'count_videos' => 2,
                'tags_result' => '4.500',
            ],
            '2026-05-24' => [
                'tags_views' => 200,
                'tags_video' => 4,
                'total_views' => 200,
                'count_videos' => 4,
                'tags_result' => '8.500',
            ],
        ], json_decode($row->tags_result, true));

        $month = $this->getJson('/api/tag_month.php?tag=毒駕&tagid=3&month=2026-05-01');
        $month->assertOk();
        $month->assertJsonPath('meta.available', true);
        $month->assertJsonPath('meta.count_videos', 6);
        $month->assertJsonPath('meta.total_views', 300);
        $month->assertJsonPath('result.2026-05-24.tags_video', 4);
        $month->assertJsonPath('result.2026-05-24.tags_views', 200);

        $period = $this->getJson('/api/tag_period.php?tag=毒駕&tagid=3&days=60');
        $period->assertOk();
        $period->assertJsonPath('meta.available', true);
        $period->assertJsonPath('result.2026-05-23.tags_views', 100);
        $period->assertJsonPath('result.2026-05-24.tags_video', 4);

        $trend = $this->get('/keywords/毒駕/groups/trends?view=position&days=2&from=2026-05-23&to=2026-05-24&type=total_views&today=0');
        $trend->assertOk();
        $trend->assertSee('泛藍');
        $trend->assertSee('泛綠');
        $trend->assertSee('300');
        $trend->assertSee('130');
        $trend->assertSee('cache rows 2');

        $mtime = $row->mtime;
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 05:00:00', 'Asia/Taipei'));
        $second = $this->runExecute('3');

        $this->assertSame(0, $second['writes']);
        $this->assertSame(1, $second['unchanged']);
        $this->assertSame(2, DB::table('urt_show_tag_month')->count());
        $this->assertSame($mtime, DB::table('urt_show_tag_month')->where('tagid', '3')->value('mtime'));
    }

    public function test_execute_updates_changed_daily_metrics_without_duplicate_rows(): void
    {
        $this->createTables();
        $this->seedDailyRow('3', '2026-05-24', ['議題' => 100], ['議題' => 2]);
        $this->runExecute('3', '議題');

        DB::table('urt_show_tag_date')->where('tagid', '3')->update([
            'tags_views' => json_encode(['議題' => 250], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['議題' => 5], JSON_UNESCAPED_UNICODE),
        ]);
        $payload = $this->runExecute('3', '議題');

        $this->assertSame(1, $payload['updated']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame(1, DB::table('urt_show_tag_month')->count());
        $this->assertSame(250, (int) DB::table('urt_show_tag_month')->value('total_views'));
        $this->assertSame(5, (int) DB::table('urt_show_tag_month')->value('count_videos'));
    }

    public function test_latest_daily_row_metric_shapes_and_duplicate_targets_converge(): void
    {
        $this->createTables();
        $this->seedDailyRow('3', '2026-05-23', ['詞彙' => 100], ['詞彙' => 1]);
        $this->seedDailyRow('3', '2026-05-24', ['詞彙' => 999], ['詞彙' => 99]);
        DB::table('urt_show_tag_date')->insert([
            'ctime' => '2026-05-25 01:00:00',
            'mtime' => '2026-05-25 01:00:00',
            'stime' => '2026-05-25 01:00:00',
            'tagid' => '3',
            'tag_or' => null,
            'tag_not' => null,
            'count_channels' => 1,
            'count_videos' => 2,
            'count_tags' => 1,
            'the_date' => '2026-05-24',
            'tags_count' => 1,
            'total_views' => 2000,
            'tags_result' => json_encode(['data' => ['詞彙' => ['score' => '7.500']]], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['result' => [['tag' => '詞彙', 'views' => 2000, 'videos' => 2]]], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['data' => ['詞彙' => ['views' => 2000, 'videos' => 2]]], JSON_UNESCAPED_UNICODE),
        ]);
        DB::table('urt_show_tag_month')->insert([
            [
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-05-01 00:00:00',
                'tag' => '詞彙',
                'tagid' => '3',
                'tag_or' => null,
                'tag_not' => null,
                'the_month' => '2026-05-01',
                'count_videos' => 99,
                'total_views' => 999,
                'tags_result' => json_encode(['2026-05-24' => ['tags_video' => 99, 'tags_views' => 999]], JSON_UNESCAPED_UNICODE),
            ],
            [
                'ctime' => '2026-05-02 00:00:00',
                'mtime' => '2026-05-02 00:00:00',
                'tag' => '詞彙',
                'tagid' => '3',
                'tag_or' => null,
                'tag_not' => null,
                'the_month' => '2026-05-01',
                'count_videos' => 88,
                'total_views' => 888,
                'tags_result' => json_encode(['2026-05-24' => ['tags_video' => 88, 'tags_views' => 888]], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        $payload = $this->runExecute('3', '詞彙', ['--source-row-limit' => 1]);

        $this->assertSame(1, $payload['source_rows']);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame(2, DB::table('urt_show_tag_month')->count());
        $this->assertSame([2], DB::table('urt_show_tag_month')->distinct()->pluck('count_videos')->map(fn ($value): int => (int) $value)->all());
        $this->assertSame([2000], DB::table('urt_show_tag_month')->distinct()->pluck('total_views')->map(fn ($value): int => (int) $value)->all());

        $result = json_decode((string) DB::table('urt_show_tag_month')->value('tags_result'), true);
        $this->assertSame(2000, $result['2026-05-24']['tags_views']);
        $this->assertSame(2, $result['2026-05-24']['tags_video']);
        $this->assertSame('7.500', $result['2026-05-24']['tags_result']);

        $this->getJson('/api/tag_month.php?tag=詞彙&tagid=3&month=2026-05-01')
            ->assertOk()
            ->assertJsonPath('result.2026-05-24.tags_views', 2000)
            ->assertJsonPath('result.2026-05-24.tags_video', 2);
    }

    public function test_blockers_and_lock_fail_nonzero_with_sanitized_output(): void
    {
        $missingArguments = Artisan::call('reports:tag-month:build', ['--json' => true]);
        $missingPayload = json_decode(trim(Artisan::output()), true);
        $this->assertSame(1, $missingArguments);
        $this->assertSame('explicit_months_required', $missingPayload['blocked_reason']);

        $missingSchema = Artisan::call('reports:tag-month:build', [
            '--months' => '2026-05',
            '--subjects' => '測試',
            '--execute' => true,
            '--json' => true,
        ]);
        $schemaOutput = trim(Artisan::output());
        $schemaPayload = json_decode($schemaOutput, true);
        $this->assertSame(1, $missingSchema);
        $this->assertSame('missing_table:urt_show_tag_date', $schemaPayload['blocked_reason']);
        $this->assertStringNotContainsString('SQLSTATE', $schemaOutput);

        $this->createTables();
        $lock = Cache::lock('ingestion:reports.tag_month.build', 60);
        $this->assertTrue($lock->get());

        try {
            $locked = Artisan::call('reports:tag-month:build', [
                '--months' => '2026-05',
                '--subjects' => '測試',
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

    public function test_subject_failure_is_isolated_and_does_not_expose_database_error(): void
    {
        $this->createTables();
        $this->seedDailyRow('3', '2026-05-24', ['成功' => 100, '失敗' => 50], ['成功' => 2, '失敗' => 1]);
        DB::statement(<<<'SQL'
            CREATE TRIGGER block_failed_subject
            BEFORE INSERT ON urt_show_tag_month
            WHEN NEW.tag = '失敗'
            BEGIN
                SELECT RAISE(ABORT, 'blocked test row');
            END
            SQL);

        $exitCode = Artisan::call('reports:tag-month:build', [
            '--months' => '2026-05',
            '--subjects' => '成功,失敗',
            '--tagid' => '3',
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['inserted']);
        $this->assertSame(1, $payload['failed_subjects']);
        $this->assertSame('inserted', $payload['rows'][0]['status']);
        $this->assertSame('failed', $payload['rows'][1]['status']);
        $this->assertSame('subject_cache_processing_failed', $payload['rows'][1]['reason']);
        $this->assertSame(['成功'], DB::table('urt_show_tag_month')->pluck('tag')->all());
        $this->assertStringNotContainsString('SQLSTATE', $output);
        $this->assertStringNotContainsString('blocked test row', $output);
    }

    public function test_registry_entry_is_planned_manual_only_and_never_scheduled(): void
    {
        $job = app(IngestionJobRegistry::class)->find('reports.tag_month.build');

        $this->assertNotNull($job);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('reports:tag-month:build', $job['modern_command']);
        $this->assertSame('', $job['scheduled_execute_command']);
        $this->assertTrue($job['command_exists']);
        $this->assertFalse(app(IngestionJobRegistry::class)->scheduledWriteProfile($job)['allowed']);
    }

    /**
     * @return array<string, mixed>
     */
    private function runExecute(string $tagId, string $subject = '毒駕', array $options = []): array
    {
        $exitCode = Artisan::call('reports:tag-month:build', array_merge([
            '--months' => '2026-05',
            '--subjects' => $subject,
            '--tagid' => $tagId,
            '--execute' => true,
            '--json' => true,
        ], $options));
        $output = trim(Artisan::output());

        $this->assertSame(0, $exitCode, $output);

        return json_decode($output, true);
    }

    private function createTables(): void
    {
        Schema::create('urt_show_tag_date', function ($table): void {
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
            $table->longText('tags_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
        Schema::create('urt_show_tag_month', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tag');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_month');
            $table->integer('count_videos')->nullable();
            $table->integer('total_views')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    /**
     * @param  array<string, int>  $views
     * @param  array<string, int>  $videos
     * @param  array<string, string|float|int>  $scores
     */
    private function seedDailyRow(string $tagId, string $date, array $views, array $videos, array $scores = []): void
    {
        DB::table('urt_show_tag_date')->insert([
            'ctime' => '2026-05-25 00:00:00',
            'mtime' => '2026-05-25 00:00:00',
            'stime' => '2026-05-25 00:00:00',
            'tagid' => $tagId,
            'tag_or' => null,
            'tag_not' => null,
            'count_channels' => 1,
            'count_videos' => array_sum($videos),
            'count_tags' => count($views),
            'the_date' => $date,
            'tags_count' => count($views),
            'total_views' => array_sum($views),
            'tags_result' => json_encode($scores, JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode($videos, JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode($views, JSON_UNESCAPED_UNICODE),
        ]);
    }
}
