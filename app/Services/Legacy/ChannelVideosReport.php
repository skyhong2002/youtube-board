<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ChannelVideosReport
{
    private const SORT_COLUMNS = ['viewCount', 'likeCount', 'commentCount', 'publishedAt'];

    /**
     * @return array{available: bool, channel: array<string, mixed>|null, rows: array<int, array<string, mixed>>, filters: array<string, mixed>, generated_at: string, title: string, sort_column: string}
     */
    public function forChannel(Request $request, int $uId): array
    {
        $sortColumn = $this->sortColumn($request);

        try {
            $channel = DB::table('urt_channel')->where('u_id', $uId)->first();

            if (! $channel) {
                return $this->empty(true, $request, $sortColumn);
            }

            $filters = $this->filters($request);
            $rows = $this->rows($uId, $filters, $sortColumn);
            $channelData = [
                'u_id' => (int) $channel->u_id,
                'youtube_id' => $channel->youtube_id,
                'title' => $channel->title ?? 'Unknown channel',
                'thumbnail' => $channel->thumbnails,
                'youtube_url' => 'https://www.youtube.com/channel/'.$channel->youtube_id,
            ];

            return [
                'available' => true,
                'channel' => $channelData,
                'rows' => $rows,
                'filters' => $this->displayFilters($request, $filters),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'title' => $channelData['title'].' '.$filters['hours'].'小時內觀看最多的影片',
                'sort_column' => $sortColumn,
            ];
        } catch (QueryException) {
            return $this->empty(false, $request, $sortColumn);
        }
    }

    /**
     * @return array{limit: int, min: int, hours: int}
     */
    private function filters(Request $request): array
    {
        return [
            'limit' => max(1, min(1000, (int) $request->query('limit', 1000))),
            'min' => max(0, (int) $request->query('min', 1000)),
            'hours' => max(1, min(8760, (int) $request->query('hours', 24))),
        ];
    }

    private function sortColumn(Request $request): string
    {
        $column = (string) $request->query('column', 'viewCount');

        return in_array($column, self::SORT_COLUMNS, true) ? $column : 'viewCount';
    }

    /**
     * @param array{limit: int, min: int, hours: int} $filters
     * @return array<int, array<string, mixed>>
     */
    private function rows(int $uId, array $filters, string $sortColumn): array
    {
        $expireTime = now('Asia/Taipei')->subHours($filters['hours'])->format('Y-m-d H:i:s');
        $videos = DB::table('urt_video')
            ->where('u_id', $uId)
            ->where('publishedAt', '>=', $expireTime)
            ->where('viewCount', '>=', $filters['min'])
            ->orderByDesc($sortColumn)
            ->limit($filters['limit'])
            ->get();

        if ($videos->isEmpty()) {
            return [];
        }

        $comments = $this->comments($videos->pluck('videoId')->filter()->unique()->values()->all());

        return $videos
            ->map(function (object $row, int $index) use ($comments): array {
                $commentRow = $comments[(string) $row->videoId] ?? null;
                $viewCount = (int) ($row->viewCount ?? 0);
                $likeCount = (int) ($row->likeCount ?? 0);
                $commentCount = $commentRow ? (int) ($commentRow->comments_count ?? 0) : (int) ($row->commentCount ?? 0);
                $reactionBase = $likeCount + (int) ($row->dislikeCount ?? 0) + $commentCount;

                return [
                    'rank' => $index + 1,
                    'video_id' => $row->videoId,
                    'thumbnail' => $row->thumbnails,
                    'channel_title' => $row->channelTitle,
                    'published_at' => $row->publishedAt,
                    'title' => $row->title,
                    'view_count' => $viewCount,
                    'like_count' => $likeCount,
                    'comment_count' => $commentCount,
                    'like_ratio' => $reactionBase > 0 ? $likeCount / $reactionBase * 100 : null,
                    'authors_count' => $commentRow ? (int) ($commentRow->authors_count ?? 0) : null,
                    'replies_count' => $commentRow ? (int) ($commentRow->replies_count ?? 0) : null,
                    'comment_likes_count' => $commentRow ? (int) ($commentRow->likes_count ?? 0) : null,
                    'youtube_url' => 'https://www.youtube.com/watch?v='.$row->videoId,
                ];
            })
            ->all();
    }

    /**
     * @param array<int, string> $videoIds
     * @return array<string, object>
     */
    private function comments(array $videoIds): array
    {
        try {
            return CommentPublicationScope::complete(DB::table('urt_comment'))
                ->whereIn('urt_comment.videoId', $videoIds)
                ->get()
                ->keyBy('videoId')
                ->all();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @param array{limit: int, min: int, hours: int} $filters
     * @return array<string, mixed>
     */
    private function displayFilters(Request $request, array $filters): array
    {
        return array_merge($request->query(), [
            'hours' => $filters['hours'],
            'min' => $filters['min'],
        ]);
    }

    /**
     * @return array{available: bool, channel: null, rows: array<int, array<string, mixed>>, filters: array<string, mixed>, generated_at: string, title: string, sort_column: string}
     */
    private function empty(bool $available, Request $request, string $sortColumn): array
    {
        return [
            'available' => $available,
            'channel' => null,
            'rows' => [],
            'filters' => $request->query(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'title' => '頻道影片',
            'sort_column' => $sortColumn,
        ];
    }
}
