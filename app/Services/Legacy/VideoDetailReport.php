<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class VideoDetailReport
{
    /**
     * @return array<string, mixed>
     */
    public function forVideo(Request $request, string $videoId): array
    {
        $limit = max(1, min(200, (int) $request->query('limit', 50)));

        try {
            $video = DB::table('urt_video')->where('videoId', $videoId)->first();
            $duration = DB::table('urt_video_duration')
                ->where('videoId', $videoId)
                ->orderByDesc('pk_video')
                ->first();
            $liveLogs = DB::table('urt_video_live_log')
                ->where('videoId', $videoId)
                ->orderBy('the_date')
                ->get();
            $videoLogs = DB::table('urt_video_log')
                ->where('videoId', $videoId)
                ->orderBy('themonth')
                ->get();
            $comment = CommentPublicationScope::complete(DB::table('urt_comment'))
                ->where('urt_comment.videoId', $videoId)
                ->first();

            $live = $this->liveSeries($liveLogs, $limit);
            $history = $this->videoHistory($videoLogs, $limit);
            $comments = $this->commentSummary($comment, $limit);

            return [
                'available' => true,
                'data_available' => $video !== null || $live['log_rows'] > 0 || $history['log_rows'] > 0 || $comment !== null,
                'video' => $video ? $this->video($video, $duration) : null,
                'video_id' => $videoId,
                'live' => $live,
                'history' => $history,
                'comments' => $comments,
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'limit' => $limit,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'data_available' => false,
                'video' => null,
                'video_id' => $videoId,
                'live' => $this->emptyLive(),
                'history' => ['available' => false, 'rows' => [], 'log_rows' => 0],
                'comments' => $this->emptyComments(false),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'limit' => $limit,
            ];
        }
    }

    private function video(object $row, ?object $duration): array
    {
        $durationSeconds = $duration?->duration !== null ? (int) $duration->duration : null;

        return [
            'pk' => (int) ($row->pk ?? 0),
            'u_id' => (int) ($row->u_id ?? 0),
            'video_id' => (string) ($row->videoId ?? ''),
            'title' => (string) ($row->title ?? ''),
            'description' => (string) ($row->description ?? ''),
            'channel_id' => (string) ($row->channelId ?? ''),
            'channel_title' => (string) ($row->channelTitle ?? ''),
            'thumbnail' => (string) ($row->thumbnails ?? ''),
            'published_at' => (string) ($row->publishedAt ?? ''),
            'view_count' => $row->viewCount !== null ? (int) $row->viewCount : null,
            'like_count' => $row->likeCount !== null ? (int) $row->likeCount : null,
            'dislike_count' => $row->dislikeCount !== null ? (int) $row->dislikeCount : null,
            'comment_count' => $row->commentCount !== null ? (int) $row->commentCount : null,
            'duration_seconds' => $durationSeconds,
            'duration_label' => $durationSeconds !== null ? $this->durationLabel($durationSeconds) : null,
            'caption' => $duration?->caption ?? null,
            'youtube_url' => 'https://www.youtube.com/watch?v='.(string) ($row->videoId ?? ''),
        ];
    }

    private function durationLabel(int $seconds): string
    {
        $hours = intdiv($seconds, 3600);
        $minutes = intdiv($seconds % 3600, 60);
        $remaining = $seconds % 60;

        return $hours > 0
            ? sprintf('%d:%02d:%02d', $hours, $minutes, $remaining)
            : sprintf('%d:%02d', $minutes, $remaining);
    }

    /**
     * @param \Illuminate\Support\Collection<int, object> $logs
     * @return array<string, mixed>
     */
    private function liveSeries($logs, int $limit): array
    {
        $hourly = [];
        $daily = [];
        $maxCurrent = null;

        foreach ($logs as $log) {
            $date = substr((string) ($log->the_date ?? ''), 0, 10);
            $maxCurrent = max($maxCurrent ?? 0, (int) ($log->max_current ?? 0));
            $decoded = json_decode((string) ($log->log_json ?? ''), true);

            if (! is_array($decoded) || $date === '') {
                continue;
            }

            foreach ($decoded as $time => $views) {
                $value = (int) $views;
                $hour = date('Y-m-d H:00:00', strtotime($date.' '.$time.':00'));
                $hourly[$hour] = max($hourly[$hour] ?? 0, $value);
                $daily[$date] = max($daily[$date] ?? 0, $value);
            }
        }

        ksort($hourly);
        ksort($daily);

        return [
            'available' => $logs->isNotEmpty(),
            'log_rows' => $logs->count(),
            'max_current' => $maxCurrent,
            'hourly' => $this->formatSeries(array_slice($hourly, -$limit, null, true), 'm-d H'),
            'daily' => $this->formatSeries(array_slice($daily, -$limit, null, true), 'Y-m-d'),
        ];
    }

    /**
     * @param \Illuminate\Support\Collection<int, object> $logs
     * @return array{available: bool, rows: list<array<string, int|string|null>>, log_rows: int}
     */
    private function videoHistory($logs, int $limit): array
    {
        $rows = [];

        foreach ($logs as $log) {
            $decoded = json_decode((string) ($log->thedata ?? ''), true);

            if (! is_array($decoded)) {
                continue;
            }

            foreach ($decoded as $date => $values) {
                if (! is_array($values)) {
                    continue;
                }

                $rows[(string) $date] = [
                    'date' => (string) $date,
                    'view' => isset($values['view']) ? (int) $values['view'] : null,
                    'like' => isset($values['like']) ? (int) $values['like'] : null,
                    'comment' => isset($values['comment']) ? (int) $values['comment'] : null,
                ];
            }
        }

        ksort($rows);

        return [
            'available' => $logs->isNotEmpty(),
            'rows' => array_values(array_slice($rows, -$limit, null, true)),
            'log_rows' => $logs->count(),
        ];
    }

    private function commentSummary(?object $comment, int $limit): array
    {
        if (! $comment) {
            return $this->emptyComments(true);
        }

        $comments = $this->decodeMap($comment->comments_json ?? null);
        $authors = $this->decodeMap($comment->authors_json ?? null);
        $hourly = [];
        $daily = [];
        $authorRows = [];
        $commentRows = [];

        foreach ($comments as $id => $item) {
            if (! is_array($item)) {
                continue;
            }

            $this->addCommentPoint($item, $authors, $hourly, $daily, $authorRows, $commentRows);

            foreach (($item['replies'] ?? []) as $reply) {
                if (is_array($reply)) {
                    $this->addCommentPoint($reply, $authors, $hourly, $daily, $authorRows, $commentRows, true);
                }
            }
        }

        ksort($hourly);
        ksort($daily);

        $authorsTotal = count($authorRows);
        $commentsTotal = count($commentRows);

        $authorsRanked = collect($authorRows)
            ->sortByDesc('total')
            ->take($limit)
            ->values()
            ->all();

        $commentRows = collect($commentRows)
            ->sortByDesc('like_count')
            ->take($limit)
            ->values()
            ->all();

        return [
            'available' => true,
            'row' => [
                'comments_count' => $comment->comments_count !== null ? (int) $comment->comments_count : $commentsTotal,
                'authors_count' => $comment->authors_count !== null ? (int) $comment->authors_count : $authorsTotal,
                'threads_count' => $comment->threads_count !== null ? (int) $comment->threads_count : null,
                'replies_count' => $comment->replies_count !== null ? (int) $comment->replies_count : null,
                'likes_count' => $comment->likes_count !== null ? (int) $comment->likes_count : null,
                'latest_time' => $comment->latest_time ?? null,
                'mtime' => $comment->mtime ?? null,
            ],
            'hourly' => $this->formatSeries(array_slice($hourly, -$limit, null, true), 'm-d H'),
            'daily' => $this->formatSeries(array_slice($daily, -$limit, null, true), 'Y-m-d'),
            'authors' => $authorsRanked,
            'comments' => $commentRows,
        ];
    }

    /**
     * @param array<string, int> $hourly
     * @param array<string, int> $daily
     * @param array<string, array<string, mixed>> $authorRows
     * @param list<array<string, mixed>> $commentRows
     */
    private function addCommentPoint(array $item, array $authors, array &$hourly, array &$daily, array &$authorRows, array &$commentRows, bool $reply = false): void
    {
        $publishedAt = (string) ($item['publishedAt'] ?? '');
        $timestamp = strtotime($publishedAt);

        if ($timestamp > 0) {
            $moment = Carbon::createFromTimestamp($timestamp, 'Asia/Taipei');
            $hour = $moment->format('Y-m-d H:00:00');
            $date = $moment->format('Y-m-d');
            $hourly[$hour] = ($hourly[$hour] ?? 0) + 1;
            $daily[$date] = ($daily[$date] ?? 0) + 1;
        }

        $authorId = (string) ($item['authorChannelId'] ?? '');
        $author = is_array($authors[$authorId] ?? null) ? $authors[$authorId] : [];

        if ($authorId !== '') {
            $authorRows[$authorId] ??= [
                'author_id' => $authorId,
                'name' => (string) ($author['DisplayName'] ?? $author['displayName'] ?? $authorId),
                'url' => (string) ($author['ChannelUrl'] ?? $author['channelUrl'] ?? ''),
                'image' => (string) ($author['ImageUrl'] ?? $author['imageUrl'] ?? ''),
                'comments' => 0,
                'replies' => 0,
                'likes' => 0,
                'total' => 0,
            ];
            $authorRows[$authorId][$reply ? 'replies' : 'comments']++;
            $authorRows[$authorId]['likes'] += (int) ($item['likeCount'] ?? 0);
            $authorRows[$authorId]['total']++;
        }

        $commentRows[] = [
            'author_id' => $authorId,
            'author_name' => (string) ($author['DisplayName'] ?? $author['displayName'] ?? $authorId),
            'text' => trim(strip_tags((string) ($item['textDisplay'] ?? $item['textOriginal'] ?? ''))),
            'like_count' => (int) ($item['likeCount'] ?? 0),
            'published_at' => $publishedAt,
            'is_reply' => $reply,
        ];
    }

    private function emptyLive(): array
    {
        return [
            'available' => false,
            'log_rows' => 0,
            'max_current' => null,
            'hourly' => [],
            'daily' => [],
        ];
    }

    private function emptyComments(bool $tableAvailable): array
    {
        return [
            'available' => $tableAvailable,
            'row' => null,
            'hourly' => [],
            'daily' => [],
            'authors' => [],
            'comments' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMap(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<string, int> $series
     * @return list<array{label: string, value: int}>
     */
    private function formatSeries(array $series, string $format): array
    {
        return collect($series)
            ->map(fn (int $value, string $label): array => [
                'label' => date($format, strtotime($label)),
                'value' => $value,
            ])
            ->values()
            ->all();
    }
}
