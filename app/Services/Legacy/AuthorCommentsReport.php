<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AuthorCommentsReport
{
    private const TAGS_TO_SHOW = [3, 4, 5, 6, 48, 49];

    /**
     * @return array<string, mixed>
     */
    public function forAuthor(Request $request, string $authorKey): array
    {
        $filters = [
            'lookup' => $this->lookupMode($request, $authorKey),
            'limit' => max(1, min(1000, (int) $request->query('limit', 1000))),
            'hours' => max(1, min(8760, (int) $request->query('hours', 24))),
        ];

        try {
            $dependencies = $this->dependencies();
            $author = $this->author($filters['lookup'], $authorKey);

            if ($author === null) {
                return $this->empty(true, $authorKey, $filters, $dependencies, '本機 `urt_comment_author` 沒有這位留言者資料。');
            }

            $authorId = (string) ($author['author_id'] ?? '');
            $channelId = (string) ($author['channel_id'] ?? '');
            $videoIds = $this->commentRevisionVideoIds($authorId);

            if ($videoIds === []) {
                return $this->empty(true, $authorKey, $filters, $dependencies, '本機 `urt_comment_rev` 沒有這位留言者的影片 index。', $author);
            }

            $commentRows = CommentPublicationScope::complete(DB::table('urt_comment'))
                ->whereIn('urt_comment.videoId', $videoIds)
                ->get();

            $analysis = $this->analyze($commentRows, $channelId, $filters['limit']);

            if ($analysis['comments'] === []) {
                return $this->empty(true, $authorKey, $filters, $dependencies, '本機 `urt_comment` 有 revision index 指向的影片，但沒有符合這位留言者的留言內容。', $author);
            }

            return [
                'available' => true,
                'data_available' => true,
                'author_key' => $authorKey,
                'author' => $author,
                'filters' => $filters,
                'dependencies' => $dependencies,
                'hourly' => $analysis['hourly'],
                'channels' => $analysis['channels'],
                'tags' => $analysis['tags'],
                'comments' => $analysis['comments'],
                'summary' => $analysis['summary'],
                'blocked_reason' => null,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'legacy_file' => 'author_comments_bak.php',
            ];
        } catch (QueryException) {
            return $this->empty(false, $authorKey, $filters, [], '本機尚未匯入留言作者分析需要的 legacy tables。');
        }
    }

    private function lookupMode(Request $request, string $authorKey): string
    {
        $lookup = (string) $request->query('lookup', '');

        if (in_array($lookup, ['ChannelId', 'channel', 'channel_id'], true)) {
            return 'ChannelId';
        }

        if (in_array($lookup, ['author_id', 'author'], true)) {
            return 'author_id';
        }

        return ctype_digit($authorKey) ? 'author_id' : 'ChannelId';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function author(string $lookup, string $authorKey): ?array
    {
        $column = $lookup === 'ChannelId' ? 'ChannelId' : 'author_id';
        $row = DB::table('urt_comment_author')->where($column, $authorKey)->first();

        if ($row === null) {
            return null;
        }

        $data = (array) $row;

        return [
            'author_id' => (string) ($data['author_id'] ?? ''),
            'channel_id' => (string) ($data['ChannelId'] ?? $data['channelId'] ?? $data['channel_id'] ?? ''),
            'display_name' => (string) ($data['DisplayName'] ?? $data['displayName'] ?? $data['name'] ?? $authorKey),
            'image_url' => (string) ($data['ImageUrl'] ?? $data['imageUrl'] ?? ''),
            'channel_url' => (string) ($data['ChannelUrl'] ?? $data['channelUrl'] ?? ''),
        ];
    }

    /**
     * @return list<string>
     */
    private function commentRevisionVideoIds(string $authorId): array
    {
        if ($authorId === '') {
            return [];
        }

        $row = DB::table('urt_comment_rev')->where('author_id', $authorId)->first();
        $decoded = $this->decodeMap($row->index_json ?? null);

        return collect($decoded)
            ->map(fn (mixed $value, mixed $key): string => is_string($value) || is_numeric($value) ? (string) $value : (string) $key)
            ->map(fn (string $videoId): string => trim($videoId))
            ->filter(fn (string $videoId): bool => $videoId !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param Collection<int, object> $commentRows
     * @return array<string, mixed>
     */
    private function analyze(Collection $commentRows, string $channelId, int $limit): array
    {
        $hourlyCounts = array_fill_keys(array_map(fn (int $hour): string => sprintf('%02d', $hour), range(0, 23)), 0);
        $channelCounts = [];
        $comments = [];

        foreach ($commentRows as $row) {
            $videoId = (string) ($row->videoId ?? '');
            $uId = (int) ($row->u_id ?? 0);
            $decoded = $this->decodeMap($row->comments_json ?? null);

            if ($uId > 0) {
                $channelCounts[$uId] ??= ['u_id' => $uId, 'video_count' => 0, 'comments' => 0, 'replies' => 0];
                $channelCounts[$uId]['video_count']++;
            }

            foreach ($decoded as $item) {
                if (! is_array($item)) {
                    continue;
                }

                if ((string) ($item['authorChannelId'] ?? '') === $channelId) {
                    $this->addMatchedComment($comments, $hourlyCounts, $channelCounts, $item, $videoId, $uId, false);
                }

                foreach (($item['replies'] ?? []) as $reply) {
                    if (is_array($reply) && (string) ($reply['authorChannelId'] ?? '') === $channelId) {
                        $this->addMatchedComment($comments, $hourlyCounts, $channelCounts, $reply, $videoId, $uId, true);
                    }
                }
            }
        }

        $channels = $this->channelRows($channelCounts);
        $tags = $this->tagRows($channelCounts);

        return [
            'hourly' => collect($hourlyCounts)
                ->map(fn (int $count, string $hour): array => ['hour' => $hour, 'count' => $count])
                ->values()
                ->all(),
            'channels' => $channels,
            'tags' => $tags,
            'comments' => collect($comments)
                ->sortByDesc('published_at')
                ->take($limit)
                ->values()
                ->all(),
            'summary' => [
                'video_rows' => $commentRows->count(),
                'matched_comments' => count($comments),
                'comment_count' => collect($channelCounts)->sum('comments'),
                'reply_count' => collect($channelCounts)->sum('replies'),
                'channel_count' => count(array_filter($channelCounts, fn (array $row): bool => $row['comments'] + $row['replies'] > 0)),
            ],
        ];
    }

    /**
     * @param list<array<string, mixed>> $comments
     * @param array<string, int> $hourlyCounts
     * @param array<int, array{u_id: int, video_count: int, comments: int, replies: int}> $channelCounts
     * @param array<string, mixed> $item
     */
    private function addMatchedComment(array &$comments, array &$hourlyCounts, array &$channelCounts, array $item, string $videoId, int $uId, bool $reply): void
    {
        $publishedAt = (string) ($item['publishedAt'] ?? '');
        $timestamp = strtotime($publishedAt);

        if ($timestamp > 0) {
            $hour = date('H', $timestamp);
            $hourlyCounts[$hour] = ($hourlyCounts[$hour] ?? 0) + 1;
        }

        if ($uId > 0) {
            $channelCounts[$uId] ??= ['u_id' => $uId, 'video_count' => 0, 'comments' => 0, 'replies' => 0];
            $channelCounts[$uId][$reply ? 'replies' : 'comments']++;
        }

        $comments[] = [
            'video_id' => $videoId,
            'u_id' => $uId,
            'text' => trim(strip_tags((string) ($item['textOriginal'] ?? $item['textDisplay'] ?? ''))),
            'published_at' => $publishedAt,
            'like_count' => (int) ($item['likeCount'] ?? 0),
            'is_reply' => $reply,
            'youtube_url' => 'https://youtube.com/watch?v='.$videoId,
            'thumbnail' => 'https://img.youtube.com/vi/'.$videoId.'/0.jpg',
        ];
    }

    /**
     * @param array<int, array{u_id: int, video_count: int, comments: int, replies: int}> $channelCounts
     * @return list<array<string, mixed>>
     */
    private function channelRows(array $channelCounts): array
    {
        $uIds = collect($channelCounts)->pluck('u_id')->filter()->values()->all();
        $channels = $uIds === []
            ? collect()
            : DB::table('urt_channel')->whereIn('u_id', $uIds)->get()->keyBy('u_id');

        return collect($channelCounts)
            ->filter(fn (array $row): bool => $row['comments'] + $row['replies'] > 0)
            ->sortByDesc(fn (array $row): int => $row['comments'] + $row['replies'])
            ->map(function (array $row) use ($channels): array {
                $channel = $channels->get($row['u_id']);

                return [
                    'u_id' => $row['u_id'],
                    'title' => (string) ($channel->title ?? 'Unknown channel'),
                    'thumbnail' => (string) ($channel->thumbnails ?? ''),
                    'video_count' => $row['video_count'],
                    'comments' => $row['comments'],
                    'replies' => $row['replies'],
                    'total' => $row['comments'] + $row['replies'],
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @param array<int, array{u_id: int, video_count: int, comments: int, replies: int}> $channelCounts
     * @return list<array{tag_id: int, tag_name: string, count: int}>
     */
    private function tagRows(array $channelCounts): array
    {
        $uIds = collect($channelCounts)->pluck('u_id')->filter()->values()->all();
        $counts = $uIds === []
            ? collect()
            : DB::table('urt_count')->whereIn('u_id', $uIds)->get()->keyBy('u_id');
        $tagNames = DB::table('urt_tag')->pluck('tag_name', 'tag_id')->all();
        $tagCounts = [];

        foreach ($channelCounts as $uId => $row) {
            $countRow = $counts->get($uId);
            $tags = (string) ($countRow->tags ?? '');

            foreach ($this->parseTags($tags) as $tagId) {
                $tagCounts[$tagId] = ($tagCounts[$tagId] ?? 0) + $row['video_count'];
            }
        }

        return collect($tagCounts)
            ->filter(fn (int $count, int $tagId): bool => in_array($tagId, self::TAGS_TO_SHOW, true))
            ->sortDesc()
            ->map(fn (int $count, int $tagId): array => [
                'tag_id' => $tagId,
                'tag_name' => (string) ($tagNames[$tagId] ?? $tagId),
                'count' => $count,
            ])
            ->values()
            ->all();
    }

    /**
     * @return list<int>
     */
    private function parseTags(string $tags): array
    {
        preg_match_all('/\[(\d+)\]/', $tags, $matches);

        return collect($matches[1] ?? [])
            ->map(fn (string $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return list<array{table: string, rows: int|null, status: string}>
     */
    private function dependencies(): array
    {
        return collect(['urt_comment_author', 'urt_comment_rev', 'urt_comment', 'urt_channel', 'urt_count', 'urt_tag'])
            ->map(fn (string $table): array => $this->dependency($table))
            ->values()
            ->all();
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table): array
    {
        try {
            $rows = DB::table($table)->count();

            return [
                'table' => $table,
                'rows' => $rows,
                'status' => $rows > 0 ? 'present' : 'empty',
            ];
        } catch (QueryException) {
            return [
                'table' => $table,
                'rows' => null,
                'status' => 'missing',
            ];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function empty(bool $available, string $authorKey, array $filters, array $dependencies, string $reason, ?array $author = null): array
    {
        return [
            'available' => $available,
            'data_available' => false,
            'author_key' => $authorKey,
            'author' => $author,
            'filters' => $filters,
            'dependencies' => $dependencies !== [] ? $dependencies : $this->dependencies(),
            'hourly' => collect(range(0, 23))->map(fn (int $hour): array => ['hour' => sprintf('%02d', $hour), 'count' => 0])->all(),
            'channels' => [],
            'tags' => [],
            'comments' => [],
            'summary' => [
                'video_rows' => 0,
                'matched_comments' => 0,
                'comment_count' => 0,
                'reply_count' => 0,
                'channel_count' => 0,
            ],
            'blocked_reason' => $reason,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'legacy_file' => 'author_comments_bak.php',
        ];
    }

    /**
     * @return array<string|int, mixed>
     */
    private function decodeMap(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
    }
}
