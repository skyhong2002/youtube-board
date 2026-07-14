<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class TagCommentsReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forTagFilters(Request $request, ?int $tagId = null): array
    {
        try {
            $tagNames = $this->tagFilter->tagNames();
            $filters = $this->filters($request, $tagId);
            $channelTags = $this->tagFilter->matchingChannelTags($filters);
            $dependencies = $this->dependencies();

            if ($channelTags->isEmpty()) {
                return $this->empty(true, $filters, $tagNames, $dependencies, '本機 `urt_count` 沒有符合 legacy tag filter 的頻道。');
            }

            $rows = $this->commentRows($channelTags, $filters);
            $authors = $this->authorRows($rows, $filters['limit']);

            if ($rows === []) {
                return $this->empty(true, $filters, $tagNames, $dependencies, '本機 `urt_comment` 沒有符合這組 tag filter 的留言 rows。');
            }

            return [
                'available' => true,
                'data_available' => true,
                'title' => $this->title($filters, $tagNames),
                'filters' => $this->displayFilters($request, $filters),
                'rows' => $rows,
                'authors' => $authors,
                'dependencies' => $dependencies,
                'blocked_reason' => null,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'legacy_file' => 'comments_recent.php + comments.php',
            ];
        } catch (QueryException) {
            $filters = $this->filters($request, $tagId);
            $tagNames = $this->safeTagNames();

            return $this->empty(false, $filters, $tagNames, [], '本機尚未匯入標籤留言排行需要的 legacy tables 或欄位。');
        }
    }

    /**
     * @return array{or: list<int>, tagid: list<int>, not: list<int>, limit: int, min: int, hours: int, show: int}
     */
    private function filters(Request $request, ?int $tagId): array
    {
        $filters = $this->tagFilter->filters($request);

        if ($tagId !== null && $tagId > 0) {
            if ($filters['tagid'] === []) {
                $filters['tagid'] = [$tagId];
            } elseif (! in_array($tagId, $filters['tagid'], true)) {
                array_unshift($filters['tagid'], $tagId);
            }
        }

        $filters['limit'] = max(1, min(1000, (int) $request->query('limit', 25)));
        $filters['min'] = max(0, (int) $request->query('min', 1000));
        $filters['hours'] = max(1, min(8760, (int) $request->query('hours', 24)));
        $filters['show'] = max(0, min(10, (int) $request->query('show', 0)));

        return $filters;
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, limit: int, min: int, hours: int, show: int} $filters
     * @return list<array<string, mixed>>
     */
    private function commentRows(Collection $channelTags, array $filters): array
    {
        $channelIds = $channelTags->pluck('u_id')->filter()->unique()->values()->all();

        if ($channelIds === []) {
            return [];
        }

        $comments = CommentPublicationScope::complete(DB::table('urt_comment'))
            ->whereIn('urt_comment.u_id', $channelIds)
            ->orderByDesc('ctime')
            ->limit($filters['limit'])
            ->get();

        if ($comments->isEmpty()) {
            return [];
        }

        $videoIds = $comments->pluck('videoId')->filter()->unique()->values()->all();
        $videos = $videoIds === []
            ? collect()
            : DB::table('urt_video')->whereIn('videoId', $videoIds)->get()->keyBy('videoId');

        return $comments
            ->map(function (object $comment, int $index) use ($videos): array {
                $video = $videos->get($comment->videoId);
                $videoId = (string) ($comment->videoId ?? '');
                $threads = (int) ($comment->threads_count ?? 0);
                $replies = (int) ($comment->replies_count ?? 0);
                $commentsCount = (int) ($comment->comments_count ?? ($threads + $replies));

                return [
                    'rank' => $index + 1,
                    'video_id' => $videoId,
                    'u_id' => (int) ($comment->u_id ?? $video->u_id ?? 0),
                    'thumbnail' => (string) ($video->thumbnails ?? 'https://img.youtube.com/vi/'.$videoId.'/0.jpg'),
                    'channel_title' => (string) ($video->channelTitle ?? ''),
                    'title' => (string) ($video->title ?? $videoId),
                    'latest_time' => (string) ($comment->latest_time ?? $comment->ctime ?? ''),
                    'authors_count' => (int) ($comment->authors_count ?? 0),
                    'likes_count' => (int) ($comment->likes_count ?? 0),
                    'threads_count' => $threads,
                    'replies_count' => $replies,
                    'comments_count' => $commentsCount,
                    'ctime' => (string) ($comment->ctime ?? ''),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$videoId,
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function authorRows(array $rows, int $limit): array
    {
        if ($rows === []) {
            return [];
        }

        $videoIds = collect($rows)->pluck('video_id')->filter()->unique()->values()->all();
        $comments = CommentPublicationScope::complete(DB::table('urt_comment'))
            ->whereIn('urt_comment.videoId', $videoIds)
            ->get();
        $authors = [];

        foreach ($comments as $comment) {
            $decoded = $this->decodeMap($comment->authors_json ?? null);

            foreach ($decoded as $key => $author) {
                $author = is_array($author) ? $author : [];
                $channelId = (string) ($author['ChannelId'] ?? $author['channelId'] ?? $author['channel_id'] ?? $key);

                if ($channelId === '') {
                    continue;
                }

                $authors[$channelId] ??= [
                    'channel_id' => $channelId,
                    'display_name' => (string) ($author['DisplayName'] ?? $author['displayName'] ?? $channelId),
                    'image_url' => (string) ($author['ImageUrl'] ?? $author['imageUrl'] ?? ''),
                    'channel_url' => (string) ($author['ChannelUrl'] ?? $author['channelUrl'] ?? ''),
                    'count' => 0,
                ];
                $authors[$channelId]['count']++;
            }
        }

        return collect($authors)
            ->sortByDesc('count')
            ->take($limit)
            ->values()
            ->all();
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, limit: int, min: int, hours: int, show: int} $filters
     * @param array<int, string> $tagNames
     */
    private function title(array $filters, array $tagNames): string
    {
        $tagIds = array_values(array_unique(array_merge($filters['tagid'], $filters['or'])));
        $prefix = collect($tagIds)
            ->map(fn (int $id): string => $tagNames[$id] ?? (string) $id)
            ->filter()
            ->implode(' ');

        return ($prefix !== '' ? $prefix : '全部標籤').' 標籤近期留言';
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, limit: int, min: int, hours: int, show: int} $filters
     * @return array<string, string|int>
     */
    private function displayFilters(Request $request, array $filters): array
    {
        return array_filter(array_merge($request->query(), [
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
            'hours' => $filters['hours'],
            'min' => $filters['min'],
            'limit' => $filters['limit'],
        ]), fn (mixed $value): bool => $value !== '');
    }

    /**
     * @return array<string, mixed>
     */
    private function empty(bool $available, array $filters, array $tagNames, array $dependencies, string $reason): array
    {
        return [
            'available' => $available,
            'data_available' => false,
            'title' => $this->title($filters, $tagNames),
            'filters' => [
                'tagid' => implode(',', $filters['tagid']),
                'or' => implode(',', $filters['or']),
                'not' => implode(',', $filters['not']),
                'hours' => $filters['hours'],
                'min' => $filters['min'],
                'limit' => $filters['limit'],
            ],
            'rows' => [],
            'authors' => [],
            'dependencies' => $dependencies !== [] ? $dependencies : $this->dependencies(),
            'blocked_reason' => $reason,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'legacy_file' => 'comments_recent.php + comments.php',
        ];
    }

    /**
     * @return list<array{table: string, rows: int|null, status: string}>
     */
    private function dependencies(): array
    {
        return collect(['urt_comment', 'urt_comment_author', 'urt_video', 'urt_count', 'urt_tag'])
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
     * @return array<int, string>
     */
    private function safeTagNames(): array
    {
        try {
            return $this->tagFilter->tagNames();
        } catch (QueryException) {
            return [];
        }
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
