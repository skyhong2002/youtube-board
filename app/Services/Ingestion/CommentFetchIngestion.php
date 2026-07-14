<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use JsonException;
use RuntimeException;
use Throwable;

class CommentFetchIngestion
{
    public function __construct(
        private readonly CommentFetchPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(?string $videoId = null, int $limit = 1, int $maxPages = 1, int $maxReplyPages = 20, ?CarbonInterface $now = null): array
    {
        $lockSeconds = max(60, min(86400, (int) config('ingestion.job_lock_seconds', 14400)));
        $lock = Cache::lock('ingestion:command:youtube.comments.fetch', $lockSeconds);

        if (! $lock->get()) {
            return [
                'mode' => 'local-execute',
                'available' => false,
                'blocked_reason' => 'command_locked',
                'selected_rows' => 0,
                'claimed_rows' => 0,
                'api_called_videos' => 0,
                'api_attempted_videos' => 0,
                'moved_to_done_rows' => 0,
                'continuation_rows' => 0,
                'skipped_rows' => 0,
                'failed_rows' => 0,
                'exit_code' => 1,
                'write_targets' => [],
                'external_calls' => [],
                'applied' => [],
                'skipped' => [],
                'failed' => [],
                'secrets' => 'not printed',
                'lock' => [
                    'key' => 'ingestion:command:youtube.comments.fetch',
                    'acquired' => false,
                    'ttl_seconds' => $lockSeconds,
                ],
            ];
        }

        try {
            return $this->executeUnlocked($videoId, $limit, $maxPages, $maxReplyPages, $now);
        } finally {
            try {
                $lock->release();
            } catch (Throwable) {
                // An expired lock must not hide the completed batch result.
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function executeUnlocked(?string $videoId, int $limit, int $maxPages, int $maxReplyPages, ?CarbonInterface $now): array
    {
        foreach (['urt_comment_queue', 'urt_comment_queue_done', 'urt_comment'] as $table) {
            if (! Schema::hasTable($table)) {
                throw new RuntimeException("Missing local table: {$table}");
            }
        }

        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(10, $limit));
        $maxPages = max(1, min(3, $maxPages));
        $maxReplyPages = max(1, min(100, $maxReplyPages));
        $preview = $this->preview->preview(videoId: $videoId, limit: $limit, now: $now);
        $rows = collect($preview['rows'] ?? [])->take($limit)->values();
        $applied = [];
        $skipped = [];
        $failed = [];
        $claimedRows = 0;
        $claimMinutes = max(1, min(1440, (int) config('ingestion.comment_claim_minutes', 30)));

        foreach ($rows as $row) {
            $queuePk = $row['pk'] !== null ? (int) $row['pk'] : null;
            $rowVideoId = trim((string) ($row['video_id'] ?? ''));

            if ($queuePk === null || $rowVideoId === '') {
                $skipped[] = ['videoId' => $rowVideoId, 'reason' => 'missing_queue_pk_or_video_id'];

                continue;
            }

            $claimed = false;
            $apiCalled = false;
            $rowNow = CarbonImmutable::now($timezone);
            $claimExpireTime = $rowNow->subMinutes($claimMinutes);
            $claimTime = $rowNow->format('Y-m-d H:i:s');

            try {
                $claimed = $this->claimQueueRow($queuePk, $claimTime, $claimExpireTime);

                if (! $claimed) {
                    $skipped[] = [
                        'videoId' => $rowVideoId,
                        'reason' => 'claim_not_acquired',
                    ];

                    continue;
                }

                $claimedRows++;

                if ((bool) ($row['would_skip_api_recent_cache'] ?? false)) {
                    DB::transaction(fn () => $this->finishQueueRow($queuePk, $rowNow));
                    $applied[] = [
                        'videoId' => $rowVideoId,
                        'apiCalled' => false,
                        'reason' => 'recent_cache',
                        'commentsCount' => $row['comments_count'] ?? null,
                        'authorsCount' => $row['authors_count'] ?? null,
                    ];

                    continue;
                }

                $apiCalled = true;
                $renewClaim = function () use ($queuePk, $timezone, &$claimTime): void {
                    $claimTime = $this->renewQueueClaim($queuePk, $claimTime, $timezone);
                };
                $fetched = $this->fetchCommentThreads($rowVideoId, $maxPages, $maxReplyPages, $renewClaim);
                $complete = trim((string) ($fetched['pageToken'] ?? '')) === '';

                DB::transaction(function () use ($queuePk, $rowVideoId, $fetched, $rowNow, $complete): void {
                    $this->upsertCommentPayload($rowVideoId, $fetched, $rowNow, publishAuthors: $complete);

                    if ($complete) {
                        $this->finishQueueRow($queuePk, $rowNow);
                    }
                });

                $claimReleased = $complete || $this->releaseQueueClaim(
                    queuePk: $queuePk,
                    claimTime: $claimTime,
                    previousClaimTime: is_string($row['queue_stime'] ?? null) ? $row['queue_stime'] : null,
                );

                $applied[] = [
                    'videoId' => $rowVideoId,
                    'apiCalled' => true,
                    'complete' => $complete,
                    'publication_status' => $complete ? 'published' : 'staged',
                    'claim_released' => $claimReleased,
                    'continuation_pending' => ! $complete,
                    'pagesFetched' => $fetched['pagesFetched'],
                    'replyPagesFetched' => $fetched['replyPagesFetched'],
                    'threadsCount' => $fetched['threadsCount'],
                    'repliesCount' => $fetched['repliesCount'],
                    'commentsCount' => $fetched['commentsCount'],
                    'authorsCount' => $fetched['authorsCount'],
                ];
            } catch (Throwable $exception) {
                $claimReleased = $claimed && $this->releaseQueueClaim(
                    queuePk: $queuePk,
                    claimTime: $claimTime,
                    previousClaimTime: is_string($row['queue_stime'] ?? null) ? $row['queue_stime'] : null,
                );
                $failed[] = [
                    'videoId' => $rowVideoId,
                    'queue_pk' => $queuePk,
                    'apiCalled' => $apiCalled,
                    'reason' => 'item_failed',
                    'error' => $this->sanitizedFailure($exception),
                    'claim_released' => $claimReleased,
                ];

                if ($exception instanceof YoutubeQuotaWindowException) {
                    break;
                }
            }
        }

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => 'comment_queue_drain',
            'target_video_id' => $videoId,
            'selected_rows' => $rows->count(),
            'claimed_rows' => $claimedRows,
            'api_called_videos' => collect($applied)->filter(fn (array $row): bool => (bool) ($row['apiCalled'] ?? false))->count(),
            'api_attempted_videos' => collect($applied)->filter(fn (array $row): bool => (bool) ($row['apiCalled'] ?? false))->count()
                + collect($failed)->filter(fn (array $row): bool => (bool) ($row['apiCalled'] ?? false))->count(),
            'reply_pages_fetched' => collect($applied)->sum(fn (array $row): int => (int) ($row['replyPagesFetched'] ?? 0)),
            'max_reply_pages_per_video' => $maxReplyPages,
            'moved_to_done_rows' => collect($applied)->filter(fn (array $row): bool => ($row['complete'] ?? true) === true)->count(),
            'continuation_rows' => collect($applied)->filter(fn (array $row): bool => ($row['continuation_pending'] ?? false) === true)->count(),
            'skipped_rows' => count($skipped),
            'failed_rows' => count($failed),
            'exit_code' => $failed === [] ? 0 : 1,
            'write_targets' => [
                'urt_comment_queue.stime',
                'urt_comment.ctime',
                'urt_comment.mtime',
                'urt_comment.comments_count',
                'urt_comment.latest_time',
                'urt_comment.likes_count',
                'urt_comment.threads_count',
                'urt_comment.replies_count',
                'urt_comment.authors_count',
                'urt_comment.pageToken',
                'urt_comment.channelId',
                'urt_comment.u_id',
                'urt_comment.authors_json',
                'urt_comment.comments_json',
                'urt_comment_author',
                'urt_comment_rev',
                'urt_comment_queue.ftime',
                'urt_comment_queue_done',
                'urt_comment_queue delete',
            ],
            'external_calls' => [
                'YouTube Data API commentThreads.list(part=id,replies,snippet)',
                'YouTube Data API comments.list(part=id,snippet,parentId) when embedded replies are incomplete',
            ],
            'applied' => $applied,
            'skipped' => $skipped,
            'failed' => $failed,
            'secrets' => 'not printed',
            'lock' => [
                'key' => 'ingestion:command:youtube.comments.fetch',
                'acquired' => true,
                'ttl_seconds' => max(60, min(86400, (int) config('ingestion.job_lock_seconds', 14400))),
            ],
        ];
    }

    private function claimQueueRow(int $queuePk, string $claimTime, CarbonImmutable $claimExpireTime): bool
    {
        return DB::table('urt_comment_queue')
            ->where('pk', $queuePk)
            ->whereNull('ftime')
            ->where(function ($query) use ($claimExpireTime): void {
                $query
                    ->whereNull('stime')
                    ->orWhere('stime', '<=', $claimExpireTime->format('Y-m-d H:i:s'));
            })
            ->update(['stime' => $claimTime]) === 1;
    }

    private function releaseQueueClaim(int $queuePk, string $claimTime, ?string $previousClaimTime): bool
    {
        try {
            return DB::table('urt_comment_queue')
                ->where('pk', $queuePk)
                ->where('stime', $claimTime)
                ->update(['stime' => $previousClaimTime]) === 1;
        } catch (Throwable) {
            return false;
        }
    }

    private function renewQueueClaim(int $queuePk, string $claimTime, string $timezone): string
    {
        $renewedAt = CarbonImmutable::now($timezone)->format('Y-m-d H:i:s');

        if ($renewedAt <= $claimTime) {
            return $claimTime;
        }

        $updated = DB::table('urt_comment_queue')
            ->where('pk', $queuePk)
            ->whereNull('ftime')
            ->where('stime', $claimTime)
            ->update(['stime' => $renewedAt]);

        if ($updated !== 1) {
            throw new RuntimeException('comment_queue_claim_lost');
        }

        return $renewedAt;
    }

    private function sanitizedFailure(Throwable $exception): string
    {
        return SensitiveTextRedactor::exception($exception, 240);
    }

    /**
     * @return array<string, mixed>
     */
    private function fetchCommentThreads(string $videoId, int $maxPages, int $maxReplyPages, ?Closure $renewClaim = null): array
    {
        $existing = DB::table('urt_comment')->where('videoId', $videoId)->first();
        $resumePageToken = is_string($existing->pageToken ?? null) && trim($existing->pageToken) !== ''
            ? trim($existing->pageToken)
            : null;
        $comments = $resumePageToken === null
            ? []
            : $this->decodedStagedMap($existing->comments_json ?? null, 'comments_json', true);
        $authors = $resumePageToken === null
            ? []
            : $this->decodedStagedMap($existing->authors_json ?? null, 'authors_json');
        $channelId = is_string($existing->channelId ?? null) ? $existing->channelId : null;
        $pageToken = $resumePageToken;
        $pagesFetched = 0;
        $replyPagesFetched = 0;

        do {
            $renewClaim?->__invoke();
            $response = $this->youtube->commentThreads($videoId, $pageToken);
            $pagesFetched++;

            foreach ($response['items'] as $thread) {
                [$commentId, $threadSnippet, $topLevel, $embeddedReplies] = $this->validatedThread($thread);

                $channelId = is_string($threadSnippet['channelId'] ?? null) ? $threadSnippet['channelId'] : $channelId;
                $comment = $this->mapCommentSnippet($topLevel);
                $comments[$commentId] = $comment;
                $this->addAuthor($authors, $comment, $topLevel);
                foreach ($embeddedReplies as $reply) {
                    [$replyId, $replySnippet] = $this->validatedReply($reply, 'malformed_embedded_reply_item');

                    $replyComment = $this->mapCommentSnippet($replySnippet);
                    $comments[$commentId]['replies'][$replyId] = $replyComment;
                    $this->addAuthor($authors, $replyComment, $replySnippet);
                }

                $embeddedReplyCount = count($comments[$commentId]['replies'] ?? []);
                $totalReplyCount = max(0, (int) ($threadSnippet['totalReplyCount'] ?? $embeddedReplyCount));

                if ($totalReplyCount > $embeddedReplyCount) {
                    $comments[$commentId]['replies'] = [];
                    $replyPageToken = null;
                    $replyParentId = trim((string) ($thread['snippet']['topLevelComment']['id'] ?? $commentId));

                    do {
                        if ($replyPagesFetched >= $maxReplyPages) {
                            throw new RuntimeException('reply_page_cap_reached');
                        }

                        $renewClaim?->__invoke();
                        $replyPage = $this->youtube->comments($replyParentId, $replyPageToken);
                        $replyPagesFetched++;

                        foreach ($replyPage['items'] as $reply) {
                            [$replyId, $replySnippet] = $this->validatedReply($reply, 'malformed_reply_item');

                            $replyComment = $this->mapCommentSnippet($replySnippet);
                            $comments[$commentId]['replies'][$replyId] = $replyComment;
                            $this->addAuthor($authors, $replyComment, $replySnippet);
                        }

                        $replyPageToken = $replyPage['nextPageToken'];
                    } while ($replyPageToken !== null);
                }
            }

            $pageToken = $response['nextPageToken'];
        } while ($pageToken !== null && $pagesFetched < $maxPages);

        $totals = $this->commentTotals($comments);

        return [
            'comments' => $comments,
            'authors' => $authors,
            'channelId' => $channelId,
            'latestTime' => $totals['latestTime'],
            'likesCount' => $totals['likesCount'],
            'threadsCount' => $totals['threadsCount'],
            'repliesCount' => $totals['repliesCount'],
            'commentsCount' => $totals['threadsCount'] + $totals['repliesCount'],
            'authorsCount' => count($authors),
            'pageToken' => $pageToken ?? '',
            'pagesFetched' => $pagesFetched,
            'replyPagesFetched' => $replyPagesFetched,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodedStagedMap(mixed $json, string $field, bool $validateReplies = false): array
    {
        if (! is_string($json) || trim($json) === '') {
            throw new RuntimeException("malformed_staged_{$field}");
        }

        try {
            $decoded = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException("malformed_staged_{$field}", previous: $exception);
        }

        if (! is_array($decoded)) {
            throw new RuntimeException("malformed_staged_{$field}");
        }

        foreach ($decoded as $item) {
            if (! is_array($item)) {
                throw new RuntimeException("malformed_staged_{$field}");
            }

            if (! $validateReplies || ! array_key_exists('replies', $item)) {
                continue;
            }

            if (! is_array($item['replies'])) {
                throw new RuntimeException("malformed_staged_{$field}");
            }

            foreach ($item['replies'] as $reply) {
                if (! is_array($reply)) {
                    throw new RuntimeException("malformed_staged_{$field}");
                }
            }
        }

        return $decoded;
    }

    /**
     * @param  array<string, mixed>  $thread
     * @return array{string, array<string, mixed>, array<string, mixed>, array<int, mixed>}
     */
    private function validatedThread(array $thread): array
    {
        $commentId = trim((string) ($thread['id'] ?? ''));
        $snippet = $thread['snippet'] ?? null;
        $topLevel = is_array($snippet) ? ($snippet['topLevelComment']['snippet'] ?? null) : null;
        $replyContainer = $thread['replies'] ?? null;
        $replies = is_array($replyContainer) ? ($replyContainer['comments'] ?? []) : [];

        if ($commentId === '' || ! is_array($snippet) || ! is_array($topLevel) || $topLevel === []) {
            throw new RuntimeException('malformed_comment_thread_item');
        }

        if ($replyContainer !== null && ! is_array($replyContainer)) {
            throw new RuntimeException('malformed_comment_thread_replies');
        }

        if (! is_array($replies)) {
            throw new RuntimeException('malformed_comment_thread_replies');
        }

        return [$commentId, $snippet, $topLevel, array_values($replies)];
    }

    /**
     * @return array{string, array<string, mixed>}
     */
    private function validatedReply(mixed $reply, string $reason): array
    {
        $replyId = is_array($reply) ? trim((string) ($reply['id'] ?? '')) : '';
        $snippet = is_array($reply) ? ($reply['snippet'] ?? null) : null;

        if ($replyId === '' || ! is_array($snippet) || $snippet === []) {
            throw new RuntimeException($reason);
        }

        return [$replyId, $snippet];
    }

    /**
     * @param  array<string, mixed>  $comments
     * @return array{latestTime: string|null, likesCount: int, threadsCount: int, repliesCount: int}
     */
    private function commentTotals(array $comments): array
    {
        $latestTime = null;
        $likesCount = 0;
        $threadsCount = 0;
        $repliesCount = 0;

        foreach ($comments as $comment) {
            if (! is_array($comment)) {
                continue;
            }

            $threadsCount++;
            $likesCount += (int) ($comment['likeCount'] ?? 0);
            $latestTime = $this->latestTimestamp($latestTime, $comment['publishedAt'] ?? null);

            foreach (($comment['replies'] ?? []) as $reply) {
                if (! is_array($reply)) {
                    continue;
                }

                $repliesCount++;
                $likesCount += (int) ($reply['likeCount'] ?? 0);
                $latestTime = $this->latestTimestamp($latestTime, $reply['publishedAt'] ?? null);
            }
        }

        return compact('latestTime', 'likesCount', 'threadsCount', 'repliesCount');
    }

    /**
     * @param  array<string, mixed>  $snippet
     * @return array<string, mixed>
     */
    private function mapCommentSnippet(array $snippet): array
    {
        return [
            'textDisplay' => (string) ($snippet['textDisplay'] ?? ''),
            'textOriginal' => (string) ($snippet['textOriginal'] ?? ''),
            'authorChannelId' => (string) ($snippet['authorChannelId']['value'] ?? ''),
            'publishedAt' => (string) ($snippet['publishedAt'] ?? ''),
            'updatedAt' => (string) ($snippet['updatedAt'] ?? ''),
            'likeCount' => (int) ($snippet['likeCount'] ?? 0),
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $authors
     * @param  array<string, mixed>  $comment
     * @param  array<string, mixed>  $snippet
     */
    private function addAuthor(array &$authors, array $comment, array $snippet): void
    {
        $authorId = (string) ($comment['authorChannelId'] ?? '');

        if ($authorId === '' || isset($authors[$authorId])) {
            return;
        }

        $authors[$authorId] = [
            'DisplayName' => (string) ($snippet['authorDisplayName'] ?? ''),
            'ImageUrl' => (string) ($snippet['authorProfileImageUrl'] ?? ''),
            'ChannelUrl' => isset($snippet['authorChannelUrl']) ? (string) $snippet['authorChannelUrl'] : null,
        ];
    }

    private function latestTimestamp(?string $current, ?string $candidate): ?string
    {
        if (! is_string($candidate) || $candidate === '') {
            return $current;
        }

        return $current === null || $candidate > $current ? $candidate : $current;
    }

    /**
     * @param  array<string, mixed>  $fetched
     */
    private function upsertCommentPayload(
        string $videoId,
        array $fetched,
        CarbonImmutable $now,
        bool $publishAuthors,
    ): void {
        $nowString = $now->format('Y-m-d H:i:s');
        $existing = DB::table('urt_comment')->where('videoId', $videoId)->first();
        $latestTime = is_string($fetched['latestTime'] ?? null) && $fetched['latestTime'] !== ''
            ? CarbonImmutable::parse($fetched['latestTime'])->setTimezone($now->timezone)->format('Y-m-d H:i:s')
            : null;
        $uId = $this->localChannelIdFor((string) ($fetched['channelId'] ?? ''));

        $values = $this->onlyExistingColumns('urt_comment', [
            'mtime' => $nowString,
            'comments_count' => $fetched['commentsCount'],
            'latest_time' => $latestTime,
            'likes_count' => $fetched['likesCount'],
            'threads_count' => $fetched['threadsCount'],
            'replies_count' => $fetched['repliesCount'],
            'authors_count' => $fetched['authorsCount'],
            'pageToken' => $fetched['pageToken'],
            'channelId' => $fetched['channelId'],
            'u_id' => $uId,
            'authors_json' => json_encode($fetched['authors'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'comments_json' => json_encode($fetched['comments'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);

        if ($existing === null) {
            $insert = $this->onlyExistingColumns('urt_comment', [
                'videoId' => $videoId,
                'ctime' => $nowString,
            ]) + $values;

            DB::table('urt_comment')->insert($insert);
        } elseif ($values !== []) {
            DB::table('urt_comment')->where('videoId', $videoId)->update($values);
        }

        if ($publishAuthors) {
            foreach ($fetched['authors'] as $authorChannelId => $author) {
                $this->upsertAuthor((string) $authorChannelId, $author, $videoId, $now);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $author
     */
    private function upsertAuthor(string $authorChannelId, array $author, string $videoId, CarbonImmutable $now): void
    {
        if (! Schema::hasTable('urt_comment_author') || ! Schema::hasTable('urt_comment_rev') || $authorChannelId === '') {
            return;
        }

        $nowString = $now->format('Y-m-d H:i:s');
        $authorRow = DB::table('urt_comment_author')->where('ChannelId', $authorChannelId)->first();

        if ($authorRow === null) {
            DB::table('urt_comment_author')->insert($this->onlyExistingColumns('urt_comment_author', [
                'ctime' => $nowString,
                'ChannelId' => $authorChannelId,
                'ChannelUrl' => $author['ChannelUrl'] ?? null,
                'ImageUrl' => $author['ImageUrl'] ?? null,
                'DisplayName' => $author['DisplayName'] ?? null,
            ]));
            $authorId = (int) DB::table('urt_comment_author')->where('ChannelId', $authorChannelId)->value('author_id');
        } else {
            $authorId = (int) $authorRow->author_id;
        }

        if ($authorId < 1) {
            return;
        }

        $rev = DB::table('urt_comment_rev')->where('author_id', $authorId)->first();
        $indexJson = $rev !== null ? trim((string) ($rev->index_json ?? '')) : '';
        $index = $indexJson !== ''
            ? json_decode($indexJson, true, flags: JSON_THROW_ON_ERROR)
            : [];

        if (! is_array($index)
            || ! array_is_list($index)
            || collect($index)->contains(fn (mixed $id): bool => ! is_string($id) || trim($id) === '')) {
            throw new RuntimeException('Existing comment author revision index JSON is not a string list.');
        }

        if (! in_array($videoId, $index, true)) {
            $index[] = $videoId;
        }

        $values = $this->onlyExistingColumns('urt_comment_rev', [
            'mtime' => $nowString,
            'videos' => count($index),
            'index_json' => json_encode($index, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);

        if ($rev === null) {
            DB::table('urt_comment_rev')->insert($this->onlyExistingColumns('urt_comment_rev', [
                'author_id' => $authorId,
                'ctime' => $nowString,
            ]) + $values);

            return;
        }

        if ($values !== []) {
            DB::table('urt_comment_rev')->where('author_id', $authorId)->update($values);
        }
    }

    private function finishQueueRow(int $queuePk, CarbonImmutable $now): void
    {
        $queue = DB::table('urt_comment_queue')->where('pk', $queuePk)->first();

        if ($queue === null) {
            return;
        }

        if (! DB::table('urt_comment_queue_done')->where('pk', $queuePk)->exists()) {
            DB::table('urt_comment_queue_done')->insert($this->onlyExistingColumns('urt_comment_queue_done', [
                'pk' => $queue->pk,
                'ctime' => $queue->ctime ?? null,
                'stime' => $queue->stime ?? null,
                'ftime' => $now->format('Y-m-d H:i:s'),
                'videoId' => $queue->videoId ?? null,
            ]));
        }

        DB::table('urt_comment_queue')->where('pk', $queuePk)->delete();
    }

    private function localChannelIdFor(?string $youtubeChannelId): ?int
    {
        if (! is_string($youtubeChannelId) || $youtubeChannelId === '' || ! Schema::hasTable('urt_channel')) {
            return null;
        }

        $uId = DB::table('urt_channel')->where('youtube_id', $youtubeChannelId)->value('u_id');

        return $uId !== null ? (int) $uId : null;
    }

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function onlyExistingColumns(string $table, array $values): array
    {
        $columns = Schema::getColumnListing($table);

        return collect($values)
            ->filter(fn (mixed $value, string $column): bool => in_array($column, $columns, true))
            ->all();
    }
}
