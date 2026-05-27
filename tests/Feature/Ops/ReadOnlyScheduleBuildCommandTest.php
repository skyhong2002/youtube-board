<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyScheduleBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_reports_schedule_build_previews_legacy_stime_recalculation_without_writes(): void
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
        $this->assertSame('read-only-preview', $payload['mode']);
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

    public function test_ingestion_scheduler_can_execute_read_only_schedule_preview_when_due(): void
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
