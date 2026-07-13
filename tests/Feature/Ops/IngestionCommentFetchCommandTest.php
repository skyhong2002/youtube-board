<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionCommentFetchCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_youtube_comments_fetch_previews_queue_drain_plan(): void
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
        $this->assertSame('ingestion-preview', $payload['mode']);
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

    public function test_youtube_comments_fetch_preview_excludes_active_claims_and_recovers_stale_claims(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('ingestion.comment_claim_minutes', 30);
        $this->createTables();

        DB::table('urt_comment_queue')->insert([
            $this->queueRow(1, 'active-claim', '2026-05-25 10:00:00', '2026-05-25 11:45:00'),
            $this->queueRow(2, 'stale-claim', '2026-05-25 10:05:00', '2026-05-25 11:00:00'),
            $this->queueRow(3, 'unclaimed', '2026-05-25 10:10:00'),
        ]);

        $exitCode = Artisan::call('youtube:comments:fetch', ['--json' => true]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(3, $payload['queue_total']);
        $this->assertSame(1, $payload['active_claim_rows']);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame('2026-05-25 11:30:00', $payload['claim_expire_time']);
        $this->assertSame(['stale-claim', 'unclaimed'], array_column($payload['rows'], 'video_id'));
        $this->assertSame('stale_claim', $payload['rows'][0]['claim_status']);
        $this->assertSame('unclaimed', $payload['rows'][1]['claim_status']);
    }

    public function test_youtube_comments_fetch_execute_requires_api_key_before_upsert(): void
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

    public function test_youtube_comments_fetch_execute_refuses_command_overlap(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $lock = Cache::lock('ingestion:command:youtube.comments.fetch', 60);
        $this->assertTrue($lock->get());

        try {
            $exitCode = Artisan::call('youtube:comments:fetch', [
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertFalse($payload['available']);
            $this->assertSame('command_locked', $payload['blocked_reason']);
            $this->assertFalse($payload['lock']['acquired']);
        } finally {
            $lock->release();
        }

        Http::assertNothingSent();
    }

    public function test_youtube_comments_fetch_execute_parses_api_updates_comment_authors_and_moves_queue(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.retry_delay_ms', 0);
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

    public function test_youtube_comments_fetch_isolates_first_item_failure_and_sanitizes_error(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.comment_claim_minutes', 30);
        config()->set('services.youtube.retry_delay_ms', 0);
        $this->createTables();

        DB::table('urt_comment_queue')->insert([
            $this->queueRow(1, 'failing-comments', '2026-05-25 10:00:00', '2026-05-25 11:00:00'),
            $this->queueRow(2, 'successful-comments', '2026-05-25 10:05:00'),
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(10, 'failing-comments', 'Failing Comments'),
            $this->videoRow(11, 'successful-comments', 'Successful Comments'),
        ]);

        Http::fake(function ($request) {
            if ($request['videoId'] === 'failing-comments') {
                return Http::response([
                    'error' => ['message' => 'temporary failure token=super-secret-value'],
                ], 500);
            }

            return Http::response(['items' => []], 200);
        });

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--limit' => 2,
            '--max-pages' => 1,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(2, $payload['selected_rows']);
        $this->assertSame(2, $payload['claimed_rows']);
        $this->assertSame(2, $payload['api_attempted_videos']);
        $this->assertSame(1, $payload['api_called_videos']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['moved_to_done_rows']);
        $this->assertSame('failing-comments', $payload['failed'][0]['videoId']);
        $this->assertTrue($payload['failed'][0]['claim_released']);
        $this->assertStringContainsString('token=<redacted>', $payload['failed'][0]['error']);
        $this->assertStringNotContainsString('super-secret-value', $output);
        $this->assertSame('2026-05-25 11:00:00', DB::table('urt_comment_queue')->where('videoId', 'failing-comments')->value('stime'));
        $this->assertSame(0, DB::table('urt_comment_queue')->where('videoId', 'successful-comments')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->where('videoId', 'successful-comments')->count());
        $this->assertSame(1, DB::table('urt_comment')->where('videoId', 'successful-comments')->count());
        Http::assertSentCount(3);
    }

    public function test_youtube_comments_fetch_resumes_after_page_cap_before_completing_queue(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.retry_delay_ms', 0);
        $this->createTables();
        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'paged-comments', '2026-05-25 10:00:00'));
        DB::table('urt_video')->insert($this->videoRow(10, 'paged-comments', 'Paged Comments'));
        $requestedTokens = [];

        Http::fake(function ($request) use (&$requestedTokens) {
            $token = (string) ($request['pageToken'] ?? '');
            $requestedTokens[] = $token;
            $thread = $token === '' ? 'thread-first' : 'thread-second';
            $author = $token === '' ? 'author-first' : 'author-second';

            return Http::response([
                'nextPageToken' => $token === '' ? 'NEXT-PAGE' : null,
                'items' => [[
                    'id' => $thread,
                    'snippet' => [
                        'channelId' => 'channel-paged',
                        'topLevelComment' => [
                            'snippet' => [
                                'textDisplay' => $thread,
                                'textOriginal' => $thread,
                                'authorChannelId' => ['value' => $author],
                                'authorDisplayName' => $author,
                                'authorProfileImageUrl' => 'https://example.test/'.$author.'.jpg',
                                'authorChannelUrl' => 'https://youtube.test/'.$author,
                                'publishedAt' => $token === '' ? '2026-05-25T10:00:00Z' : '2026-05-25T09:00:00Z',
                                'updatedAt' => $token === '' ? '2026-05-25T10:00:00Z' : '2026-05-25T09:00:00Z',
                                'likeCount' => 1,
                            ],
                        ],
                    ],
                ]],
            ]);
        });

        $arguments = [
            '--execute' => true,
            '--videoId' => 'paged-comments',
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ];
        $firstExit = Artisan::call('youtube:comments:fetch', $arguments);
        $first = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExit);
        $this->assertSame(1, $first['continuation_rows']);
        $this->assertSame(0, $first['moved_to_done_rows']);
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
        $this->assertNull(DB::table('urt_comment_queue')->value('stime'));
        $this->assertSame('NEXT-PAGE', DB::table('urt_comment')->where('videoId', 'paged-comments')->value('pageToken'));

        $secondExit = Artisan::call('youtube:comments:fetch', $arguments);
        $second = json_decode(trim(Artisan::output()), true);
        $comment = DB::table('urt_comment')->where('videoId', 'paged-comments')->first();
        $comments = json_decode((string) $comment->comments_json, true);

        $this->assertSame(0, $secondExit);
        $this->assertSame(['', 'NEXT-PAGE'], $requestedTokens);
        $this->assertSame(0, $second['continuation_rows']);
        $this->assertSame(1, $second['moved_to_done_rows']);
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->count());
        $this->assertSame('', (string) $comment->pageToken);
        $this->assertSame(2, (int) $comment->comments_count);
        $this->assertSame(['thread-first', 'thread-second'], array_keys($comments));
        Http::assertSentCount(2);
    }

    public function test_youtube_comments_fetch_paginates_full_reply_list_before_completion(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'reply-comments', '2026-05-25 10:00:00'));
        DB::table('urt_video')->insert($this->videoRow(10, 'reply-comments', 'Reply Comments'));

        Http::fake(function ($request) {
            if (str_contains($request->url(), '/commentThreads')) {
                return Http::response([
                    'items' => [[
                        'id' => 'thread-1',
                        'snippet' => [
                            'channelId' => 'channel-replies',
                            'totalReplyCount' => 2,
                            'topLevelComment' => ['snippet' => $this->commentSnippet('author-top', 'Top', '2026-05-25T10:00:00Z')],
                        ],
                        'replies' => [
                            'comments' => [[
                                'id' => 'reply-embedded',
                                'snippet' => $this->commentSnippet('author-reply-1', 'Embedded', '2026-05-25T09:00:00Z'),
                            ]],
                        ],
                    ]],
                ]);
            }

            $this->assertSame('thread-1', $request['parentId']);

            return Http::response([
                'items' => [
                    ['id' => 'reply-1', 'snippet' => $this->commentSnippet('author-reply-1', 'Reply one', '2026-05-25T09:00:00Z')],
                    ['id' => 'reply-2', 'snippet' => $this->commentSnippet('author-reply-2', 'Reply two', '2026-05-25T08:00:00Z')],
                ],
            ]);
        });

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'reply-comments',
            '--max-pages' => 1,
            '--max-reply-pages' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);
        $comment = DB::table('urt_comment')->where('videoId', 'reply-comments')->first();
        $comments = json_decode((string) $comment->comments_json, true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['reply_pages_fetched']);
        $this->assertSame(3, (int) $comment->comments_count);
        $this->assertSame(2, (int) $comment->replies_count);
        $this->assertSame(['reply-1', 'reply-2'], array_keys($comments['thread-1']['replies']));
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->count());
        Http::assertSentCount(2);
    }

    public function test_youtube_comments_fetch_keeps_queue_when_reply_page_cap_is_incomplete(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'reply-cap', '2026-05-25 10:00:00'));
        DB::table('urt_video')->insert($this->videoRow(10, 'reply-cap', 'Reply Cap'));
        Http::fakeSequence()
            ->push([
                'items' => [[
                    'id' => 'thread-cap',
                    'snippet' => [
                        'channelId' => 'channel-replies',
                        'totalReplyCount' => 2,
                        'topLevelComment' => ['snippet' => $this->commentSnippet('author-top', 'Top', '2026-05-25T10:00:00Z')],
                    ],
                ]],
            ])
            ->push([
                'nextPageToken' => 'MORE-REPLIES',
                'items' => [[
                    'id' => 'reply-1',
                    'snippet' => $this->commentSnippet('author-reply-1', 'Reply one', '2026-05-25T09:00:00Z'),
                ]],
            ]);

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'reply-cap',
            '--max-pages' => 1,
            '--max-reply-pages' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertStringContainsString('reply_page_cap_reached', $payload['failed'][0]['error']);
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
        $this->assertNull(DB::table('urt_comment_queue')->value('stime'));
        $this->assertSame(0, DB::table('urt_comment_queue_done')->count());
        $this->assertSame(0, DB::table('urt_comment')->count());
        Http::assertSentCount(2);
    }

    public function test_youtube_comments_fetch_fresh_crawl_replaces_deleted_comments_and_authors(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'fresh-replace', '2026-05-25 10:00:00'));
        DB::table('urt_video')->insert($this->videoRow(10, 'fresh-replace', 'Fresh Replace'));
        DB::table('urt_comment')->insert([
            ...$this->commentRow('fresh-replace', '2026-05-25 08:00:00', 1, 1),
            'authors_json' => json_encode(['deleted-author' => ['DisplayName' => 'Deleted Author']]),
            'comments_json' => json_encode([
                'deleted-thread' => [
                    'textOriginal' => 'Deleted comment',
                    'authorChannelId' => 'deleted-author',
                    'replies' => [],
                ],
            ]),
        ]);
        Http::fake([
            '*' => Http::response([
                'items' => [[
                    'id' => 'current-thread',
                    'snippet' => [
                        'channelId' => 'current-channel',
                        'topLevelComment' => [
                            'snippet' => $this->commentSnippet('current-author', 'Current comment', '2026-05-25T10:00:00Z'),
                        ],
                    ],
                ]],
            ]),
        ]);

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'fresh-replace',
            '--limit' => 1,
            '--max-pages' => 1,
            '--json' => true,
        ]);
        $comment = DB::table('urt_comment')->where('videoId', 'fresh-replace')->first();
        $comments = json_decode((string) $comment->comments_json, true);
        $authors = json_decode((string) $comment->authors_json, true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['current-thread'], array_keys($comments));
        $this->assertSame(['current-author'], array_keys($authors));
        $this->assertArrayNotHasKey('deleted-thread', $comments);
        $this->assertArrayNotHasKey('deleted-author', $authors);
        $this->assertSame(1, (int) $comment->comments_count);
    }

    public function test_youtube_comments_fetch_renews_claim_between_pages(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'renew-claim', '2026-05-25 10:00:00'));
        DB::table('urt_video')->insert($this->videoRow(10, 'renew-claim', 'Renew Claim'));
        $observedClaims = [];
        $attempt = 0;
        Http::fake(function () use (&$attempt, &$observedClaims) {
            $attempt++;
            $observedClaims[] = DB::table('urt_comment_queue')->where('videoId', 'renew-claim')->value('stime');

            if ($attempt === 1) {
                CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:20:00', 'Asia/Taipei'));

                return Http::response(['items' => [], 'nextPageToken' => 'NEXT']);
            }

            return Http::response(['items' => []]);
        });

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--videoId' => 'renew-claim',
            '--limit' => 1,
            '--max-pages' => 2,
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['2026-05-25 12:00:00', '2026-05-25 12:20:00'], $observedClaims);
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
    }

    public function test_youtube_comments_fetch_claims_each_later_row_at_its_actual_start_time(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        config()->set('services.youtube.api_key', 'test-key');
        $this->createTables();
        DB::table('urt_comment_queue')->insert([
            $this->queueRow(1, 'claim-first', '2026-05-25 10:00:00'),
            $this->queueRow(2, 'claim-second', '2026-05-25 10:01:00'),
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(10, 'claim-first', 'Claim First'),
            $this->videoRow(11, 'claim-second', 'Claim Second'),
        ]);
        $secondClaim = null;
        Http::fake(function ($request) use (&$secondClaim) {
            if ($request['videoId'] === 'claim-first') {
                CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:40:00', 'Asia/Taipei'));

                return Http::response(['items' => []]);
            }

            $secondClaim = DB::table('urt_comment_queue')->where('videoId', 'claim-second')->value('stime');

            return Http::response(['items' => []]);
        });

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--limit' => 2,
            '--max-pages' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertSame('2026-05-25 12:40:00', $secondClaim);
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

    public function test_ingestion_scheduler_can_execute_ingestion_comment_fetch_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        DB::table('urt_comment_queue')->insert($this->queueRow(1, 'queued-video', '2026-05-25 04:00:00'));

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.comments.fetch',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
        $this->assertSame(1, DB::table('urt_comment_queue')->count());
        $this->assertSame(0, DB::table('urt_comment_queue_done')->count());
    }

    public function test_ingestion_scheduler_executes_allowlisted_comment_fetch_command_when_due(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'));
        $this->createTables(withAuthors: true);
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.retry_delay_ms', 0);
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.comments.fetch']);
        config()->set('services.youtube.retry_delay_ms', 0);

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
        $this->assertSame('youtube:comments:fetch --execute --limit=5 --max-pages=1 --max-reply-pages=20', $result['jobs'][0]['effective_command']);
        $this->assertStringContainsString('moved_to_done_rows=1', $result['jobs'][0]['output']);
        $this->assertSame(0, DB::table('urt_comment_queue')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->where('videoId', 'scheduled-comments')->count());
        $this->assertSame(1, DB::table('urt_comment')->where('videoId', 'scheduled-comments')->count());
    }

    public function test_ingestion_scheduler_records_partial_comment_failure_after_finishing_batch(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'));
        $this->createTables();
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.comments.fetch']);

        DB::table('urt_comment_queue')->insert([
            $this->queueRow(1, 'scheduled-failure', '2026-05-25 04:00:00'),
            $this->queueRow(2, 'scheduled-success', '2026-05-25 04:01:00'),
        ]);
        DB::table('urt_video')->insert([
            $this->videoRow(10, 'scheduled-failure', 'Scheduled Failure'),
            $this->videoRow(11, 'scheduled-success', 'Scheduled Success'),
        ]);

        Http::fake(function ($request) {
            if ($request['videoId'] === 'scheduled-failure') {
                return Http::response([
                    'error' => ['message' => 'temporary failure token=scheduler-secret'],
                ], 500);
            }

            return Http::response(['items' => []], 200);
        });

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 05:05:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.comments.fetch',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 0, 'failed' => 1], $result['summary']);
        $this->assertSame('failed', $result['jobs'][0]['action']);
        $this->assertSame(1, $result['jobs'][0]['exit_code']);
        $this->assertStringContainsString('selected_rows=2', $result['jobs'][0]['output']);
        $this->assertStringContainsString('moved_to_done_rows=1', $result['jobs'][0]['output']);
        $this->assertStringContainsString('failed_rows=1', $result['jobs'][0]['output']);
        $this->assertStringContainsString('failed videoId=scheduled-failure', $result['jobs'][0]['output']);
        $this->assertStringNotContainsString('scheduler-secret', $result['jobs'][0]['output']);
        $this->assertNull(DB::table('urt_comment_queue')->where('videoId', 'scheduled-failure')->value('stime'));
        $this->assertSame(1, DB::table('urt_comment_queue')->where('videoId', 'scheduled-failure')->count());
        $this->assertSame(1, DB::table('urt_comment_queue_done')->where('videoId', 'scheduled-success')->count());
        $this->assertSame(1, DB::table('urt_comment')->where('videoId', 'scheduled-success')->count());
        Http::assertSentCount(3);
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
    private function commentSnippet(string $authorId, string $text, string $publishedAt): array
    {
        return [
            'textDisplay' => $text,
            'textOriginal' => $text,
            'authorChannelId' => ['value' => $authorId],
            'authorDisplayName' => $authorId,
            'authorProfileImageUrl' => 'https://example.test/'.$authorId.'.jpg',
            'authorChannelUrl' => 'https://youtube.test/'.$authorId,
            'publishedAt' => $publishedAt,
            'updatedAt' => $publishedAt,
            'likeCount' => 1,
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
