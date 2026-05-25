<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyCommentFetchCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_comments_fetch_previews_queue_drain_without_api_or_queue_moves(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_comment_queue')->insert([
            $this->queueRow(1, 'missing-comment', '2026-05-25 10:00:00'),
            $this->queueRow(2, 'recent-comment', '2026-05-25 10:05:00', '2026-05-25 10:06:00'),
            $this->queueRow(3, 'stale-comment', '2026-05-25 10:10:00'),
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(10, 'missing-comment', 'Missing Comment Video'),
            $this->videoRow(11, 'recent-comment', 'Recent Comment Video'),
            $this->videoRow(12, 'stale-comment', 'Stale Comment Video'),
        ]);
        DB::table('urt_comment')->insert([
            $this->commentRow('recent-comment', '2026-05-25 10:30:00', 25, 9),
            $this->commentRow('stale-comment', '2026-05-25 08:30:00', 40, 15),
        ]);
        DB::table('urt_comment_queue_done')->insert([
            'pk' => 50,
            'ctime' => '2026-05-25 09:00:00',
            'stime' => '2026-05-25 09:01:00',
            'ftime' => '2026-05-25 09:02:00',
            'videoId' => 'stale-comment',
        ]);

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('comment_queue_drain', $payload['source']);
        $this->assertSame('2026-05-25 09:00:00', $payload['refresh_expire_time']);
        $this->assertSame(3, $payload['queue_total']);
        $this->assertSame(1, $payload['queue_done_total']);
        $this->assertSame(3, $payload['selected_rows']);
        $this->assertSame(2, $payload['existing_comment_rows']);
        $this->assertSame(1, $payload['already_done_rows']);
        $this->assertSame(1, $payload['recent_comment_cache_rows']);
        $this->assertSame(1, $payload['would_insert_comment_rows']);
        $this->assertSame(3, $payload['would_call_get_comment']);
        $this->assertSame(2, $payload['would_call_comment_threads']);
        $this->assertSame(3, $payload['would_move_to_done_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertContains('urt_comment_queue delete', $payload['writes_skipped']);

        $this->assertSame('missing-comment', $payload['rows'][0]['video_id']);
        $this->assertFalse($payload['rows'][0]['existing_comment_row']);
        $this->assertTrue($payload['rows'][0]['would_call_comment_threads']);
        $this->assertSame('recent-comment', $payload['rows'][1]['video_id']);
        $this->assertTrue($payload['rows'][1]['would_skip_api_recent_cache']);
        $this->assertFalse($payload['rows'][1]['would_call_comment_threads']);
        $this->assertSame('stale-comment', $payload['rows'][2]['video_id']);
        $this->assertTrue($payload['rows'][2]['already_in_done']);

        $this->assertSame(3, DB::table('urt_comment_queue')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->count());
        $this->assertSame(2, DB::table('urt_comment')->count());
    }

    public function test_youtube_comments_fetch_supports_single_queued_video_preview(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_comment_queue')->insert([
            $this->queueRow(1, 'target-video', '2026-05-25 10:00:00'),
            $this->queueRow(2, 'other-video', '2026-05-25 10:05:00'),
        ]);

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--videoId' => 'target-video',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('target-video', $payload['target_video_id']);
        $this->assertSame(2, $payload['queue_total']);
        $this->assertSame(1, $payload['selected_rows']);
        $this->assertSame('target-video', $payload['rows'][0]['video_id']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_comment_fetch_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'queued-video', '2026-05-25 04:00:00'));

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.comments.fetch',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
        $this->assertSame(0, DB::table('urt_comment_queue_done')->count());
    }

    private function createTables(): void
    {
        foreach (['urt_comment_queue_done', 'urt_comment_queue', 'urt_comment', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_comment_queue', function ($table): void {
            $table->integer('pk');
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

        Schema::create('urt_comment', function ($table): void {
            $table->increments('pk');
            $table->string('videoId');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->integer('authors_count')->nullable();
            $table->string('pageToken')->nullable();
            $table->string('channelId')->nullable();
            $table->integer('u_id')->nullable();
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
    }

    /**
     * @return array<string, mixed>
     */
    private function queueRow(int $pk, string $videoId, string $ctime, ?string $stime = null, ?string $ftime = null): array
    {
        return [
            'pk' => $pk,
            'ctime' => $ctime,
            'stime' => $stime,
            'ftime' => $ftime,
            'videoId' => $videoId,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function videoRow(int $uId, string $videoId, string $title): array
    {
        return [
            'u_id' => $uId,
            'videoId' => $videoId,
            'publishedAt' => '2026-05-25 09:00:00',
            'title' => $title,
            'channelTitle' => 'Channel '.$uId,
            'viewCount' => 1200,
            'commentCount' => 650,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function commentRow(string $videoId, string $mtime, int $comments, int $authors): array
    {
        return [
            'videoId' => $videoId,
            'ctime' => '2026-05-25 09:00:00',
            'mtime' => $mtime,
            'comments_count' => $comments,
            'latest_time' => '2026-05-25 09:30:00',
            'authors_count' => $authors,
            'pageToken' => '',
            'channelId' => 'channel-'.$videoId,
            'u_id' => 10,
        ];
    }
}
