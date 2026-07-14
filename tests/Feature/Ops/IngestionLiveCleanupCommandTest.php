<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionLiveCleanupCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_live_cleanup_previews_stale_live_del_flag_updates_in_preview_mode(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_live')->insert([
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'stale-live',
                'u_id' => 10,
                'publishedAt' => '2026-05-25 08:00:00',
                'actualEndTime' => null,
                'scheduledStartTime' => null,
                'concurrentViewers' => 0,
                'max_current' => 300,
                'mtime' => '2026-05-25 10:30:00',
                'del_flag' => null,
            ],
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'grace-live',
                'u_id' => 11,
                'publishedAt' => '2026-05-25 08:00:00',
                'actualEndTime' => null,
                'scheduledStartTime' => null,
                'concurrentViewers' => 0,
                'max_current' => 200,
                'mtime' => '2026-05-25 11:10:00',
                'del_flag' => null,
            ],
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'future-scheduled',
                'u_id' => 12,
                'publishedAt' => '2026-05-25 08:00:00',
                'actualEndTime' => null,
                'scheduledStartTime' => '2026-05-25 11:00:00',
                'concurrentViewers' => 0,
                'max_current' => 100,
                'mtime' => '2026-05-25 10:00:00',
                'del_flag' => null,
            ],
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'ended-live',
                'u_id' => 13,
                'publishedAt' => '2026-05-25 08:00:00',
                'actualEndTime' => '2026-05-25 11:30:00',
                'scheduledStartTime' => null,
                'concurrentViewers' => 0,
                'max_current' => 100,
                'mtime' => '2026-05-25 10:00:00',
                'del_flag' => null,
            ],
            [
                'ctime' => '2026-05-25 09:00:00',
                'videoId' => 'already-flagged',
                'u_id' => 14,
                'publishedAt' => '2026-05-25 08:00:00',
                'actualEndTime' => null,
                'scheduledStartTime' => null,
                'concurrentViewers' => 0,
                'max_current' => 100,
                'mtime' => '2026-05-25 10:00:00',
                'del_flag' => 1,
            ],
        ]);

        $exitCode = Artisan::call('youtube:live:cleanup', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('2026-05-25 11:20:00', $payload['too_soon']);
        $this->assertSame('2026-05-25 10:00:00', $payload['scheduled_before']);
        $this->assertSame(2, $payload['candidates']);
        $this->assertSame(1, $payload['would_mark_deleted']);
        $this->assertSame(1, $payload['grace_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('stale-live', $payload['rows'][0]['video_id']);
        $this->assertNull(DB::table('urt_video_live')->where('videoId', 'stale-live')->value('del_flag'));
    }

    public function test_reports_live_clean_previews_tag_date_cache_deletes_in_preview_mode(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_show_live_tag_date')->insert([
            [
                'ctime' => '2026-05-25 12:00:00',
                'mtime' => null,
                'stime' => null,
                'tagid' => '13',
                'tag_or' => null,
                'tag_not' => null,
                'count_channels' => 3,
                'count_videos' => 4,
                'count_tags' => 5,
                'the_date' => '2026-05-24',
                'tags_count' => 6,
                'total_views' => 700,
                'hour_result' => '{}',
                'videos_result' => '{}',
                'all_result' => '{}',
                'tags_video' => '{}',
                'tags_views' => '{}',
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'mtime' => null,
                'stime' => null,
                'tagid' => '13',
                'tag_or' => null,
                'tag_not' => null,
                'count_channels' => 1,
                'count_videos' => 2,
                'count_tags' => 3,
                'the_date' => '2026-05-23',
                'tags_count' => 4,
                'total_views' => 500,
                'hour_result' => '{}',
                'videos_result' => '{}',
                'all_result' => '{}',
                'tags_video' => '{}',
                'tags_views' => '{}',
            ],
        ]);

        $exitCode = Artisan::call('reports:live:clean', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(2, $payload['total_rows']);
        $this->assertSame(1, $payload['would_delete']);
        $this->assertSame(1, $payload['retained_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('2026-05-24', $payload['rows'][0]['the_date']);
        $this->assertSame(2, DB::table('urt_show_live_tag_date')->count());
    }

    public function test_youtube_live_cleanup_execute_marks_selected_stale_rows_deleted(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_live')->insert([
            'ctime' => '2026-05-25 09:00:00',
            'videoId' => 'stale-live',
            'u_id' => 10,
            'publishedAt' => '2026-05-25 08:00:00',
            'actualEndTime' => null,
            'scheduledStartTime' => null,
            'concurrentViewers' => 0,
            'max_current' => 300,
            'mtime' => '2026-05-25 10:30:00',
            'del_flag' => null,
        ]);

        $exitCode = Artisan::call('youtube:live:cleanup', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame(['urt_video_live.del_flag'], $payload['writes']);
        $this->assertSame(1, DB::table('urt_video_live')->where('videoId', 'stale-live')->value('del_flag'));
    }

    public function test_reports_live_clean_execute_deletes_selected_invalid_cache_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_show_live_tag_date')->insert([
            [
                'ctime' => '2026-05-25 12:00:00',
                'tagid' => '13',
                'the_date' => '2026-05-24',
            ],
            [
                'ctime' => '2026-05-25 12:00:00',
                'tagid' => '13',
                'the_date' => '2026-05-23',
            ],
        ]);

        $exitCode = Artisan::call('reports:live:clean', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['deleted']);
        $this->assertSame(['urt_show_live_tag_date delete'], $payload['writes']);
        $this->assertSame(1, DB::table('urt_show_live_tag_date')->count());
        $this->assertSame('2026-05-23', DB::table('urt_show_live_tag_date')->value('the_date'));
    }

    public function test_youtube_live_cleanup_isolates_failed_row_and_returns_nonzero(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        DB::table('urt_video_live')->insert([
            $this->staleLiveRow('cleanup-fail', 1, '2026-05-25 10:00:00'),
            $this->staleLiveRow('cleanup-success', 2, '2026-05-25 10:01:00'),
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_live_cleanup
BEFORE UPDATE ON urt_video_live
WHEN OLD.videoId = 'cleanup-fail'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);

        $exitCode = Artisan::call('youtube:live:cleanup', [
            '--execute' => true,
            '--limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertStringNotContainsString('super-secret', $output);
        $this->assertNull(DB::table('urt_video_live')->where('videoId', 'cleanup-fail')->value('del_flag'));
        $this->assertSame(1, DB::table('urt_video_live')->where('videoId', 'cleanup-success')->value('del_flag'));
    }

    public function test_reports_live_clean_isolates_failed_delete_and_bounds_selection(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        DB::table('urt_show_live_tag_date')->insert([
            ['ctime' => '2026-05-25 12:00:00', 'tagid' => '13', 'the_date' => '2026-05-24'],
            ['ctime' => '2026-05-25 11:00:00', 'tagid' => '13', 'the_date' => '2026-05-24'],
            ['ctime' => '2026-05-25 10:00:00', 'tagid' => '13', 'the_date' => '2026-05-24'],
        ]);
        $failedPk = (int) DB::table('urt_show_live_tag_date')->orderByDesc('ctime')->value('pk');
        DB::statement(sprintf(<<<'SQL'
CREATE TRIGGER fail_first_live_cache_cleanup
BEFORE DELETE ON urt_show_live_tag_date
WHEN OLD.pk = %d
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL, $failedPk));

        $exitCode = Artisan::call('reports:live:clean', [
            '--execute' => true,
            '--limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(3, $payload['would_delete']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame(1, $payload['deleted']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertStringNotContainsString('super-secret', $output);
        $this->assertSame(2, DB::table('urt_show_live_tag_date')->count());
    }

    public function test_ingestion_scheduler_can_execute_ingestion_live_cleanup_previews_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.live.cleanup', 'reports.live.clean']);

        $liveCleanup = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 04:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.live.cleanup',
        );
        $cacheCleanup = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:33:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.live.clean',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $liveCleanup['summary']);
        $this->assertSame('executed:local-polling', $liveCleanup['jobs'][0]['action']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $cacheCleanup['summary']);
        $this->assertSame('executed:local-polling', $cacheCleanup['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_show_live_tag_date', 'urt_video_live'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video_live', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->dateTime('actualEndTime')->nullable();
            $table->dateTime('scheduledStartTime')->nullable();
            $table->integer('concurrentViewers')->nullable();
            $table->integer('max_current')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('del_flag')->nullable();
        });

        Schema::create('urt_show_live_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid', 64)->nullable();
            $table->string('tag_or', 64)->nullable();
            $table->string('tag_not', 64)->nullable();
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

    /** @return array<string, mixed> */
    private function staleLiveRow(string $videoId, int $uId, string $mtime): array
    {
        return [
            'ctime' => '2026-05-25 09:00:00',
            'videoId' => $videoId,
            'u_id' => $uId,
            'publishedAt' => '2026-05-25 08:00:00',
            'actualEndTime' => null,
            'scheduledStartTime' => null,
            'concurrentViewers' => 0,
            'max_current' => 100,
            'mtime' => $mtime,
            'del_flag' => null,
        ];
    }
}
