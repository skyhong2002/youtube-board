<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChannelCommentsReport
{
    /**
     * @return array<string, mixed>
     */
    public function forChannel(Request $request, int $uId): array
    {
        $filters = [
            'limit' => max(1, min(1000, (int) $request->query('limit', 1000))),
            'min' => max(0, (int) $request->query('min', 1000)),
            'hours' => max(1, min(8760, (int) $request->query('hours', 24))),
        ];

        try {
            $dependencies = $this->dependencies($uId);
            $channel = $this->channel($uId);

            if ($channel === null) {
                return $this->empty(true, $uId, $filters, $dependencies, '本機 `urt_channel` 沒有這個頻道。');
            }

            $videos = $this->videos($uId, $filters);

            if ($videos === []) {
                return $this->empty(true, $uId, $filters, $dependencies, '本機 `urt_video` 沒有符合 legacy hours/min 條件的影片。', $channel);
            }

            $commentRows = $this->commentRows($videos);
            $authors = $this->authorRows($commentRows, $filters['limit']);

            if ($authors === []) {
                return $this->empty(true, $uId, $filters, $dependencies, '本機 `urt_comment` 沒有這個頻道近期影片的 authors_json。', $channel);
            }

            return [
                'available' => true,
                'data_available' => true,
                'channel' => $channel,
                'title' => $channel['title'].' 在 '.$filters['hours'].' 小時內最多留言者',
                'filters' => $filters,
                'videos' => $this->videoRows($videos, $commentRows),
                'authors' => $authors,
                'dependencies' => $dependencies,
                'blocked_reason' => null,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'legacy_file' => 'channel_comments.php',
            ];
        } catch (QueryException) {
            return $this->empty(false, $uId, $filters, [], '本機尚未匯入頻道留言排行需要的 legacy tables 或欄位。', $this->safeChannel($uId));
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function channel(int $uId): ?array
    {
        $row = DB::table('urt_channel')->where('u_id', $uId)->first();

        if ($row === null) {
            return null;
        }

        return [
            'u_id' => (int) $row->u_id,
            'title' => (string) ($row->title ?? 'Unknown channel'),
            'thumbnail' => (string) ($row->thumbnails ?? ''),
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function safeChannel(int $uId): ?array
    {
        try {
            return $this->channel($uId);
        } catch (QueryException) {
            return null;
        }
    }

    /**
     * @param array{limit: int, min: int, hours: int} $filters
     * @return list<object>
     */
    private function videos(int $uId, array $filters): array
    {
        $expireTime = now('Asia/Taipei')->subHours($filters['hours'])->format('Y-m-d H:i:s');

        return DB::table('urt_video')
            ->where('u_id', $uId)
            ->where('publishedAt', '>=', $expireTime)
            ->where('viewCount', '>=', $filters['min'])
            ->orderByDesc('viewCount')
            ->limit($filters['limit'])
            ->get()
            ->all();
    }

    /**
     * @param list<object> $videos
     * @return array<string, object>
     */
    private function commentRows(array $videos): array
    {
        $videoIds = collect($videos)->pluck('videoId')->filter()->unique()->values()->all();

        if ($videoIds === []) {
            return [];
        }

        return DB::table('urt_comment')
            ->whereIn('videoId', $videoIds)
            ->get()
            ->keyBy('videoId')
            ->all();
    }

    /**
     * @param array<string, object> $commentRows
     * @return list<array<string, mixed>>
     */
    private function authorRows(array $commentRows, int $limit): array
    {
        $authors = [];

        foreach ($commentRows as $comment) {
            $decoded = $this->decodeMap($comment->authors_json ?? null);

            foreach ($decoded as $channelId => $author) {
                if (! is_array($author)) {
                    continue;
                }

                $channelId = (string) $channelId;
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
     * @param list<object> $videos
     * @param array<string, object> $commentRows
     * @return list<array<string, mixed>>
     */
    private function videoRows(array $videos, array $commentRows): array
    {
        return collect($videos)
            ->map(function (object $video, int $index) use ($commentRows): array {
                $comment = $commentRows[(string) $video->videoId] ?? null;

                return [
                    'rank' => $index + 1,
                    'video_id' => (string) $video->videoId,
                    'title' => (string) ($video->title ?? $video->videoId),
                    'thumbnail' => (string) ($video->thumbnails ?? 'https://img.youtube.com/vi/'.$video->videoId.'/0.jpg'),
                    'published_at' => (string) ($video->publishedAt ?? ''),
                    'view_count' => (int) ($video->viewCount ?? 0),
                    'authors_count' => $comment ? (int) ($comment->authors_count ?? 0) : 0,
                    'comments_count' => $comment ? (int) ($comment->comments_count ?? 0) : 0,
                    'latest_time' => $comment ? (string) ($comment->latest_time ?? '') : '',
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$video->videoId,
                ];
            })
            ->filter(fn (array $row): bool => $row['authors_count'] > 0 || $row['comments_count'] > 0)
            ->values()
            ->all();
    }

    /**
     * @return list<array{table: string, rows: int|null, status: string}>
     */
    private function dependencies(int $uId): array
    {
        return collect(['urt_channel', 'urt_video', 'urt_comment', 'urt_comment_author'])
            ->map(fn (string $table): array => $this->dependency($table, $uId))
            ->values()
            ->all();
    }

    /**
     * @return array{table: string, rows: int|null, status: string}
     */
    private function dependency(string $table, int $uId): array
    {
        try {
            $query = DB::table($table);

            if (in_array($table, ['urt_video', 'urt_comment'], true)) {
                $query->where('u_id', $uId);
            }

            if ($table === 'urt_channel') {
                $query->where('u_id', $uId);
            }

            $rows = $query->count();

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
    private function empty(bool $available, int $uId, array $filters, array $dependencies, string $reason, ?array $channel = null): array
    {
        return [
            'available' => $available,
            'data_available' => false,
            'channel' => $channel,
            'title' => ($channel['title'] ?? '頻道').' 在 '.$filters['hours'].' 小時內最多留言者',
            'filters' => $filters,
            'videos' => [],
            'authors' => [],
            'dependencies' => $dependencies !== [] ? $dependencies : $this->dependencies($uId),
            'blocked_reason' => $reason,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'legacy_file' => 'channel_comments.php',
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
