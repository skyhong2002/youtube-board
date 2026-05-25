<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyVideoStatsCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_videos_stats_previews_legacy_schedule_queue_without_api_or_writes(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTables();

        for ($i = 1; $i <= 5; $i++) {
            DB::table('urt_video_schedule')->insert([
                'pk' => $i,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => 'due-video-'.$i,
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 100 + $i,
                'likeCount' => 10 + $i,
                'commentCount' => $i,
            ]);
        }

        DB::table('urt_video_schedule')->insert([
            [
                'pk' => 20,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => '2026-05-25 00:00:00',
                'videoId' => 'future-reserved',
                'publishedAt' => '2026-05-20 12:00:00',
                'viewCount' => 200,
                'likeCount' => 20,
                'commentCount' => 2,
            ],
            [
                'pk' => 21,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'videoId' => 'too-new',
                'publishedAt' => '2026-05-24 17:00:00',
                'viewCount' => 300,
                'likeCount' => 30,
                'commentCount' => 3,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--batch-size' => 5,
            '--loops' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('urt_video_schedule', $payload['source']);
        $this->assertSame(7, $payload['schedule_total']);
        $this->assertSame(5, $payload['due_schedule_rows']);
        $this->assertSame(5, $payload['eligible_rows']);
        $this->assertSame(5, $payload['selected_rows']);
        $this->assertSame(5, $payload['first_batch_rows']);
        $this->assertSame(4, $payload['legacy_threshold']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('2026-06-23 18:00:00', $payload['would_reserve_until']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('due-video-1', $payload['rows'][0]['video_id']);
        $this->assertSame(101, $payload['rows'][0]['current_view_count']);
        $this->assertContains('urt_video_log_history insert', $payload['writes_skipped']);

        $this->assertNull(DB::table('urt_video_schedule')->where('videoId', 'due-video-1')->value('stime'));
        $this->assertSame(101, DB::table('urt_video_schedule')->where('videoId', 'due-video-1')->value('viewCount'));
        $this->assertSame(0, DB::table('urt_video_log_history')->count());
        $this->assertSame(0, DB::table('urt_video_log')->count());
    }

    public function test_youtube_videos_stats_supports_today_missing_view_count_branch(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video')->insert([
            [
                'pk' => 1,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 10,
                'videoId' => 'missing-view-count',
                'title' => 'Missing View Count',
                'channelTitle' => 'Channel A',
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => null,
                'likeCount' => null,
                'commentCount' => null,
            ],
            [
                'pk' => 2,
                'ctime' => '2026-05-24 00:00:00',
                'mtime' => null,
                'stime' => null,
                'u_id' => 11,
                'videoId' => 'already-counted',
                'title' => 'Already Counted',
                'channelTitle' => 'Channel B',
                'publishedAt' => '2026-05-24 12:00:00',
                'viewCount' => 100,
                'likeCount' => 10,
                'commentCount' => 1,
            ],
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--today' => true,
            '--batch-size' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('urt_video', $payload['source']);
        $this->assertTrue($payload['today_mode']);
        $this->assertSame(1, $payload['today_missing_rows']);
        $this->assertSame(1, $payload['eligible_rows']);
        $this->assertSame('missing-view-count', $payload['rows'][0]['video_id']);
        $this->assertSame('Missing View Count', $payload['rows'][0]['title']);

        $this->assertNull(DB::table('urt_video')->where('videoId', 'missing-view-count')->value('viewCount'));
    }

    public function test_youtube_videos_stats_supports_single_video_preview_and_scheduler_execution(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_video')->insert([
            'pk' => 1,
            'ctime' => '2026-05-24 00:00:00',
            'mtime' => null,
            'stime' => null,
            'u_id' => 10,
            'videoId' => 'target-video',
            'title' => 'Target Video',
            'channelTitle' => 'Channel A',
            'publishedAt' => '2026-05-24 12:00:00',
            'viewCount' => 500,
            'likeCount' => 50,
            'commentCount' => 5,
        ]);

        $exitCode = Artisan::call('youtube:videos:stats', [
            '--videoId' => 'target-video',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('target-video', $payload['target_video_id']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame('target-video', $payload['rows'][0]['video_id']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:07:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.videos.stats',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_video_log_history', 'urt_video_log', 'urt_video_schedule', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video_schedule', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->integer('u_id');
            $table->string('videoId');
            $table->string('title');
            $table->string('channelTitle');
            $table->dateTime('publishedAt');
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video_log_history', function ($table): void {
            $table->integer('pk')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->string('videoId')->nullable();
            $table->integer('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('dislikeCount')->nullable();
            $table->integer('favoriteCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_video_log', function ($table): void {
            $table->integer('pk')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->string('videoId')->nullable();
            $table->string('themonth')->nullable();
            $table->text('thedata')->nullable();
        });
    }
}
