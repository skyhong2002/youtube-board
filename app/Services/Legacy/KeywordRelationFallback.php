<?php

namespace App\Services\Legacy;

use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class KeywordRelationFallback
{
    private const KEYWORD_LIMIT = 5000;
    private const VIDEO_LIMIT = 10000;

    /**
     * @var array<string, list<string>>
     */
    private array $keywordCache = [];

    /**
     * @param list<string> $dates
     * @param array{tagid?: list<int>, or?: list<int>, not?: list<int>} $filters
     * @return list<object>
     */
    public function relationRecords(string $keyword, array $dates, array $filters = []): array
    {
        try {
            $keywords = $this->keywords($keyword);
            $videosByDate = $this->matchingVideosByDate($keyword, $dates, $filters);
        } catch (QueryException) {
            return [];
        }

        if ($keywords === [] || $videosByDate === []) {
            return [];
        }

        $records = [];

        foreach ($dates as $date) {
            $record = $this->relationRecordForDate($keyword, $date, $videosByDate[$date] ?? [], $keywords);

            if ($record !== null) {
                $records[] = $record;
            }
        }

        return $records;
    }

    /**
     * @param list<string> $dates
     * @return list<string>
     */
    public function videoIds(string $keyword, array $dates): array
    {
        try {
            return collect($this->matchingVideosByDate($keyword, $dates))
                ->flatten(1)
                ->pluck('videoId')
                ->map(fn (mixed $videoId): string => trim((string) $videoId))
                ->filter(fn (string $videoId): bool => $videoId !== '')
                ->unique()
                ->values()
                ->all();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @param array{tagid?: list<int>, or?: list<int>, not?: list<int>} $filters
     * @return array{available: bool, source: string, counts: array{channels: int, videos: int, tags: int, tags_count: int}, mtime: string|null, words: array<string, float>}
     */
    public function cloud(string $keyword, array $filters, int $days): array
    {
        $dates = $this->datesForDays($days);

        try {
            $keywords = $this->keywords($keyword);
            $videos = collect($this->matchingVideosByDate($keyword, $dates, $filters))
                ->flatten(1)
                ->all();
        } catch (QueryException) {
            return $this->emptyCloud();
        }

        if ($keywords === [] || $videos === []) {
            return $this->emptyCloud();
        }

        $tagData = [];
        $channels = [];
        $countTags = 0;
        $tagsCount = 0;
        $selectedVideos = 0;

        foreach ($videos as $video) {
            $counts = $this->detectKeywords($video, $keywords);
            $keywordCount = $counts[$keyword] ?? 0;
            $sum = array_sum($counts);

            if ($keywordCount <= 0 || $sum <= 0) {
                continue;
            }

            $selectedVideos++;
            $uId = (int) ($video->u_id ?? 0);
            $channels[$uId] = true;
            $views = max(0, (int) ($video->viewCount ?? 0));
            $factor = sqrt($keywordCount / $sum);
            $countTags += $sum;
            $tagsCount += count($counts);

            foreach ($counts as $tag => $count) {
                if (! isset($tagData[$tag])) {
                    $tagData[$tag] = [
                        'videos' => 0,
                        'views' => 0,
                        'weight' => 0.0,
                    ];
                }

                $tagData[$tag]['videos']++;
                $tagData[$tag]['views'] += $views;
                $tagData[$tag]['weight'] += $views * $factor;
            }
        }

        $words = collect($tagData)
            ->mapWithKeys(fn (array $row, string $tag): array => [$tag => round((float) $row['weight'], 2)])
            ->filter(fn (float $weight): bool => $weight > 0)
            ->sortDesc()
            ->all();

        return [
            'available' => $words !== [],
            'source' => 'urt_video + tags derived read-only',
            'counts' => [
                'channels' => count(array_filter(array_keys($channels), fn (int $uId): bool => $uId > 0)),
                'videos' => $selectedVideos,
                'tags' => $countTags,
                'tags_count' => $tagsCount,
            ],
            'mtime' => $words === [] ? null : now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'words' => $words,
        ];
    }

    /**
     * @param list<string> $dates
     * @param array{tagid?: list<int>, or?: list<int>, not?: list<int>} $filters
     * @return array<string, list<object>>
     */
    private function matchingVideosByDate(string $keyword, array $dates, array $filters = []): array
    {
        $dates = collect($dates)
            ->filter(fn (string $date): bool => preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1)
            ->sort()
            ->values()
            ->all();

        if ($keyword === '' || $dates === [] || ! Schema::hasTable('urt_video')) {
            return [];
        }

        $columns = $this->videoColumns();

        if (! in_array('publishedAt', $columns, true) || ! in_array('videoId', $columns, true)) {
            return [];
        }

        if (! in_array('title', $columns, true) && ! in_array('description', $columns, true)) {
            return [];
        }

        $channelIds = $this->channelIdsForFilters($filters);

        if ($channelIds === []) {
            return [];
        }

        $from = $dates[0].' 00:00:00';
        $to = $dates[count($dates) - 1].' 23:59:59';
        $like = '%'.$this->escapeLike($keyword).'%';

        $query = DB::table('urt_video')
            ->select($columns)
            ->whereBetween('publishedAt', [$from, $to])
            ->where(function (Builder $query) use ($columns, $like): void {
                if (in_array('title', $columns, true)) {
                    $query->orWhere('title', 'like', $like);
                }

                if (in_array('description', $columns, true)) {
                    $query->orWhere('description', 'like', $like);
                }
            });

        if ($channelIds !== null) {
            $query->whereIn('u_id', $channelIds);
        }

        $rows = $query
            ->orderByDesc('publishedAt')
            ->limit(self::VIDEO_LIMIT)
            ->get();

        return $rows
            ->groupBy(fn (object $row): string => substr((string) ($row->publishedAt ?? ''), 0, 10))
            ->map(fn ($rows): array => $rows->values()->all())
            ->all();
    }

    /**
     * @return list<string>
     */
    private function videoColumns(): array
    {
        $candidates = [
            'pk',
            'u_id',
            'videoId',
            'publishedAt',
            'title',
            'description',
            'viewCount',
            'likeCount',
            'commentCount',
            'thumbnails',
            'channelTitle',
        ];

        return collect($candidates)
            ->filter(fn (string $column): bool => Schema::hasColumn('urt_video', $column))
            ->values()
            ->all();
    }

    /**
     * @param array{tagid?: list<int>, or?: list<int>, not?: list<int>} $filters
     * @return list<int>|null
     */
    private function channelIdsForFilters(array $filters): ?array
    {
        $tagIds = $this->normalizedIds($filters['tagid'] ?? []);
        $orTagIds = $this->normalizedIds($filters['or'] ?? []);
        $notTagIds = $this->normalizedIds($filters['not'] ?? []);

        if ($tagIds === [] && $orTagIds === [] && $notTagIds === []) {
            return null;
        }

        if (! Schema::hasTable('urt_count')) {
            return [];
        }

        $query = DB::table('urt_count')->select('u_id');

        if ($orTagIds !== []) {
            $query->where(function (Builder $query) use ($orTagIds): void {
                foreach ($orTagIds as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($tagIds as $tagId) {
            $query->where('tags', 'like', '%['.$tagId.']%');
        }

        if ($notTagIds !== []) {
            $query->where(function (Builder $query) use ($notTagIds): void {
                foreach ($notTagIds as $tagId) {
                    $query->where('tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        return $query
            ->pluck('u_id')
            ->map(fn (mixed $uId): int => (int) $uId)
            ->filter(fn (int $uId): bool => $uId > 0)
            ->values()
            ->all();
    }

    /**
     * @return list<int>
     */
    private function normalizedIds(array $ids): array
    {
        return collect($ids)
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function keywords(string $subject): array
    {
        $cacheKey = $subject;

        if (isset($this->keywordCache[$cacheKey])) {
            return $this->keywordCache[$cacheKey];
        }

        if (! Schema::hasTable('tags') || ! Schema::hasColumn('tags', 'tag')) {
            return $this->keywordCache[$cacheKey] = [];
        }

        $query = DB::table('tags')->select('tag');

        if (Schema::hasColumn('tags', 'no_tag')) {
            $query->where(function (Builder $query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', '<', 1);
            });
        }

        if (Schema::hasColumn('tags', 'hours_count')) {
            $query->orderByDesc('hours_count');
        } else {
            $query->orderBy('tag');
        }

        $keywords = $query
            ->limit(self::KEYWORD_LIMIT)
            ->pluck('tag')
            ->map(fn (mixed $tag): string => trim((string) $tag))
            ->filter(fn (string $tag): bool => $this->eligibleKeyword($tag))
            ->values()
            ->all();

        if ($subject !== '' && $this->eligibleKeyword($subject) && ! in_array($subject, $keywords, true)) {
            $keywords[] = $subject;
        }

        return $this->keywordCache[$cacheKey] = $keywords;
    }

    private function eligibleKeyword(string $keyword): bool
    {
        if ($keyword === '' || mb_strlen($keyword, 'UTF-8') <= 1 || is_numeric($keyword)) {
            return false;
        }

        return preg_match('/^[A-Za-z]+$/', $keyword) !== 1 || strlen($keyword) >= 3;
    }

    /**
     * @param list<string> $keywords
     * @return array<string, int>
     */
    private function detectKeywords(object $video, array $keywords): array
    {
        $text = ' '.(string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');

        if (trim($text) === '') {
            return [];
        }

        $counts = [];
        $lengths = [];

        foreach ($keywords as $keyword) {
            $count = substr_count($text, $keyword);

            if ($count > 0) {
                $counts[$keyword] = $count;
                $lengths[$keyword] = mb_strlen($keyword, 'UTF-8');
            }
        }

        arsort($lengths);
        $ordered = array_keys($lengths);

        for ($i = 0; $i < count($ordered); $i++) {
            for ($j = $i + 1; $j < count($ordered); $j++) {
                $longer = $ordered[$i];
                $shorter = $ordered[$j];

                if (isset($counts[$shorter]) && str_contains($longer, $shorter)) {
                    $counts[$shorter] -= $counts[$longer] ?? 0;
                }
            }
        }

        return collect($counts)
            ->filter(fn (int $count): bool => $count > 0)
            ->sortDesc()
            ->all();
    }

    /**
     * @param list<object> $videos
     */
    private function relationRecordForDate(string $keyword, string $date, array $videos, array $keywords): ?object
    {
        $tagVideos = [];
        $videosById = [];
        $channels = [];

        foreach ($videos as $video) {
            $counts = $this->detectKeywords($video, $keywords);

            if (($counts[$keyword] ?? 0) <= 0) {
                continue;
            }

            $videoId = trim((string) ($video->videoId ?? ''));

            if ($videoId === '') {
                continue;
            }

            $uId = (int) ($video->u_id ?? 0);
            $videosById[$videoId] = $uId;
            $channels[$uId] = true;

            foreach ($counts as $tag => $count) {
                $tagVideos[$tag] = ($tagVideos[$tag] ?? 0) + 1;
            }
        }

        if ($videosById === []) {
            return null;
        }

        arsort($tagVideos);

        return (object) [
            'the_date' => $date,
            'count_channels' => count(array_filter(array_keys($channels), fn (int $uId): bool => $uId > 0)),
            'count_videos' => count($videosById),
            'count_tags' => count($tagVideos),
            'videos_json' => json_encode($videosById, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'tags_json' => json_encode($tagVideos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }

    /**
     * @return list<string>
     */
    private function datesForDays(int $days): array
    {
        $today = now('Asia/Taipei')->startOfDay();
        $dates = [];

        for ($i = 0; $i <= $days; $i++) {
            $dates[] = $today->copy()->subDays($i)->toDateString();
        }

        sort($dates);

        return $dates;
    }

    /**
     * @return array{available: false, source: string, counts: array{channels: int, videos: int, tags: int, tags_count: int}, mtime: null, words: array<string, float>}
     */
    private function emptyCloud(): array
    {
        return [
            'available' => false,
            'source' => 'urt_video + tags derived read-only',
            'counts' => [
                'channels' => 0,
                'videos' => 0,
                'tags' => 0,
                'tags_count' => 0,
            ],
            'mtime' => null,
            'words' => [],
        ];
    }

    private function escapeLike(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}
