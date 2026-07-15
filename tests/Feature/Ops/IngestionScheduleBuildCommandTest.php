<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionScheduleBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_reports_schedule_build_previews_legacy_stime_recalculation_in_preview_mode(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_schedule')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'mtime' => '2026-05-25 11:00:00',
                'stime' => '2026-05-25 11:30:00',
                'videoId' => 'scheduled-a',
                'publishedAt' => '2026-05-25 09:00:00',
                'viewCount' => 2500,
                'likeCount' => 10,
                'commentCount' => 3,
            ],
            [
                'ctime' => '2026-05-25 09:10:00',
                'mtime' => '2026-05-25 11:10:00',
                'stime' => null,
                'videoId' => 'missing-history',
                'publishedAt' => '2026-05-25 09:10:00',
                'viewCount' => 100,
                'likeCount' => 1,
                'commentCount' => 0,
            ],
            [
                'ctime' => '2026-05-25 06:00:00',
                'mtime' => '2026-05-25 08:00:00',
                'stime' => null,
                'videoId' => 'old-schedule',
                'publishedAt' => '2026-05-25 06:00:00',
                'viewCount' => 999,
                'likeCount' => 9,
                'commentCount' => 1,
            ],
        ]);

        DB::table('urt_video_log_history')->insert([
            [
                'ctime' => '2026-05-25 10:00:00',
                'videoId' => 'scheduled-a',
                'viewCount' => 500,
                'likeCount' => 5,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 1,
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => 'scheduled-a',
                'viewCount' => 2500,
                'likeCount' => 10,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 3,
            ],
        ]);

        $exitCode = Artisan::call('reports:schedule:build', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('2026-05-25 11:00:00', $payload['window_start']);
        $this->assertSame(2, $payload['candidates']);
        $this->assertSame(1, $payload['with_history']);
        $this->assertSame(1, $payload['missing_history']);
        $this->assertSame(1, $payload['would_update']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('scheduled-a', $payload['rows'][0]['video_id']);
        $this->assertSame(2000, $payload['rows'][0]['view_delta']);
        $this->assertSame('legacy_fast_floor_2_hours', $payload['rows'][0]['cap']);
        $this->assertSame('2026-05-25 13:00:00', $payload['rows'][0]['estimated_stime']);
        $this->assertSame('2026-05-25 11:30:00', DB::table('urt_video_schedule')->where('videoId', 'scheduled-a')->value('stime'));
    }

    public function test_reports_schedule_build_supports_single_video_and_published_at_fallback(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_schedule')->insert([
            'ctime' => '2026-05-25 09:00:00',
            'mtime' => '2026-05-25 11:00:00',
            'stime' => null,
            'videoId' => 'single-history',
            'publishedAt' => '2026-05-25 10:00:00',
            'viewCount' => 1500,
            'likeCount' => 3,
            'commentCount' => 1,
        ]);
        DB::table('urt_video_log_history')->insert([
            'ctime' => '2026-05-25 12:00:00',
            'videoId' => 'single-history',
            'viewCount' => 1500,
            'likeCount' => 3,
            'dislikeCount' => 0,
            'favoriteCount' => 0,
            'commentCount' => 1,
        ]);

        $exitCode = Artisan::call('reports:schedule:build', [
            '--videoId' => 'single-history',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('single-history', $payload['video_id']);
        $this->assertSame(1, $payload['candidates']);
        $this->assertSame('publishedAt fallback', $payload['rows'][0]['history']['previous']['source']);
        $this->assertSame(1500, $payload['rows'][0]['view_delta']);
        $this->assertSame('2026-05-25 13:00:00', $payload['rows'][0]['estimated_stime']);
    }

    public function test_reports_schedule_build_execute_updates_selected_schedule_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_schedule')->insert([
            'ctime' => '2026-05-25 09:00:00',
            'mtime' => '2026-05-25 11:00:00',
            'stime' => '2026-05-25 11:30:00',
            'videoId' => 'scheduled-a',
            'publishedAt' => '2026-05-25 09:00:00',
            'viewCount' => 2500,
            'likeCount' => 10,
            'commentCount' => 3,
        ]);

        DB::table('urt_video_log_history')->insert([
            [
                'ctime' => '2026-05-25 10:00:00',
                'videoId' => 'scheduled-a',
                'viewCount' => 500,
                'likeCount' => 5,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 1,
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => 'scheduled-a',
                'viewCount' => 2500,
                'likeCount' => 10,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 3,
            ],
        ]);

        $exitCode = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame(['urt_video_schedule.stime', 'urt_video_schedule.mtime'], $payload['writes']);
        $this->assertSame('2026-05-25 13:00:00', DB::table('urt_video_schedule')->where('videoId', 'scheduled-a')->value('stime'));
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_video_schedule')->where('videoId', 'scheduled-a')->value('mtime'));
    }

    public function test_reports_schedule_build_execute_isolates_failed_rows_and_redacts_database_errors(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_schedule')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'mtime' => '2026-05-25 11:00:00',
                'stime' => '2026-05-25 11:30:00',
                'videoId' => 'scheduled-fail',
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 2000,
            ],
            [
                'ctime' => '2026-05-25 09:10:00',
                'mtime' => '2026-05-25 11:10:00',
                'stime' => '2026-05-25 11:40:00',
                'videoId' => 'scheduled-success',
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 2000,
            ],
        ]);
        DB::table('urt_video_log_history')->insert([
            [
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => 'scheduled-fail',
                'viewCount' => 2000,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => 'scheduled-success',
                'viewCount' => 2000,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ],
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_schedule_report
BEFORE UPDATE ON urt_video_schedule
WHEN OLD.videoId = 'scheduled-fail'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);
        Log::spy();

        $exitCode = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame([
            'video_id' => 'scheduled-fail',
            'reason' => 'item_processing_failed',
        ], $payload['skipped'][0]);
        $this->assertStringNotContainsString('super-secret', $output);
        $this->assertSame('2026-05-25 11:30:00', DB::table('urt_video_schedule')->where('videoId', 'scheduled-fail')->value('stime'));
        $this->assertSame('2026-05-25 13:10:00', DB::table('urt_video_schedule')->where('videoId', 'scheduled-success')->value('stime'));
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Schedule reports item processing failed.'
                    && $context['video_id'] === 'scheduled-fail'
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            });
    }

    public function test_reports_schedule_build_bounds_history_scan_and_rotates_selected_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        for ($index = 1; $index <= 3; $index++) {
            $videoId = 'bounded-schedule-'.$index;
            DB::table('urt_video_schedule')->insert([
                'ctime' => '2026-05-25 09:00:00',
                'mtime' => sprintf('2026-05-25 11:0%d:00', $index - 1),
                'stime' => null,
                'videoId' => $videoId,
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 1500,
            ]);
            DB::table('urt_video_log_history')->insert([
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => $videoId,
                'viewCount' => 1500,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ]);
        }

        $firstExit = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--limit' => 1,
            '--json' => true,
        ]);
        $first = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExit);
        $this->assertSame(3, $first['candidates']);
        $this->assertSame(1, $first['selected_candidates']);
        $this->assertTrue($first['source_truncated']);
        $this->assertSame(1, $first['history_rows_scanned']);
        $this->assertSame('bounded-schedule-1', $first['rows'][0]['video_id']);
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_video_schedule')->where('videoId', 'bounded-schedule-1')->value('mtime'));

        $secondExit = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--limit' => 1,
            '--json' => true,
        ]);
        $second = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExit);
        $this->assertSame('bounded-schedule-2', $second['rows'][0]['video_id']);
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_video_schedule')->where('videoId', 'bounded-schedule-2')->value('mtime'));
        $this->assertSame('2026-05-25 11:02:00', DB::table('urt_video_schedule')->where('videoId', 'bounded-schedule-3')->value('mtime'));
    }

    public function test_reports_schedule_build_cools_down_invalid_history_and_rotates_to_valid_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_schedule')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'mtime' => '2026-05-25 11:00:00',
                'stime' => '2026-05-25 11:15:00',
                'videoId' => 'invalid-history',
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 100,
            ],
            [
                'ctime' => '2026-05-25 09:01:00',
                'mtime' => '2026-05-25 11:01:00',
                'stime' => '2026-05-25 11:30:00',
                'videoId' => 'valid-history',
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 1500,
            ],
        ]);
        DB::table('urt_video_log_history')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'invalid-history',
                'viewCount' => 100,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => 'valid-history',
                'viewCount' => 1500,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ],
        ]);
        Log::spy();

        $firstExitCode = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $firstExitCode);
        $this->assertSame(1, $firstPayload['selected_candidates']);
        $this->assertTrue($firstPayload['source_truncated']);
        $this->assertSame(1, $firstPayload['failed_rows']);
        $this->assertSame(0, $firstPayload['updated']);
        $this->assertSame([
            'video_id' => 'invalid-history',
            'reason' => 'invalid_history_payload',
        ], $firstPayload['skipped'][0]);
        $this->assertSame('2026-05-25 11:15:00', DB::table('urt_video_schedule')->where('videoId', 'invalid-history')->value('stime'));
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_video_schedule')->where('videoId', 'invalid-history')->value('mtime'));
        $this->assertSame('2026-05-25 09:00:00', DB::table('urt_video_log_history')->where('videoId', 'invalid-history')->value('ctime'));
        $this->assertSame(100, DB::table('urt_video_log_history')->where('videoId', 'invalid-history')->value('viewCount'));
        $this->assertSame('2026-05-25 11:30:00', DB::table('urt_video_schedule')->where('videoId', 'valid-history')->value('stime'));

        $secondExitCode = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--limit' => 1,
            '--json' => true,
        ]);
        $secondPayload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(0, $secondPayload['failed_rows']);
        $this->assertSame(1, $secondPayload['updated']);
        $this->assertSame('valid-history', $secondPayload['rows'][0]['video_id']);
        $this->assertSame('2026-05-25 13:01:00', DB::table('urt_video_schedule')->where('videoId', 'valid-history')->value('stime'));
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_video_schedule')->where('videoId', 'valid-history')->value('mtime'));
        Log::shouldHaveReceived('warning')
            ->once()
            ->with('Schedule reports source history is invalid.', [
                'video_id' => 'invalid-history',
                'reason' => 'invalid_history_payload',
            ]);
    }

    public function test_reports_schedule_build_isolates_invalid_source_cooldown_write_failures(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_schedule')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'mtime' => '2026-05-25 11:00:00',
                'stime' => '2026-05-25 11:15:00',
                'videoId' => 'invalid-history',
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 100,
            ],
            [
                'ctime' => '2026-05-25 09:01:00',
                'mtime' => '2026-05-25 11:01:00',
                'stime' => '2026-05-25 11:30:00',
                'videoId' => 'valid-history',
                'publishedAt' => '2026-05-25 10:00:00',
                'viewCount' => 1500,
            ],
        ]);
        DB::table('urt_video_log_history')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'invalid-history',
                'viewCount' => 100,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'videoId' => 'valid-history',
                'viewCount' => 1500,
                'likeCount' => 0,
                'dislikeCount' => 0,
                'favoriteCount' => 0,
                'commentCount' => 0,
            ],
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_schedule_report_cooldown
BEFORE UPDATE ON urt_video_schedule
WHEN OLD.videoId = 'invalid-history'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);
        Log::spy();

        $exitCode = Artisan::call('reports:schedule:build', [
            '--execute' => true,
            '--limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['updated']);
        $this->assertStringNotContainsString('super-secret', $output);
        $this->assertSame('2026-05-25 11:00:00', DB::table('urt_video_schedule')->where('videoId', 'invalid-history')->value('mtime'));
        $this->assertSame('2026-05-25 11:15:00', DB::table('urt_video_schedule')->where('videoId', 'invalid-history')->value('stime'));
        $this->assertSame('2026-05-25 13:01:00', DB::table('urt_video_schedule')->where('videoId', 'valid-history')->value('stime'));
        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Schedule reports invalid-source cooldown failed.'
                    && $context['video_id'] === 'invalid-history'
                    && $context['reason'] === 'cooldown_write_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            })
            ->once();
    }

    public function test_ingestion_scheduler_can_execute_ingestion_schedule_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['reports.schedule.build']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:29:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.schedule.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_video_log_history', 'urt_video_schedule'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video_schedule', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('videoId')->unique();
            $table->dateTime('publishedAt');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video_log_history', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->string('videoId');
            $table->integer('viewCount');
            $table->integer('likeCount');
            $table->integer('dislikeCount');
            $table->integer('favoriteCount');
            $table->integer('commentCount');
        });
    }
}
