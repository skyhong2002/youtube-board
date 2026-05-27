<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
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
        Http::preventStrayRequests();
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

    public function test_youtube_comments_fetch_execute_requires_api_key_and_does_not_write_when_missing(): void
    {
        Http::preventStrayRequests();
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', null);
        $this->createTables();

        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'missing-key-comments', '2026-05-25 10:00:00'));

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'missing-key-comments',
            '--limit' => 1,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('YOUTUBE_API_KEY is not configured', $output, $output);
        $this->assertStringContainsString('secrets=not_printed', $output, $output);
        $this->assertNull(DB::table('urt_comment_queue')->where('videoId', 'missing-key-comments')->value('stime'));
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
        $this->assertSame(0, DB::table('urt_comment_queue_done')->count());
        $this->assertSame(0, DB::table('urt_comment')->count());
    }

    public function test_youtube_comments_fetch_execute_parses_api_updates_comment_authors_and_moves_queue(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables(withAuthors: true);

        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'execute-comments', '2026-05-25 10:00:00'));
        DB::table('urt_video')->insert($this->videoRow(99, 'execute-comments', 'Execute Comments Video'));
        DB::table('urt_channel')->insert([
            'u_id' => 99,
            'youtube_id' => 'channel-from-comment-api',
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/commentThreads*' => Http::response([
                'items' => [
                    [
                        'id' => 'thread-1',
                        'snippet' => [
                            'channelId' => 'channel-from-comment-api',
                            'topLevelComment' => [
                                'snippet' => [
                                    'textDisplay' => 'Top display',
                                    'textOriginal' => 'Top original',
                                    'authorChannelId' => ['value' => 'author-top'],
                                    'authorDisplayName' => 'Top Author',
                                    'authorProfileImageUrl' => 'https://example.test/top.jpg',
                                    'authorChannelUrl' => 'https://youtube.test/top',
                                    'publishedAt' => '2026-05-25T03:00:00Z',
                                    'updatedAt' => '2026-05-25T03:05:00Z',
                                    'likeCount' => 7,
                                ],
                            ],
                        ],
                        'replies' => [
                            'comments' => [
                                [
                                    'id' => 'reply-1',
                                    'snippet' => [
                                        'textDisplay' => 'Reply display',
                                        'textOriginal' => 'Reply original',
                                        'authorChannelId' => ['value' => 'author-reply'],
                                        'authorDisplayName' => 'Reply Author',
                                        'authorProfileImageUrl' => 'https://example.test/reply.jpg',
                                        'authorChannelUrl' => 'https://youtube.test/reply',
                                        'publishedAt' => '2026-05-25T03:10:00Z',
                                        'updatedAt' => '2026-05-25T03:11:00Z',
                                        'likeCount' => 2,
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ], 200),
        ]);

        $firstExitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'execute-comments',
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('local-execute', $firstPayload['mode']);
        $this->assertSame(1, $firstPayload['api_called_videos']);
        $this->assertSame(1, $firstPayload['moved_to_done_rows']);
        $this->assertContains('urt_comment.comments_json', $firstPayload['write_targets']);
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->where('videoId', 'execute-comments')->count());
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_comment_queue_done')->where('videoId', 'execute-comments')->value('stime'));
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_comment_queue_done')->where('videoId', 'execute-comments')->value('ftime'));

        $comment = DB::table('urt_comment')->where('videoId', 'execute-comments')->first();
        $this->assertIsObject($comment);
        $this->assertSame(2, (int) $comment->comments_count);
        $this->assertSame(1, (int) $comment->threads_count);
        $this->assertSame(1, (int) $comment->replies_count);
        $this->assertSame(2, (int) $comment->authors_count);
        $this->assertSame(9, (int) $comment->likes_count);
        $this->assertSame('2026-05-25 11:10:00', (string) $comment->latest_time);
        $this->assertSame('channel-from-comment-api', (string) $comment->channelId);
        $this->assertSame(99, (int) $comment->u_id);

        $commentsJson = json_decode((string) $comment->comments_json, true);
        $authorsJson = json_decode((string) $comment->authors_json, true);
        $this->assertSame('Top original', $commentsJson['thread-1']['textOriginal']);
        $this->assertSame('Reply original', $commentsJson['thread-1']['replies']['reply-1']['textOriginal']);
        $this->assertSame('Top Author', $authorsJson['author-top']['DisplayName']);
        $this->assertSame(2, DB::table('urt_comment_author')->count());
        $this->assertSame(2, DB::table('urt_comment_rev')->count());
        $this->assertSame(['execute-comments'], json_decode((string) DB::table('urt_comment_rev')->where('author_id', 1)->value('index_json'), true));

        DB::table('urt_comment_queue')->insert($this->queueRow(2, 'execute-comments', '2026-05-25 12:30:00'));
        $secondExitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'execute-comments',
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(2, DB::table('urt_comment_author')->count());
        $this->assertSame(2, DB::table('urt_comment_rev')->count());
        $this->assertSame(2, DB::table('urt_comment_queue_done')->where('videoId', 'execute-comments')->count());
        Http::assertSentCount(1);
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

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:read-only-guardrail', $result['jobs'][0]['action']);
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
        $this->assertSame(0, DB::table('urt_comment_queue_done')->count());
    }

    public function test_ingestion_scheduler_executes_allowlisted_comment_fetch_command_when_due(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'));
        $this->createTables(withAuthors: true);
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.comments.fetch']);

        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'scheduled-comments', '2026-05-25 04:00:00'));
        DB::table('urt_video')->insert($this->videoRow(99, 'scheduled-comments', 'Scheduled Comments Video'));
        DB::table('urt_channel')->insert([
            'u_id' => 99,
            'youtube_id' => 'channel-from-comment-api',
        ]);

        Http::fake([
            'www.googleapis.com/youtube/v3/commentThreads*' => Http::response([
                'items' => [
                    [
                        'id' => 'thread-1',
                        'snippet' => [
                            'channelId' => 'channel-from-comment-api',
                            'topLevelComment' => [
                                'snippet' => [
                                    'textDisplay' => 'Top display',
                                    'textOriginal' => 'Top original',
                                    'authorChannelId' => ['value' => 'author-top'],
                                    'authorDisplayName' => 'Top Author',
                                    'authorProfileImageUrl' => 'https://example.test/top.jpg',
                                    'authorChannelUrl' => 'https://youtube.test/top',
                                    'publishedAt' => '2026-05-25T03:00:00Z',
                                    'updatedAt' => '2026-05-25T03:05:00Z',
                                    'likeCount' => 7,
                                ],
                            ],
                        ],
                    ],
                ],
            ], 200),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.comments.fetch',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
        $this->assertSame('youtube:comments:fetch --execute --limit=5 --max-pages=1', $result['jobs'][0]['effective_command']);
        $this->assertStringContainsString('moved_to_done_rows=1', $result['jobs'][0]['output']);
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->where('videoId', 'scheduled-comments')->count());
        $this->assertSame(1, DB::table('urt_comment')->where('videoId', 'scheduled-comments')->count());
    }

    private function createTables(bool $withAuthors = false): void
    {
        foreach (['urt_comment_queue_done', 'urt_comment_queue', 'urt_comment_rev', 'urt_comment_author', 'urt_channel', 'urt_comment', 'urt_video'] as $table) {
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
            $table->dateTime('stime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('comments_count')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->integer('likes_count')->nullable();
            $table->integer('threads_count')->nullable();
            $table->integer('replies_count')->nullable();
            $table->integer('authors_count')->nullable();
            $table->string('pageToken')->nullable();
            $table->string('channelId')->nullable();
            $table->integer('u_id')->nullable();
            $table->text('authors_json')->nullable();
            $table->text('comments_json')->nullable();
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

        if ($withAuthors) {
            Schema::create('urt_channel', function ($table): void {
                $table->integer('u_id');
                $table->string('youtube_id');
            });

            Schema::create('urt_comment_author', function ($table): void {
                $table->increments('author_id');
                $table->dateTime('ctime');
                $table->dateTime('mtime')->nullable();
                $table->string('ChannelId');
                $table->string('ChannelUrl')->nullable();
                $table->string('ImageUrl')->nullable();
                $table->string('DisplayName')->nullable();
            });

            Schema::create('urt_comment_rev', function ($table): void {
                $table->integer('author_id');
                $table->dateTime('ctime');
                $table->dateTime('mtime')->nullable();
                $table->integer('comments')->nullable();
                $table->integer('videos')->nullable();
                $table->text('index_json')->nullable();
            });
        }
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
            'likes_count' => 0,
            'threads_count' => $comments,
            'replies_count' => 0,
            'authors_count' => $authors,
            'pageToken' => '',
            'channelId' => 'channel-'.$videoId,
            'u_id' => 10,
            'authors_json' => null,
            'comments_json' => null,
        ];
    }
}
