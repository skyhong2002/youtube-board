<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyLiveCleanupCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_live_cleanup_previews_stale_live_del_flag_updates_without_writes(): void
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
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('2026-05-25 11:20:00', $payload['too_soon']);
        $this->assertSame('2026-05-25 10:00:00', $payload['scheduled_before']);
        $this->assertSame(2, $payload['candidates']);
        $this->assertSame(1, $payload['would_mark_deleted']);
        $this->assertSame(1, $payload['grace_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('stale-live', $payload['rows'][0]['video_id']);
        $this->assertNull(DB::table('urt_video_live')->where('videoId', 'stale-live')->value('del_flag'));
    }

    public function test_reports_live_clean_previews_tag_date_cache_deletes_without_writes(): void
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
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame(2, $payload['total_rows']);
        $this->assertSame(1, $payload['would_delete']);
        $this->assertSame(1, $payload['retained_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('2026-05-24', $payload['rows'][0]['the_date']);
        $this->assertSame(2, DB::table('urt_show_live_tag_date')->count());
    }

    public function test_ingestion_scheduler_can_execute_read_only_live_cleanup_previews_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

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
        $this->assertSame('executed', $liveCleanup['jobs'][0]['action']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $cacheCleanup['summary']);
        $this->assertSame('executed', $cacheCleanup['jobs'][0]['action']);
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
}
