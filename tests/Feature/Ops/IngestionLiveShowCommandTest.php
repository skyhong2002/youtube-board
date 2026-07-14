<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionLiveShowCommandTest extends TestCase
{
    public function test_reports_live_show_outputs_ingestion_snapshot(): void
    {
        $this->createTables();

        DB::table('urt_video_live')->insert([
            [
                'videoId' => 'live-a',
                'u_id' => 10,
                'publishedAt' => now('Asia/Taipei')->subHour()->format('Y-m-d H:i:s'),
                'actualStartTime' => now('Asia/Taipei')->subMinutes(50)->format('Y-m-d H:i:s'),
                'actualEndTime' => null,
                'concurrentViewers' => 250,
                'max_current' => 500,
                'mtime' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ],
            [
                'videoId' => 'ended-a',
                'u_id' => 11,
                'publishedAt' => now('Asia/Taipei')->subHours(2)->format('Y-m-d H:i:s'),
                'actualStartTime' => now('Asia/Taipei')->subHours(2)->format('Y-m-d H:i:s'),
                'actualEndTime' => now('Asia/Taipei')->subHour()->format('Y-m-d H:i:s'),
                'concurrentViewers' => 900,
                'max_current' => 900,
                'mtime' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ],
        ]);

        DB::table('urt_show_video_live')->insert([
            'videoId' => 'live-a',
            'u_id' => 10,
            'title' => '直播 A',
            'channelTitle' => '頻道 A',
            'thumbnails' => 'https://example.test/live.jpg',
            'publishedAt' => now('Asia/Taipei')->subHour()->format('Y-m-d H:i:s'),
        ]);

        DB::table('urt_video_live_log')->insert([
            'videoId' => 'live-a',
            'u_id' => 10,
            'the_date' => now('Asia/Taipei')->toDateString(),
            'ctime' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'max_current' => 500,
            'log_json' => json_encode(['10:00' => 250], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:live:show', [
            '--limit' => 5,
            '--json' => true,
        ]);

        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('dashboard-snapshot', $payload['mode']);
        $this->assertSame(1, $payload['active_live']);
        $this->assertSame(1, $payload['shown']);
        $this->assertSame(1, $payload['log_rows_today']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('live-a', $payload['rows'][0]['video_id']);
        $this->assertSame('直播 A', $payload['rows'][0]['title']);
    }

    public function test_ingestion_scheduler_executes_active_ingestion_live_show_job(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:07:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.live.show',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertTrue($result['scheduler_enabled']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
        $this->assertTrue($result['jobs'][0]['executed']);
        $this->assertFalse($result['jobs'][0]['failed']);
    }

    public function test_reports_live_build_previews_display_cache_inserts_in_preview_mode(): void
    {
        $this->createTables();
        $now = now('Asia/Taipei');

        $videoPk = DB::table('urt_video')->insertGetId([
            'ctime' => $now->copy()->subMinutes(12)->format('Y-m-d H:i:s'),
            'u_id' => 10,
            'id' => 'missing-cache',
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'channelId' => 'UCmissing',
            'title' => '尚未進 display cache 的直播',
            'thumbnails' => 'https://example.test/missing.jpg',
            'channelTitle' => '頻道 Missing',
            'playlistId' => '',
            'position' => 0,
            'videoId' => 'missing-cache',
            'description' => 'preview row',
        ]);

        $cachedVideoPk = DB::table('urt_video')->insertGetId([
            'ctime' => $now->copy()->subMinutes(10)->format('Y-m-d H:i:s'),
            'u_id' => 11,
            'id' => 'cached-live',
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'channelId' => 'UCcached',
            'title' => '已經有 display cache 的直播',
            'thumbnails' => 'https://example.test/cached.jpg',
            'channelTitle' => '頻道 Cached',
            'playlistId' => '',
            'position' => 0,
            'videoId' => 'cached-live',
            'description' => 'cached row',
        ]);

        $missingCachePk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(10)->format('Y-m-d H:i:s'),
            'videoId' => 'missing-cache',
            'u_id' => 10,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'actualStartTime' => $now->copy()->subMinutes(50)->format('Y-m-d H:i:s'),
            'actualEndTime' => null,
            'concurrentViewers' => 250,
            'max_current' => 500,
            'mtime' => $now->format('Y-m-d H:i:s'),
        ]);
        $cachedPk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(8)->format('Y-m-d H:i:s'),
            'videoId' => 'cached-live',
            'u_id' => 11,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'actualStartTime' => $now->copy()->subMinutes(45)->format('Y-m-d H:i:s'),
            'actualEndTime' => null,
            'concurrentViewers' => 120,
            'max_current' => 180,
            'mtime' => $now->format('Y-m-d H:i:s'),
        ]);
        DB::table('urt_video_live')->insert([
            'ctime' => $now->copy()->subMinutes(5)->format('Y-m-d H:i:s'),
            'videoId' => 'no-video-row',
            'u_id' => 12,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'actualStartTime' => $now->copy()->subMinutes(40)->format('Y-m-d H:i:s'),
            'actualEndTime' => null,
            'concurrentViewers' => 80,
            'max_current' => 90,
            'mtime' => $now->format('Y-m-d H:i:s'),
        ]);
        DB::table('urt_video_live')->insert([
            'ctime' => $now->copy()->subHours(5)->format('Y-m-d H:i:s'),
            'videoId' => 'old-live',
            'u_id' => 13,
            'publishedAt' => $now->copy()->subHours(6)->format('Y-m-d H:i:s'),
            'actualStartTime' => $now->copy()->subHours(5)->format('Y-m-d H:i:s'),
            'actualEndTime' => null,
            'concurrentViewers' => 50,
            'max_current' => 60,
            'mtime' => $now->format('Y-m-d H:i:s'),
        ]);

        DB::table('urt_show_video_live')->insert([
            'pk_live' => $cachedPk,
            'v_pk' => $cachedVideoPk,
            'videoId' => 'cached-live',
            'u_id' => 11,
            'title' => '已經有 display cache 的直播',
            'channelTitle' => '頻道 Cached',
            'thumbnails' => 'https://example.test/cached.jpg',
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
        ]);

        $exitCode = Artisan::call('reports:live:build', [
            '--hours' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(3, $payload['candidates']);
        $this->assertSame(1, $payload['already_cached']);
        $this->assertSame(1, $payload['would_insert']);
        $this->assertSame(1, $payload['missing_video_metadata']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame($missingCachePk, $payload['rows'][0]['pk_live']);
        $this->assertSame('missing-cache', $payload['rows'][0]['video_id']);
        $this->assertSame('尚未進 display cache 的直播', $payload['rows'][0]['title']);
        $this->assertSame(1, DB::table('urt_show_video_live')->count());
    }

    public function test_reports_live_build_execute_writes_display_cache_rows_idempotently(): void
    {
        $this->createTables();
        $now = now('Asia/Taipei');

        $videoPk = DB::table('urt_video')->insertGetId([
            'ctime' => $now->copy()->subMinutes(12)->format('Y-m-d H:i:s'),
            'u_id' => 10,
            'id' => 'execute-cache',
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'channelId' => 'UCexecute',
            'title' => '需要寫入 display cache 的直播',
            'thumbnails' => 'https://example.test/execute.jpg',
            'channelTitle' => '頻道 Execute',
            'playlistId' => '',
            'position' => 0,
            'videoId' => 'execute-cache',
            'description' => 'execute row',
        ]);

        $livePk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(10)->format('Y-m-d H:i:s'),
            'videoId' => 'execute-cache',
            'u_id' => 10,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'actualStartTime' => $now->copy()->subMinutes(50)->format('Y-m-d H:i:s'),
            'actualEndTime' => null,
            'concurrentViewers' => 250,
            'max_current' => 500,
            'mtime' => $now->format('Y-m-d H:i:s'),
        ]);

        $firstExitCode = Artisan::call('reports:live:build', [
            '--hours' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['cache_writes']);
        $this->assertSame(1, DB::table('urt_show_video_live')->count());
        $display = DB::table('urt_show_video_live')->first();
        $this->assertSame($livePk, (int) $display->pk_live);
        $this->assertSame($videoPk, (int) $display->v_pk);
        $this->assertSame('execute-cache', $display->videoId);
        $this->assertSame('需要寫入 display cache 的直播', $display->title);
        $this->assertSame('頻道 Execute', $display->channelTitle);

        $secondExitCode = Artisan::call('reports:live:build', [
            '--hours' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $secondPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame('execute', $secondPayload['mode']);
        $this->assertSame(0, $secondPayload['cache_writes']);
        $this->assertSame(1, DB::table('urt_show_video_live')->count());
    }

    public function test_reports_live_build_execute_reports_missing_video_metadata_without_blocking_complete_rows(): void
    {
        $this->createTables();
        $now = now('Asia/Taipei');

        $videoPk = DB::table('urt_video')->insertGetId([
            'u_id' => 20,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'channelId' => 'UC-complete',
            'channelTitle' => 'Complete Channel',
            'title' => 'Complete live row',
            'thumbnails' => 'https://example.test/complete.jpg',
            'videoId' => 'complete-live-cache',
            'description' => 'complete',
        ]);
        $completeLivePk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(10)->format('Y-m-d H:i:s'),
            'videoId' => 'complete-live-cache',
            'u_id' => 20,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
        ]);
        $missingLivePk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(5)->format('Y-m-d H:i:s'),
            'videoId' => 'missing-video-metadata',
            'u_id' => 21,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
        ]);
        Log::spy();

        $exitCode = Artisan::call('reports:live:build', [
            '--execute' => true,
            '--limit' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['missing_video_metadata']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['cache_writes']);
        $this->assertSame([
            'pk_live' => $missingLivePk,
            'video_id' => 'missing-video-metadata',
            'reason' => 'missing_video_metadata',
        ], $payload['skipped'][0]);
        $this->assertSame($videoPk, (int) DB::table('urt_show_video_live')->where('pk_live', $completeLivePk)->value('v_pk'));
        $this->assertFalse(DB::table('urt_show_video_live')->where('pk_live', $missingLivePk)->exists());
        Log::shouldHaveReceived('warning')
            ->once()
            ->with('Live display cache source rows are missing video metadata.', [
                'reason' => 'missing_video_metadata',
                'missing_video_metadata' => 1,
                'reported_rows' => 1,
            ]);
    }

    public function test_reports_live_build_execute_isolates_failed_rows_and_redacts_database_errors(): void
    {
        $this->createTables();
        $now = now('Asia/Taipei');

        $successfulVideoPk = DB::table('urt_video')->insertGetId([
            'u_id' => 20,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'channelId' => 'UC-success',
            'channelTitle' => 'Successful Channel',
            'title' => 'Successful live row',
            'thumbnails' => 'https://example.test/success.jpg',
            'videoId' => 'successful-live-cache',
            'description' => 'success',
        ]);
        $failingVideoPk = DB::table('urt_video')->insertGetId([
            'u_id' => 10,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
            'channelId' => 'UC-fail',
            'channelTitle' => 'Failing Channel',
            'title' => 'Failing live row',
            'thumbnails' => 'https://example.test/fail.jpg',
            'videoId' => 'failing-live-cache',
            'description' => 'failure',
        ]);
        $successfulLivePk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(10)->format('Y-m-d H:i:s'),
            'videoId' => 'successful-live-cache',
            'u_id' => 20,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
        ]);
        $failingLivePk = DB::table('urt_video_live')->insertGetId([
            'ctime' => $now->copy()->subMinutes(5)->format('Y-m-d H:i:s'),
            'videoId' => 'failing-live-cache',
            'u_id' => 10,
            'publishedAt' => $now->copy()->subHour()->format('Y-m-d H:i:s'),
        ]);
        DB::statement(<<<SQL
CREATE TRIGGER fail_first_live_cache
BEFORE INSERT ON urt_show_video_live
WHEN NEW.pk_live = {$failingLivePk}
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);
        Log::spy();

        $exitCode = Artisan::call('reports:live:build', [
            '--execute' => true,
            '--limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['cache_writes']);
        $this->assertSame([
            'pk_live' => $failingLivePk,
            'reason' => 'item_processing_failed',
        ], $payload['skipped'][0]);
        $this->assertStringNotContainsString('super-secret', $output);
        $this->assertSame(0, DB::table('urt_show_video_live')->where('pk_live', $failingLivePk)->count());
        $this->assertSame(1, DB::table('urt_show_video_live')->where('pk_live', $successfulLivePk)->count());
        $this->assertSame($successfulVideoPk, (int) DB::table('urt_show_video_live')->where('pk_live', $successfulLivePk)->value('v_pk'));
        $this->assertNotSame($failingVideoPk, $successfulVideoPk);
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context) use ($failingLivePk): bool {
                return $message === 'Live display cache item processing failed.'
                    && $context['pk_live'] === $failingLivePk
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            });
    }

    public function test_ingestion_scheduler_can_execute_ingestion_live_build_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:09:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.live.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_video_live_log', 'urt_show_video_live', 'urt_video_live', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video_live', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->dateTime('actualStartTime')->nullable();
            $table->dateTime('actualEndTime')->nullable();
            $table->integer('concurrentViewers')->nullable();
            $table->integer('max_current')->nullable();
            $table->dateTime('mtime')->nullable();
        });

        Schema::create('urt_show_video_live', function ($table): void {
            $table->integer('pk_live')->nullable();
            $table->integer('v_pk')->nullable();
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
            $table->string('thumbnails')->nullable();
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('u_id')->nullable();
            $table->string('id')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('channelId')->nullable();
            $table->string('title')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('channelTitle')->nullable();
            $table->string('playlistId')->nullable();
            $table->integer('position')->nullable();
            $table->string('videoId');
            $table->text('description')->nullable();
        });
    }
}
