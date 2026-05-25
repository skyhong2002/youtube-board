<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyLivePollingCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_live_poll_previews_legacy_stale_live_rows_without_api_or_writes(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        for ($index = 1; $index <= 10; $index++) {
            DB::table('urt_video_live')->insert($this->liveRow(
                videoId: sprintf('eligible-%02d', $index),
                uId: $index,
                mtime: '2026-05-25 11:00:00',
                scheduledStartTime: '2026-05-25 11:30:00',
                concurrentViewers: 100 + $index,
                maxCurrent: 150 + $index,
            ));
        }

        DB::table('urt_video_live')->insert([
            $this->liveRow('fresh-live', 41, '2026-05-25 11:55:00'),
            $this->liveRow('ended-live', 42, '2026-05-25 11:00:00', actualEndTime: '2026-05-25 11:30:00'),
            $this->liveRow('future-scheduled', 43, '2026-05-25 11:00:00', scheduledStartTime: '2026-05-25 12:30:00'),
            $this->liveRow('deleted-live', 44, '2026-05-25 11:00:00', delFlag: 1),
        ]);

        DB::table('urt_video_live_log')->insert([
            'videoId' => 'eligible-01',
            'u_id' => 1,
            'the_date' => '2026-05-25',
            'ctime' => '2026-05-25 11:00:00',
            'mtime' => '2026-05-25 11:30:00',
            'max_current' => 151,
            'log_json' => json_encode(['11:30' => 151]),
        ]);
        DB::table('urt_show_video_live')->insert([
            'videoId' => 'eligible-01',
            'channelTitle' => 'Legacy Live Channel',
            'title' => 'Legacy Live Title',
        ]);

        $exitCode = Artisan::call('youtube:live:poll', [
            '--interval' => 11,
            '--limit' => 5,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('stale_live_rows', $payload['source']);
        $this->assertSame('2026-05-25 11:49:00', $payload['too_soon']);
        $this->assertSame('2026-05-25 12:00:00', $payload['scheduled_before']);
        $this->assertSame(10, $payload['legacy_min_batch']);
        $this->assertSame(12, $payload['active_live_rows']);
        $this->assertSame(10, $payload['eligible_rows']);
        $this->assertSame(10, $payload['selected_rows']);
        $this->assertSame(5, $payload['displayed_rows']);
        $this->assertSame(50, $payload['legacy_batch_limit']);
        $this->assertSame(1, $payload['existing_today_log_rows']);
        $this->assertSame(9, $payload['missing_today_log_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertSame([], $payload['writes']);
        $this->assertContains('urt_video_live_log log_json/max_current update for current minute', $payload['writes_skipped']);
        $this->assertSame('eligible-01', $payload['rows'][0]['video_id']);
        $this->assertSame('Legacy Live Title', $payload['rows'][0]['title']);
        $this->assertTrue($payload['rows'][0]['today_log_exists']);
        $this->assertSame(1, $payload['rows'][0]['today_log_points']);
        $this->assertSame('12:00', $payload['rows'][0]['would_write_minute']);

        $this->assertSame('2026-05-25 11:00:00', DB::table('urt_video_live')->where('videoId', 'eligible-01')->value('mtime'));
        $this->assertSame(1, DB::table('urt_video_live_log')->count());
    }

    public function test_youtube_live_poll_execute_requires_api_key_and_does_not_write_when_missing(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        $this->createTables();

        DB::table('urt_video_live')->insert($this->liveRow('missing-key-live', 1, '2026-05-25 11:00:00'));

        $exitCode = Artisan::call('youtube:live:poll', [
            '--execute' => true,
            '--videoId' => 'missing-key-live',
            '--limit' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not_printed', $output, $output);
        $this->assertSame('2026-05-25 11:00:00', DB::table('urt_video_live')->where('videoId', 'missing-key-live')->value('mtime'));
        $this->assertSame(0, DB::table('urt_video_live_log')->count());
    }

    public function test_youtube_live_poll_execute_parses_api_and_upserts_log_idempotently(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 20:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();

        DB::table('urt_video_live')->insert($this->liveRow(
            videoId: 'execute-live',
            uId: 7,
            mtime: '2026-05-25 19:00:00',
            scheduledStartTime: '2026-05-25 19:30:00',
            concurrentViewers: 100,
            maxCurrent: 120,
        ));

        Http::fake([
            'www.googleapis.com/youtube/v3/videos*' => Http::response([
                'items' => [
                    [
                        'id' => 'execute-live',
                        'liveStreamingDetails' => [
                            'actualStartTime' => '2026-05-25T11:30:00Z',
                            'scheduledStartTime' => '2026-05-25T11:00:00Z',
                            'activeLiveChatId' => 'chat-execute-live-new',
                            'concurrentViewers' => '456',
                        ],
                    ],
                ],
            ], 200),
        ]);

        $firstExitCode = Artisan::call('youtube:live:poll', [
            '--execute' => true,
            '--videoId' => 'execute-live',
            '--limit' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['updated_videos']);
        $this->assertContains('urt_video_live.concurrentViewers', $firstPayload['write_targets']);
        $this->assertSame('2026-05-25 20:00:00', DB::table('urt_video_live')->where('videoId', 'execute-live')->value('mtime'));
        $this->assertSame('2026-05-25 19:30:00', DB::table('urt_video_live')->where('videoId', 'execute-live')->value('actualStartTime'));
        $this->assertSame('2026-05-25 19:00:00', DB::table('urt_video_live')->where('videoId', 'execute-live')->value('scheduledStartTime'));
        $this->assertSame('chat-execute-live-new', DB::table('urt_video_live')->where('videoId', 'execute-live')->value('activeLiveChatId'));
        $this->assertSame(456, DB::table('urt_video_live')->where('videoId', 'execute-live')->value('concurrentViewers'));
        $this->assertSame(456, DB::table('urt_video_live')->where('videoId', 'execute-live')->value('max_current'));
        $this->assertSame(1, DB::table('urt_video_live_log')->where('videoId', 'execute-live')->count());

        $log = DB::table('urt_video_live_log')->where('videoId', 'execute-live')->first();
        $this->assertIsObject($log);
        $this->assertSame('2026-05-25', (string) $log->the_date);
        $this->assertSame(7, (int) $log->u_id);
        $this->assertSame(456, (int) $log->max_current);
        $this->assertSame(['20:00' => 456], json_decode((string) $log->log_json, true));

        $secondExitCode = Artisan::call('youtube:live:poll', [
            '--execute' => true,
            '--videoId' => 'execute-live',
            '--limit' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(1, DB::table('urt_video_live_log')->where('videoId', 'execute-live')->count());
        $this->assertSame(['20:00' => 456], json_decode((string) DB::table('urt_video_live_log')->where('videoId', 'execute-live')->value('log_json'), true));
        Http::assertSentCount(2);
    }

    public function test_youtube_live_poll_preserves_legacy_minimum_batch_skip(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_live')->insert([
            $this->liveRow('one-live', 1, '2026-05-25 11:00:00'),
            $this->liveRow('two-live', 2, '2026-05-25 11:00:00'),
        ]);

        $exitCode = Artisan::call('youtube:live:poll', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertFalse($payload['would_call_api']);
        $this->assertSame('legacy exits before API call when fewer than 10 rows are selected and no videoId is provided', $payload['skip_reason']);
        $this->assertSame([], $payload['writes']);
    }

    public function test_youtube_live_poll_supports_legacy_single_video_bypass(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_video_live')->insert([
            $this->liveRow('target-live', 99, '2026-05-25 11:59:00', scheduledStartTime: '2026-05-25 12:30:00'),
            $this->liveRow('other-live', 100, '2026-05-25 11:00:00'),
        ]);

        $exitCode = Artisan::call('youtube:live:poll', [
            '--videoId' => 'target-live',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('single_video', $payload['source']);
        $this->assertSame('target-live', $payload['target_video_id']);
        $this->assertSame(1, $payload['eligible_rows']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertTrue($payload['would_call_api']);
        $this->assertNull($payload['skip_reason']);
        $this->assertSame('target-live', $payload['rows'][0]['video_id']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_live_poll_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_video_live')->insert($this->liveRow('one-live', 1, '2026-05-25 11:00:00'));

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.live.poll',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_show_video_live', 'urt_video_live_log', 'urt_video_live'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_video_live', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('publishedAt')->nullable();
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->dateTime('actualStartTime')->nullable();
            $table->dateTime('scheduledStartTime')->nullable();
            $table->integer('concurrentViewers')->nullable();
            $table->dateTime('actualEndTime')->nullable();
            $table->string('activeLiveChatId')->nullable();
            $table->integer('max_current')->nullable();
            $table->integer('del_flag')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->increments('pk');
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
            $table->longText('log_json')->nullable();
        });

        Schema::create('urt_show_video_live', function ($table): void {
            $table->string('videoId');
            $table->string('channelTitle')->nullable();
            $table->string('title')->nullable();
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function liveRow(
        string $videoId,
        int $uId,
        ?string $mtime,
        ?string $scheduledStartTime = null,
        ?string $actualEndTime = null,
        ?int $delFlag = null,
        int $concurrentViewers = 100,
        int $maxCurrent = 200,
    ): array {
        return [
            'ctime' => '2026-05-25 10:00:00',
            'mtime' => $mtime,
            'publishedAt' => '2026-05-25 09:00:00',
            'videoId' => $videoId,
            'u_id' => $uId,
            'actualStartTime' => '2026-05-25 10:30:00',
            'scheduledStartTime' => $scheduledStartTime,
            'concurrentViewers' => $concurrentViewers,
            'actualEndTime' => $actualEndTime,
            'activeLiveChatId' => 'chat-'.$videoId,
            'max_current' => $maxCurrent,
            'del_flag' => $delFlag,
        ];
    }
}
