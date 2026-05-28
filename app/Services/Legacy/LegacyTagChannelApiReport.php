<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use stdClass;

class LegacyTagChannelApiReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function tagsList(): array
    {
        try {
            $rows = DB::table('urt_tag')
                ->orderBy('tag_id')
                ->pluck('tag_name', 'tag_id')
                ->mapWithKeys(fn (string $name, int|string $id): array => [(int) $id => $name])
                ->all();

            return [
                'result' => $rows,
                'meta' => [
                    'available' => $rows !== [],
                    'source' => 'urt_tag',
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult('urt_tag');
        }
    }

    /**
     * @return array<int, string>
     */
    public function tagMap(): array
    {
        try {
            return DB::table('urt_tag')
                ->orderBy('tag_id')
                ->pluck('tag_name', 'tag_id')
                ->mapWithKeys(fn (string $name, int|string $id): array => [(int) $id => $name])
                ->all();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagsIndex(Request $request): array
    {
        $limit = max(1, min(5000, (int) $request->query('limit', 500)));
        $sort = $this->keywordSort($request);

        try {
            $now = now('Asia/Taipei');
            $rows = DB::table('tags')
                ->where(function ($query): void {
                    $query->whereNull('no_tag')
                        ->orWhere('no_tag', '<', 1);
                })
                ->limit(10000)
                ->get()
                ->mapWithKeys(function (object $row) use ($now): array {
                    $tag = (string) $row->tag;
                    $hoursCount = (int) ($row->hours_count ?? 0);
                    $maxCount = (int) ($row->max_count ?? 0);
                    $maxHours = (string) ($row->max_hours ?? now('Asia/Taipei')->toDateTimeString());
                    $periodDays = max(1 / 24, $now->diffInSeconds($maxHours, true) / 86400);
                    $weight = $hoursCount > 1 && $maxCount > 1
                        ? sqrt(max(0, log($hoursCount) / $periodDays * log($maxCount) * 100))
                        : 0.0;

                    return [$tag => [
                        'pk' => (int) ($row->pk ?? 0),
                        'tag' => $tag,
                        'ctime' => (string) ($row->ctime ?? ''),
                        'mtime' => (string) ($row->mtime ?? ''),
                        'max_count' => $maxCount,
                        'hours_count' => $hoursCount,
                        'max_hours' => $maxHours,
                        'no_tag' => $row->no_tag === null ? null : (int) $row->no_tag,
                        'weight' => round($weight, 3),
                    ]];
                })
                ->sortByDesc(fn (array $row): int|float|string => $row[$sort] ?? $row['weight'])
                ->take($limit)
                ->all();

            return [
                'result' => $rows,
                'meta' => [
                    'available' => $rows !== [],
                    'source' => 'tags',
                    'sort' => $sort,
                    'limit' => $limit,
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult('tags', ['sort' => $sort, 'limit' => $limit]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagsAll(): array
    {
        try {
            $row = DB::table('urt_show_data')
                ->where('data_name', 'tags_all')
                ->first();
            $result = $this->decodeMetricMap($row->the_result ?? null);

            return [
                'result' => $result === [] ? new stdClass() : $result,
                'meta' => [
                    'available' => $result !== [],
                    'source' => 'urt_show_data.tags_all',
                    'mtime' => $row->mtime ?? null,
                    'realtime_dashboard' => true,
                    'blocked_reason' => $result === [] ? 'local tags_all cache is empty; legacy force mode is intentionally not run' : null,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult('urt_show_data.tags_all');
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function videoTags(Request $request, bool $titleOnly = false): array
    {
        $pk = max(0, (int) $request->query('pk', 17));
        $videoId = trim((string) $request->query('videoId', ''));
        $cacheTable = $titleOnly ? 'urt_show_video_tag_title' : 'urt_show_video_tag';

        try {
            $video = $this->videoRow($pk, $videoId);
            $cache = $video
                ? DB::table($cacheTable)->where('pk_video', $video->pk)->first()
                : null;
            $cached = $this->decodeMap($cache->tags_json ?? null);

            if ($cached !== []) {
                return [
                    'result' => $cached,
                    'meta' => [
                        'available' => true,
                        'source' => $cacheTable.'.tags_json',
                        'pk' => (int) ($video->pk ?? $pk),
                        'videoId' => (string) ($video->videoId ?? $videoId),
                        'realtime_dashboard' => true,
                    ],
                ];
            }

            $computed = $video ? $this->detectVideoKeywords($video, $titleOnly) : [];

            return [
                'result' => $computed === [] ? new stdClass() : $computed,
                'meta' => [
                    'available' => $computed !== [],
                    'source' => 'tags table computed real-time YouTube dashboard',
                    'cache_table' => $cacheTable,
                    'pk' => (int) ($video->pk ?? $pk),
                    'videoId' => (string) ($video->videoId ?? $videoId),
                    'title_only' => $titleOnly,
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult($cacheTable, ['pk' => $pk, 'videoId' => $videoId, 'title_only' => $titleOnly]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function channelsList(Request $request): array
    {
        try {
            $filters = $this->tagFilter->filters($request);
            $limit = max(1, min(1000, (int) $request->query('limit', $filters['limit'])));
            $channelIds = $this->tagFilter->matchingChannelTags($filters)->pluck('u_id')->all();

            $rows = $channelIds === []
                ? []
                : DB::table('urt_channel')
                    ->whereIn('u_id', $channelIds)
                    ->orderByDesc('viewCount')
                    ->limit($limit)
                    ->get()
                    ->map(fn (object $row): array => (array) $row)
                    ->all();

            return [
                'result' => $rows,
                'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'count_channels' => count($rows),
                'meta' => [
                    'available' => $rows !== [],
                    'source' => 'urt_channel + urt_count',
                    'filters' => $filters,
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->listPayload([], 'urt_channel + urt_count', ['count_channels' => 0]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function channelVideos(Request $request): array
    {
        $uId = max(0, (int) $request->query('u_id', 0));

        try {
            $rows = $this->videoRows(
                uIds: $uId > 0 ? [$uId] : [],
                hours: max(1, min(8760, (int) $request->query('hours', 24))),
                min: max(0, (int) $request->query('min', 100)),
                limit: max(1, min(1000, (int) $request->query('limit', 1000))),
                includeComments: (int) $request->query('comments', 0) > 0,
            );

            return $this->videoListPayload($rows, 'urt_video by channel', $request);
        } catch (QueryException) {
            return $this->videoListPayload([], 'urt_video by channel', $request, false);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function channelsVideos(Request $request): array
    {
        try {
            $filters = $this->tagFilter->filters($request);
            $uIds = $this->tagFilter->matchingChannelTags($filters)->pluck('u_id')->all();
            $rows = $this->videoRows(
                uIds: $uIds,
                hours: max(1, min(8760, (int) $request->query('hours', 72))),
                min: max(0, (int) $request->query('min', 100)),
                limit: max(1, min(1000, (int) $request->query('limit', $filters['limit']))),
                includeComments: (int) $request->query('comments', 0) > 0,
            );

            return $this->videoListPayload($rows, 'urt_video + urt_count', $request, true, ['filters' => $filters]);
        } catch (QueryException) {
            return $this->videoListPayload([], 'urt_video + urt_count', $request, false);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagLog(Request $request): array
    {
        $tag = trim((string) $request->query('tag', ''));
        $limit = max(1, min(1000, (int) $request->query('limit', 1000)));

        try {
            $query = DB::table('urt_log_tag')
                ->orderBy('ctime')
                ->limit($limit);

            if ($tag !== '') {
                $query->where('tag', $tag);
            }

            $rows = $query->get();
            $result = [];

            foreach ($rows as $row) {
                $date = substr((string) $row->ctime, 0, 10);

                if (! isset($result[$date])) {
                    $result[$date] = ['hits' => 0, 'rows' => []];
                }

                $result[$date]['hits'] += (int) ($row->hits ?? 0);
                $result[$date]['rows'][] = (array) $row;
            }

            return [
                'result' => $result === [] ? new stdClass() : $result,
                'meta' => [
                    'available' => $result !== [],
                    'source' => 'urt_log_tag',
                    'tag' => $tag,
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult('urt_log_tag', ['tag' => $tag]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagCloud(Request $request): array
    {
        $filters = $this->sortedTagFilters($request);
        $days = max(1, min(365, (int) $request->query('days', 3)));

        try {
            $query = DB::table('urt_show_tag_cloud')
                ->where('days', $days)
                ->where('tags_count', '>', 0)
                ->orderByDesc('pk');
            $this->applyCacheFilters($query, $filters);
            $row = $query->first();
            $result = $this->decodeWeightedMap($row->tags_result ?? null);

            return $this->tagCachePayload($result, 'urt_show_tag_cloud', [
                'filters' => $filters,
                'days' => $days,
                'counts' => [
                    'channels' => (int) ($row->count_channels ?? 0),
                    'videos' => (int) ($row->count_videos ?? 0),
                    'tags' => (int) ($row->count_tags ?? 0),
                    'tags_count' => (int) ($row->tags_count ?? 0),
                ],
                'mtime' => $row->mtime ?? null,
            ]);
        } catch (QueryException) {
            return $this->emptyResult('urt_show_tag_cloud', ['filters' => $filters, 'days' => $days]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagRelationDate(Request $request): array
    {
        $tag = trim((string) $request->query('tag', '蔡英文')) ?: '蔡英文';
        $date = $this->dateQuery($request, 'date', now('Asia/Taipei')->subDay()->toDateString());

        try {
            $row = DB::table('urt_show_video_tag_date')
                ->where('the_date', $date)
                ->where('tag', $tag)
                ->first();

            return [
                'count_channels' => (int) ($row->count_channels ?? 0),
                'count_videos' => (int) ($row->count_videos ?? 0),
                'count_tags' => (int) ($row->count_tags ?? 0),
                'result' => $this->decodeWeightedMap($row->tags_json ?? null),
                'videos' => $this->decodeWeightedMap($row->videos_json ?? null),
                'meta' => [
                    'available' => $row !== null,
                    'source' => 'urt_show_video_tag_date',
                    'tag' => $tag,
                    'date' => $date,
                    'mtime' => $row->mtime ?? null,
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult('urt_show_video_tag_date', ['tag' => $tag, 'date' => $date]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagMonth(Request $request): array
    {
        $filters = $this->sortedTagFilters($request);
        $tag = trim((string) $request->query('tag', '蔡英文')) ?: '蔡英文';
        $month = $this->monthQuery($request, 'month', now('Asia/Taipei')->format('Y-m-01'));

        try {
            $query = DB::table('urt_show_tag_month')
                ->where('tag', $tag)
                ->where('the_month', $month);
            $this->applyCacheFilters($query, $filters);
            $row = $query->first();
            $result = $this->decodeDateMetricMap($row->tags_result ?? null);

            return $this->tagCachePayload($result, 'urt_show_tag_month', [
                'filters' => $filters,
                'tag' => $tag,
                'month' => $month,
                'count_videos' => (int) ($row->count_videos ?? 0),
                'total_views' => (int) ($row->total_views ?? 0),
                'mtime' => $row->mtime ?? null,
            ]);
        } catch (QueryException) {
            return $this->emptyResult('urt_show_tag_month', ['filters' => $filters, 'tag' => $tag, 'month' => $month]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagPeriod(Request $request): array
    {
        $filters = $this->sortedTagFilters($request);
        $tag = trim((string) $request->query('tag', '蔡英文')) ?: '蔡英文';
        $days = max(1, min(1095, (int) $request->query('days', 60)));
        $fromMonth = now('Asia/Taipei')->subDays($days)->format('Y-m-01');
        $toMonth = now('Asia/Taipei')->format('Y-m-01');

        try {
            $query = DB::table('urt_show_tag_month')
                ->where('tag', $tag)
                ->whereBetween('the_month', [$fromMonth, $toMonth])
                ->orderBy('the_month');
            $this->applyCacheFilters($query, $filters);
            $rows = $query->get();
            $result = [];

            foreach ($rows as $row) {
                $result = array_replace($result, $this->decodeDateMetricMap($row->tags_result ?? null));
            }

            return $this->tagCachePayload($result, 'urt_show_tag_month period', [
                'filters' => $filters,
                'tag' => $tag,
                'days' => $days,
                'from_month' => $fromMonth,
                'to_month' => $toMonth,
            ]);
        } catch (QueryException) {
            return $this->emptyResult('urt_show_tag_month period', ['filters' => $filters, 'tag' => $tag, 'days' => $days]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function tagTagsDays(Request $request): array
    {
        $filters = $this->sortedTagFilters($request);
        $tag = trim((string) $request->query('tag', '柯文哲')) ?: '柯文哲';
        $days = max(1, min(365, (int) $request->query('days', 3)));

        try {
            $query = DB::table('urt_show_tag_cloud_tag')
                ->where('tag', $tag)
                ->where('days', $days);
            $this->applyCacheFilters($query, $filters);
            $row = $query->first();
            $result = $this->decodeWrappedMap($row->tags_result ?? null, ['tags_result', 'tags', 'result', 'data']);

            return [
                'result' => $result === [] ? new stdClass() : $result,
                'time' => $row->mtime ?? null,
                'count_channels' => (int) ($row->count_channels ?? 0),
                'count_videos' => (int) ($row->count_videos ?? 0),
                'count_tags' => (int) ($row->count_tags ?? 0),
                'tags_count' => (int) ($row->tags_count ?? 0),
                'videos' => $this->decodeWrappedMap($row->videos_json ?? null, ['videos_json', 'videos', 'result', 'data']),
                'meta' => [
                    'available' => $row !== null && $result !== [],
                    'source' => 'urt_show_tag_cloud_tag',
                    'filters' => $filters,
                    'tag' => $tag,
                    'days' => $days,
                    'realtime_dashboard' => true,
                ],
            ];
        } catch (QueryException) {
            return $this->emptyResult('urt_show_tag_cloud_tag', ['filters' => $filters, 'tag' => $tag, 'days' => $days]);
        }
    }

    private function keywordSort(Request $request): string
    {
        $sort = (string) $request->query('sort', 'weight');

        return match ($sort) {
            'num' => 'hours_count',
            'max_count', 'hours_count', 'max_hours', 'weight' => $sort,
            default => 'weight',
        };
    }

    /**
     * @return array{tagid: list<int>, or: list<int>, not: list<int>, tagid_string: string, or_string: string, not_string: string}
     */
    private function sortedTagFilters(Request $request): array
    {
        $tagid = $this->sortedIntegers($request->query('tagid'));
        $or = $this->sortedIntegers($request->query('or'));
        $not = $this->sortedIntegers($request->query('not'));

        return [
            'tagid' => $tagid,
            'or' => $or,
            'not' => $not,
            'tagid_string' => implode(',', $tagid),
            'or_string' => implode(',', $or),
            'not_string' => implode(',', $not),
        ];
    }

    /**
     * @return list<int>
     */
    private function sortedIntegers(mixed $value): array
    {
        if (is_array($value)) {
            $items = $value;
        } else {
            $items = explode(',', (string) $value);
        }

        $integers = collect($items)
            ->map(fn (mixed $item): int => (int) trim((string) $item))
            ->filter(fn (int $item): bool => $item > 0)
            ->unique()
            ->values()
            ->all();

        sort($integers);

        return $integers;
    }

    private function videoRow(int $pk, string $videoId): ?object
    {
        $query = DB::table('urt_video');

        if ($videoId !== '') {
            $query->where('videoId', $videoId);
        } else {
            $query->where('pk', $pk);
        }

        return $query->first();
    }

    /**
     * @return array<string, int>
     */
    private function detectVideoKeywords(object $video, bool $titleOnly): array
    {
        $text = ' '.(string) ($video->title ?? '');

        if (! $titleOnly) {
            $text .= ' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');
        }

        if (trim($text) === '') {
            return [];
        }

        $keywords = DB::table('tags')
            ->select(['tag'])
            ->where(function ($query): void {
                $query->whereNull('no_tag')
                    ->orWhere('no_tag', '<', 1);
            })
            ->get()
            ->pluck('tag')
            ->map(fn (mixed $tag): string => (string) $tag)
            ->filter(fn (string $tag): bool => $tag !== '' && str_contains($text, $tag))
            ->values()
            ->all();

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

                if (str_contains($longer, $shorter)) {
                    $counts[$shorter] = ($counts[$shorter] ?? 0) - ($counts[$longer] ?? 0);
                }
            }
        }

        $counts = collect($counts)
            ->filter(fn (int $count): bool => $count > 0)
            ->sortDesc()
            ->all();

        return $counts;
    }

    /**
     * @param list<int> $uIds
     * @return list<array<string, mixed>>
     */
    private function videoRows(array $uIds, int $hours, int $min, int $limit, bool $includeComments): array
    {
        if ($uIds === []) {
            return [];
        }

        $expireTime = now('Asia/Taipei')->subHours($hours)->format('Y-m-d H:i:s');
        $query = DB::table('urt_video')
            ->whereIn('u_id', $uIds)
            ->where('publishedAt', '>=', $expireTime);

        if ($min > 0) {
            $query->where('viewCount', '>=', $min);
        } else {
            $query->where(function ($query): void {
                $query->where('viewCount', '>=', 0)
                    ->orWhereNull('viewCount');
            });
        }

        $rows = $query
            ->orderByDesc('viewCount')
            ->orderByDesc('publishedAt')
            ->limit($limit)
            ->get()
            ->map(fn (object $row): array => (array) $row)
            ->all();

        if ($includeComments) {
            $rows = $this->attachComments($rows);
        }

        return $rows;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function attachComments(array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        $videoIds = collect($rows)->pluck('videoId')->filter()->values()->all();

        try {
            $comments = DB::table('urt_comment')
                ->whereIn('videoId', $videoIds)
                ->get()
                ->keyBy('videoId');
        } catch (QueryException) {
            $comments = collect();
        }

        return collect($rows)
            ->map(function (array $row) use ($comments): array {
                $comment = $comments->get($row['videoId'] ?? '');
                $result = $this->decodeMap($comment->comments_json ?? null);
                $authors = $this->decodeMap($comment->authors_json ?? null);
                $row['comments'] = [
                    'result' => $result,
                    'authors' => $authors,
                    'latest_time' => $comment->latest_time ?? null,
                    'updated' => $comment->mtime ?? null,
                    'videoId' => $row['videoId'] ?? null,
                ];

                return $row;
            })
            ->all();
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     * @param array{tagid_string: string, or_string: string, not_string: string} $filters
     */
    private function applyCacheFilters($query, array $filters): void
    {
        $this->whereNullableEmptyString($query, 'tagid', $filters['tagid_string']);
        $this->whereNullableEmptyString($query, 'tag_or', $filters['or_string']);
        $this->whereNullableEmptyString($query, 'tag_not', $filters['not_string']);
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     */
    private function whereNullableEmptyString($query, string $column, string $value): void
    {
        if ($value !== '') {
            $query->where($column, $value);

            return;
        }

        $query->where(function ($query) use ($column): void {
            $query->where($column, '')
                ->orWhereNull($column);
        });
    }

    private function dateQuery(Request $request, string $key, string $fallback): string
    {
        $date = (string) $request->query($key, $fallback);

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) && $date >= '2010-01-01'
            ? $date
            : $fallback;
    }

    private function monthQuery(Request $request, string $key, string $fallback): string
    {
        $month = (string) $request->query($key, $fallback);

        return preg_match('/^\d{4}-\d{2}-01$/', $month) && $month >= '2010-01-01'
            ? $month
            : $fallback;
    }

    /**
     * @param array<string, mixed> $result
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private function tagCachePayload(array $result, string $source, array $meta): array
    {
        return [
            'result' => $result === [] ? new stdClass() : $result,
            'meta' => $meta + [
                'available' => $result !== [],
                'source' => $source,
                'realtime_dashboard' => true,
                'blocked_reason' => $result === [] ? 'local cache row is missing or empty; legacy generation is intentionally not run' : null,
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMap(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '' || trim($json) === 'null') {
            return [];
        }

        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeMetricMap(mixed $json): array
    {
        $decoded = $this->decodeWrappedMap($json, ['result', 'tags_all', 'data']);

        return collect($decoded)
            ->mapWithKeys(function (mixed $value, mixed $key): array {
                if (is_array($value)) {
                    $tag = (string) ($value['tag'] ?? $value['keyword'] ?? $value['name'] ?? $key);

                    if ($tag === '') {
                        return [];
                    }

                    unset($value['tag'], $value['keyword'], $value['name']);

                    return [$tag => $value];
                }

                return is_string($key) ? [$key => $value] : [];
            })
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeWeightedMap(mixed $json): array
    {
        $decoded = $this->decodeMap($json);

        foreach (['tags_json', 'videos_json', 'tags_result', 'tags_video', 'tags_views', 'tags', 'videos', 'result', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return collect($decoded)
            ->mapWithKeys(function (mixed $value, mixed $key): array {
                if (is_array($value)) {
                    $name = (string) ($value['tag'] ?? $value['keyword'] ?? $value['word'] ?? $value['videoId'] ?? $value['video_id'] ?? $value['id'] ?? $key);
                    $count = $value['count'] ?? $value['weight'] ?? $value['score'] ?? $value['value'] ?? $value['views'] ?? null;

                    return $name !== '' && $count !== null ? [$name => $count] : [];
                }

                return is_string($key) ? [$key => $value] : [];
            })
            ->all();
    }

    /**
     * @param list<string> $wrapperKeys
     * @return array<string, mixed>
     */
    private function decodeWrappedMap(mixed $json, array $wrapperKeys): array
    {
        $decoded = $this->decodeMap($json);

        foreach ($wrapperKeys as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return $decoded[$key];
            }
        }

        return $decoded;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeDateMetricMap(mixed $json): array
    {
        $decoded = $this->decodeWrappedMap($json, ['tags_result', 'period', 'daily', 'result', 'data']);

        return collect($decoded)
            ->mapWithKeys(function (mixed $value, mixed $key): array {
                if (is_array($value)) {
                    $date = (string) ($value['date'] ?? $value['the_date'] ?? $key);

                    if ($date === '') {
                        return [];
                    }

                    unset($value['date'], $value['the_date']);

                    return [$date => $value];
                }

                return is_string($key) ? [$key => $value] : [];
            })
            ->all();
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param array<string, mixed> $extraMeta
     * @return array<string, mixed>
     */
    private function videoListPayload(array $rows, string $source, Request $request, bool $available = true, array $extraMeta = []): array
    {
        $commentsCount = collect($rows)
            ->sum(fn (array $row): int => isset($row['comments']['result']) && is_array($row['comments']['result']) ? count($row['comments']['result']) : 0);
        $hours = max(1, min(8760, (int) $request->query('hours', $source === 'urt_video + urt_count' ? 72 : 24)));

        return [
            'result' => $rows,
            'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'comments_count' => $commentsCount,
            'hours' => $hours,
            'start_time' => now('Asia/Taipei')->subHours($hours)->format('Y-m-d H:i:s'),
            'min' => max(0, (int) $request->query('min', 100)),
            'count_videos' => count($rows),
            'meta' => $extraMeta + [
                'available' => $available && $rows !== [],
                'source' => $source,
                'realtime_dashboard' => true,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private function listPayload(array $rows, string $source, array $extra = []): array
    {
        return [
            'result' => $rows,
            'time' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            'meta' => [
                'available' => $rows !== [],
                'source' => $source,
                'realtime_dashboard' => true,
            ],
        ] + $extra;
    }

    /**
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private function emptyResult(string $source, array $meta = []): array
    {
        return [
            'result' => new stdClass(),
            'meta' => $meta + [
                'available' => false,
                'source' => $source,
                'realtime_dashboard' => true,
            ],
        ];
    }
}
