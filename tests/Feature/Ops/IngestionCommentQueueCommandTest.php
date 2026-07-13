<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionCommentQueueCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_comments_queue_previews_legacy_candidates_through_ingestion_lookuping_queue_rows(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[1],[13]'],
            ['u_id' => 2, 'tags' => '[2]'],
            ['u_id' => 3, 'tags' => '[9]'],
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(1, 'would-queue', '2026-05-25 11:00:00', 1200, 650, 'Would Queue'),
            $this->videoRow(1, 'low-comments', '2026-05-25 11:10:00', 1200, 499, 'Low Comments'),
            $this->videoRow(2, 'already-queued', '2026-05-25 11:20:00', 1600, 800, 'Already Queued'),
            $this->videoRow(2, 'low-views', '2026-05-25 11:30:00', 499, 900, 'Low Views'),
            $this->videoRow(2, 'too-old', '2026-05-23 11:00:00', 2000, 900, 'Too Old'),
            $this->videoRow(3, 'excluded-tag', '2026-05-25 11:00:00', 2000, 900, 'Excluded Tag'),
        ]);
        DB::table('urt_comment_queue')->insert([
            'ctime' => '2026-05-25 11:30:00',
            'stime' => null,
            'ftime' => null,
            'videoId' => 'already-queued',
        ]);
        DB::table('urt_comment_queue_done')->insert([
            'pk' => 100,
            'ctime' => '2026-05-25 10:00:00',
            'stime' => '2026-05-25 10:01:00',
            'ftime' => '2026-05-25 10:02:00',
            'videoId' => 'would-queue',
        ]);

        $exitCode = Artisan::call('youtube:comments:queue', [
            '--or' => '1,2,9',
            '--not' => '9',
            '--hours' => 24,
            '--min' => 500,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame([1, 2, 9], $payload['filters']['or']);
        $this->assertSame([9], $payload['filters']['not']);
        $this->assertSame('2026-05-24 12:00:00', $payload['published_after']);
        $this->assertSame(2, $payload['matching_channels']);
        $this->assertSame(3, $payload['recent_video_rows']);
        $this->assertSame(2, $payload['comment_threshold_rows']);
        $this->assertSame(1, $payload['already_queued_rows']);
        $this->assertSame(1, $payload['already_done_rows']);
        $this->assertSame(1, $payload['would_insert_queue_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('would-queue', $payload['rows'][0]['video_id']);
        $this->assertTrue($payload['rows'][0]['already_done']);
        $this->assertFalse($payload['rows'][0]['already_queued']);
        $this->assertTrue($payload['rows'][0]['would_insert_queue']);
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
    }

    public function test_youtube_comments_queue_execute_inserts_local_queue_rows_idempotently(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[1]'],
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(1, 'queue-execute', '2026-05-25 11:00:00', 1200, 650, 'Queue Execute'),
        ]);

        $firstExitCode = Artisan::call('youtube:comments:queue', [
            '--or' => '1',
            '--hours' => 24,
            '--min' => 500,
            '--limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['inserted_queue_rows']);
        $this->assertContains('urt_comment_queue.videoId', $firstPayload['write_targets']);
        $this->assertSame(1, DB::table('urt_comment_queue')->where('videoId', 'queue-execute')->count());
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_comment_queue')->where('videoId', 'queue-execute')->value('ctime'));

        $secondExitCode = Artisan::call('youtube:comments:queue', [
            '--or' => '1',
            '--hours' => 24,
            '--min' => 500,
            '--limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $secondPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(0, $secondPayload['inserted_queue_rows']);
        $this->assertSame(1, DB::table('urt_comment_queue')->where('videoId', 'queue-execute')->count());
    }

    public function test_comment_queue_execute_isolates_a_failed_video_and_sanitizes_the_warning(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        Log::spy();

        DB::table('urt_count')->insert(['u_id' => 1, 'tags' => '[1]']);
        DB::table('urt_video')->insert([
            $this->videoRow(1, 'a-fail', '2026-05-25 11:30:00', 1200, 700, 'Failing Queue Video'),
            $this->videoRow(1, 'b-success', '2026-05-25 11:00:00', 1200, 700, 'Successful Queue Video'),
        ]);
        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_comment_queue
BEFORE INSERT ON urt_comment_queue
WHEN NEW.videoId = 'a-fail'
BEGIN
    SELECT RAISE(FAIL, 'token=super-secret');
END
SQL);

        $exitCode = Artisan::call('youtube:comments:queue', [
            '--or' => '1',
            '--min' => 500,
            '--hours' => 24,
            '--limit' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['inserted_queue_rows']);
        $this->assertSame(['videoId' => 'a-fail', 'reason' => 'item_processing_failed'], $payload['skipped'][0]);
        $this->assertStringNotContainsString('super-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertSame(0, DB::table('urt_comment_queue')->where('videoId', 'a-fail')->count());
        $this->assertSame(1, DB::table('urt_comment_queue')->where('videoId', 'b-success')->count());
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Comment queue item processing failed.'
                    && $context['video_id'] === 'a-fail'
                    && $context['reason'] === 'item_processing_failed'
                    && is_string($context['exception_class'])
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'super-secret');
            });
    }

    public function test_youtube_comments_queue_supports_legacy_and_tagid_filter(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[1],[13]'],
            ['u_id' => 2, 'tags' => '[1]'],
            ['u_id' => 3, 'tags' => '[13]'],
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(1, 'both-tags', '2026-05-25 11:00:00', 1200, 650, 'Both Tags'),
            $this->videoRow(2, 'only-one', '2026-05-25 11:00:00', 1200, 650, 'Only One'),
            $this->videoRow(3, 'only-thirteen', '2026-05-25 11:00:00', 1200, 650, 'Only Thirteen'),
        ]);

        $exitCode = Artisan::call('youtube:comments:queue', [
            '--tagid' => '1,13',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame([1, 13], $payload['filters']['tagid']);
        $this->assertSame(1, $payload['matching_channels']);
        $this->assertSame(1, $payload['would_insert_queue_rows']);
        $this->assertSame('both-tags', $payload['rows'][0]['video_id']);
    }

    public function test_ingestion_scheduler_can_execute_ingestion_comment_queue_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[1]'],
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(1, 'default-comment-candidate', '2026-05-25 03:00:00', 1200, 700, 'Default Candidate'),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 04:23:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.comments.queue',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
    }

    private function createTables(): void
    {
        foreach (['urt_comment_queue_done', 'urt_comment_queue', 'urt_video', 'urt_count'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_comment_queue', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('stime')->nullable();
            $table->dateTime('ftime')->nullable();
            $table->string('videoId');
        });

        Schema::create('urt_comment_queue_done', function ($table): void {
            $table->integer('pk');
            $table->dateTime('ctime');
            $table->dateTime('stime')->nullable();
            $table->dateTime('ftime')->nullable();
            $table->string('videoId');
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function videoRow(int $uId, string $videoId, string $publishedAt, int $views, int $comments, string $title): array
    {
        return [
            'u_id' => $uId,
            'videoId' => $videoId,
            'publishedAt' => $publishedAt,
            'title' => $title,
            'channelTitle' => 'Channel '.$uId,
            'viewCount' => $views,
            'commentCount' => $comments,
        ];
    }
}
