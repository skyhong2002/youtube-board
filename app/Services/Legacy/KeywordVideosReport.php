<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class KeywordVideosReport
{
    public function __construct(private readonly KeywordRelationFallback $keywordRelationFallback)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forKeyword(Request $request, string $keyword): array
    {
        $keyword = trim(urldecode($keyword)) ?: '楊丞琳';
        $days = max(1, min(90, (int) $request->query('days', 7)));
        $hours = max(1, min(8760, (int) $request->query('hours', 24)));
        $limit = max(1, min(1000, (int) $request->query('limit', 1000)));
        $dates = $this->dates($days);
        $cacheRows = 0;
        $videoIds = [];
        $source = 'urt_show_video_tag_date cache';
        $queryExceptionReason = null;

        try {
            $records = DB::table('urt_show_video_tag_date')
                ->where('tag', $keyword)
                ->whereIn('the_date', $dates)
                ->orderByDesc('the_date')
                ->orderByDesc('pk')
                ->get();

            $seenDates = [];

            foreach ($records as $record) {
                $date = (string) ($record->the_date ?? '');

                if ($date === '' || isset($seenDates[$date])) {
                    continue;
                }

                $seenDates[$date] = true;
                $cacheRows++;

                foreach ($this->decodeVideos($record->videos_json ?? null) as $videoId) {
                    $videoIds[$videoId] = $videoId;
                }
            }
        } catch (QueryException) {
            $queryExceptionReason = 'local keyword-video relation cache is missing or empty; legacy `api/tags_relation_date.php` generation is intentionally not run';
        }

        $rows = $this->videoRows(array_values($videoIds), $limit);

        if ($rows === []) {
            $derivedVideoIds = $this->keywordRelationFallback->videoIds($keyword, $dates);
            $derivedRows = $this->videoRows($derivedVideoIds, $limit);

            if ($derivedRows !== []) {
                $rows = $derivedRows;
                $source = 'urt_video title/description derived real-time YouTube dashboard';
                $queryExceptionReason = null;
            }
        }

        return $this->payload($keyword, $days, $hours, $limit, $dates, $cacheRows, $rows, $queryExceptionReason, $source);
    }

    /**
     * @param list<string> $dates
     * @param list<array<string, mixed>> $rows
     * @return array<string, mixed>
     */
    private function payload(
        string $keyword,
        int $days,
        int $hours,
        int $limit,
        array $dates,
        int $cacheRows,
        array $rows,
        ?string $queryExceptionReason,
        string $source,
    ): array {
        $blockedReason = $queryExceptionReason;

        if ($blockedReason === null && $rows === []) {
            $blockedReason = $cacheRows > 0
                ? 'local keyword relation cache exists, but matching `urt_video` rows are missing'
                : 'local keyword-video relation cache and raw video/title fallback are empty; legacy `api/tags_relation_date.php` generation is intentionally not run';
        }

        return [
            'keyword' => $keyword,
            'title' => $keyword.' 在 '.$hours.'小時內觀看最多的影片',
            'section_title' => '關鍵字影片',
            'legacy_file' => 'tag_video.php + api/tags_relation_date.php',
            'rows' => $rows,
            'data_available' => $rows !== [],
            'blocked_reason' => $blockedReason,
            'cache_rows' => $cacheRows,
            'source' => $source,
            'filters' => [
                'tag' => $keyword,
                'days' => $days,
                'hours' => $hours,
                'limit' => $limit,
            ],
            'days' => $days,
            'hours' => $hours,
            'limit' => $limit,
            'dates' => $dates,
            'dependencies' => collect(['urt_show_video_tag_date', 'urt_video'])
                ->map(fn (string $table): array => $this->dependency($table))
                ->values()
                ->all(),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param list<string> $videoIds
     * @return list<array<string, mixed>>
     */
    private function videoRows(array $videoIds, int $limit): array
    {
        if ($videoIds === []) {
            return [];
        }

        return DB::table('urt_video')
            ->whereIn('videoId', $videoIds)
            ->orderByDesc('viewCount')
            ->limit($limit)
            ->get()
            ->map(function (object $row, int $index): array {
                return [
                    'rank' => $index + 1,
                    'video_id' => (string) ($row->videoId ?? ''),
                    'u_id' => (int) ($row->u_id ?? 0),
                    'thumbnail' => $row->thumbnails ?? null,
                    'channel_title' => (string) ($row->channelTitle ?? ''),
                    'published_at' => (string) ($row->publishedAt ?? ''),
                    'title' => (string) ($row->title ?? ''),
                    'view_count' => (int) ($row->viewCount ?? 0),
                    'like_count' => (int) ($row->likeCount ?? 0),
                    'comment_count' => (int) ($row->commentCount ?? 0),
                    'youtube_url' => 'https://www.youtube.com/watch?v='.($row->videoId ?? ''),
                ];
            })
            ->all();
    }

    /**
     * @return list<string>
     */
    private function decodeVideos(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        foreach (['videos', 'videos_json', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        if (array_is_list($decoded)) {
            return collect($decoded)
                ->map(function (mixed $item): string {
                    if (is_array($item)) {
                        return trim((string) ($item['videoId'] ?? $item['video_id'] ?? $item['id'] ?? ''));
                    }

                    return trim((string) $item);
                })
                ->filter(fn (string $videoId): bool => $videoId !== '')
                ->values()
                ->all();
        }

        return collect($decoded)
            ->keys()
            ->map(fn (mixed $videoId): string => trim((string) $videoId))
            ->filter(fn (string $videoId): bool => $videoId !== '')
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function dates(int $days): array
    {
        $today = now('Asia/Taipei')->startOfDay();
        $dates = [];

        for ($i = 0; $i <= $days; $i++) {
            $dates[] = $today->copy()->subDays($i)->toDateString();
        }

        return $dates;
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
}
