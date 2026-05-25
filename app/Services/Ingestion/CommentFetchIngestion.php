<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class CommentFetchIngestion
{
    public function __construct(
        private readonly CommentFetchPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(?string $videoId = null, int $limit = 1, int $maxPages = 1, ?CarbonInterface $now = null): array
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
        $preview = $this->preview->preview(videoId: $videoId, limit: $limit, now: $now);
        $rows = collect($preview['rows'] ?? [])->take($limit)->values();
        $applied = [];
        $skipped = [];

        foreach ($rows as $row) {
            $queuePk = $row['pk'] !== null ? (int) $row['pk'] : null;
            $rowVideoId = trim((string) ($row['video_id'] ?? ''));

            if ($queuePk === null || $rowVideoId === '') {
                $skipped[] = ['videoId' => $rowVideoId, 'reason' => 'missing_queue_pk_or_video_id'];

                continue;
            }

            DB::transaction(fn () => $this->updateQueue($queuePk, ['stime' => $now->format('Y-m-d H:i:s')]));

            if ((bool) ($row['would_skip_api_recent_cache'] ?? false)) {
                DB::transaction(fn () => $this->finishQueueRow($queuePk, $now));
                $applied[] = [
                    'videoId' => $rowVideoId,
                    'apiCalled' => false,
                    'reason' => 'recent_cache',
                    'commentsCount' => $row['comments_count'] ?? null,
                    'authorsCount' => $row['authors_count'] ?? null,
                ];

                continue;
            }

            $fetched = $this->fetchCommentThreads($rowVideoId, $maxPages);

            DB::transaction(function () use ($queuePk, $rowVideoId, $fetched, $now): void {
                $this->upsertCommentPayload($rowVideoId, $fetched, $now);
                $this->finishQueueRow($queuePk, $now);
            });

            $applied[] = [
                'videoId' => $rowVideoId,
                'apiCalled' => true,
                'pagesFetched' => $fetched['pagesFetched'],
                'threadsCount' => $fetched['threadsCount'],
                'repliesCount' => $fetched['repliesCount'],
                'commentsCount' => $fetched['commentsCount'],
                'authorsCount' => $fetched['authorsCount'],
            ];
        }

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => 'comment_queue_drain',
            'target_video_id' => $videoId,
            'selected_rows' => $rows->count(),
            'api_called_videos' => collect($applied)->filter(fn (array $row): bool => (bool) ($row['apiCalled'] ?? false))->count(),
            'moved_to_done_rows' => count($applied),
            'skipped_rows' => count($skipped),
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
            'external_calls' => ['YouTube Data API commentThreads.list(part=id,replies,snippet)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function fetchCommentThreads(string $videoId, int $maxPages): array
    {
        $comments = [];
        $authors = [];
        $channelId = null;
        $latestTime = null;
        $likesCount = 0;
        $threadsCount = 0;
        $repliesCount = 0;
        $pageToken = null;
        $pagesFetched = 0;

        do {
            $response = $this->youtube->commentThreads($videoId, $pageToken);
            $pagesFetched++;

            foreach ($response['items'] as $thread) {
                $topLevel = $thread['snippet']['topLevelComment']['snippet'] ?? [];
                $commentId = (string) ($thread['id'] ?? '');

                if ($commentId === '' || $topLevel === []) {
                    continue;
                }

                $channelId = is_string($thread['snippet']['channelId'] ?? null) ? $thread['snippet']['channelId'] : $channelId;
                $comment = $this->mapCommentSnippet($topLevel);
                $comments[$commentId] = $comment;
                $this->addAuthor($authors, $comment, $topLevel);
                $threadsCount++;
                $likesCount += (int) ($comment['likeCount'] ?? 0);
                $latestTime = $this->latestTimestamp($latestTime, $comment['publishedAt'] ?? null);

                foreach (($thread['replies']['comments'] ?? []) as $reply) {
                    $replyId = (string) ($reply['id'] ?? '');
                    $replySnippet = $reply['snippet'] ?? [];

                    if ($replyId === '' || $replySnippet === []) {
                        continue;
                    }

                    $replyComment = $this->mapCommentSnippet($replySnippet);
                    $comments[$commentId]['replies'][$replyId] = $replyComment;
                    $this->addAuthor($authors, $replyComment, $replySnippet);
                    $repliesCount++;
                    $likesCount += (int) ($replyComment['likeCount'] ?? 0);
                    $latestTime = $this->latestTimestamp($latestTime, $replyComment['publishedAt'] ?? null);
                }
            }

            $pageToken = $response['nextPageToken'];
        } while ($pageToken !== null && $pagesFetched < $maxPages);

        return [
            'comments' => $comments,
            'authors' => $authors,
            'channelId' => $channelId,
            'latestTime' => $latestTime,
            'likesCount' => $likesCount,
            'threadsCount' => $threadsCount,
            'repliesCount' => $repliesCount,
            'commentsCount' => $threadsCount + $repliesCount,
            'authorsCount' => count($authors),
            'pageToken' => $pageToken ?? '',
            'pagesFetched' => $pagesFetched,
        ];
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
    private function upsertCommentPayload(string $videoId, array $fetched, CarbonImmutable $now): void
    {
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

        foreach ($fetched['authors'] as $authorChannelId => $author) {
            $this->upsertAuthor((string) $authorChannelId, $author, $videoId, $now);
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
        $index = $rev !== null && isset($rev->index_json) ? json_decode((string) $rev->index_json, true) : [];
        $index = is_array($index) ? array_values(array_filter($index, fn (mixed $id): bool => is_string($id) && $id !== '')) : [];

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
        $this->updateQueue($queuePk, ['ftime' => $now->format('Y-m-d H:i:s')]);
        $queue = DB::table('urt_comment_queue')->where('pk', $queuePk)->first();

        if ($queue !== null && ! DB::table('urt_comment_queue_done')->where('pk', $queuePk)->exists()) {
            DB::table('urt_comment_queue_done')->insert($this->onlyExistingColumns('urt_comment_queue_done', [
                'pk' => $queue->pk,
                'ctime' => $queue->ctime ?? null,
                'stime' => $queue->stime ?? null,
                'ftime' => $queue->ftime ?? null,
                'videoId' => $queue->videoId ?? null,
            ]));
        }

        DB::table('urt_comment_queue')->where('pk', $queuePk)->delete();
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private function updateQueue(int $queuePk, array $values): void
    {
        $values = $this->onlyExistingColumns('urt_comment_queue', $values);

        if ($values !== []) {
            DB::table('urt_comment_queue')->where('pk', $queuePk)->update($values);
        }
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
