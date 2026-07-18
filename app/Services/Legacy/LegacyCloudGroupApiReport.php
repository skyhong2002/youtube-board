<?php

namespace App\Services\Legacy;

use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;

class LegacyCloudGroupApiReport
{
    public function __construct(private readonly GroupViewProjector $groupViewProjector) {}

    /**
     * @return array<string, mixed>
     */
    public function channelCloud(Request $request): array
    {
        $uId = max(1, (int) ($request->query('uid', $request->query('u_id', 2))));
        $days = max(1, min(3650, (int) $request->query('days', 30)));

        try {
            $row = DB::table('urt_show_cloud')
                ->where('u_id', $uId)
                ->where('days', $days)
                ->orderByDesc('pk')
                ->first();
            $result = $this->decodeWeightedMap($row->keywords_json ?? null);

            return $this->payload($result, 'urt_show_cloud.keywords_json', [
                'u_id' => $uId,
                'days' => $days,
                'mtime' => $row->mtime ?? null,
                'blocked_reason' => $result === [] ? 'local channel cloud cache is empty; run reports:channel-cloud:build to rebuild urt_show_cloud' : null,
            ]);
        } catch (QueryException) {
            return $this->payload([], 'urt_show_cloud.keywords_json', [
                'u_id' => $uId,
                'days' => $days,
                'blocked_reason' => 'local channel cloud cache table is missing',
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function cloudTagDate(Request $request, bool $noApi = false): array
    {
        $filters = $this->sortedTagFilters($request);
        $date = $this->dateQuery($request, 'date', now('Asia/Taipei')->toDateString());
        $type = $noApi ? 'tags_result' : $this->cloudDateType($request);

        try {
            $query = DB::table('urt_show_tag_date')
                ->where('the_date', $date)
                ->orderByDesc('pk');
            $this->applyCacheFilters($query, $filters);

            if ($noApi) {
                $query->where('tags_count', '>', 0);
            }

            $row = $query->first();
            $result = $type === 'all'
                ? $this->decodeWeightedMap($row->tags_result ?? null)
                : $this->decodeWeightedMap($row?->{$type} ?? null);

            $payload = $this->payload($result, $noApi ? 'urt_show_tag_date.noapi' : 'urt_show_tag_date', [
                'filters' => $filters,
                'date' => $date,
                'type' => $type,
                'mtime' => $row->mtime ?? null,
                'blocked_reason' => $result === [] ? 'local tag-date cache is empty; legacy generation is intentionally not run' : null,
            ]);

            $payload['total_views'] = (int) ($row->total_views ?? 0);
            $payload['count_channels'] = (int) ($row->count_channels ?? 0);
            $payload['count_videos'] = (int) ($row->count_videos ?? 0);
            $payload['count_tags'] = (int) ($row->count_tags ?? 0);

            if ($type === 'all') {
                $payload['tags_result'] = $this->decodeWeightedMap($row->tags_result ?? null);
                $payload['tags_video'] = $this->decodeWeightedMap($row->tags_video ?? null);
                $payload['tags_views'] = $this->decodeWeightedMap($row->tags_views ?? null);
            }

            return $payload;
        } catch (QueryException) {
            return $this->payload([], 'urt_show_tag_date', [
                'filters' => $filters,
                'date' => $date,
                'type' => $type,
                'blocked_reason' => 'local tag-date cache table is missing',
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function groupView(Request $request): array
    {
        $group = trim((string) $request->query('group', '六都市長候選人')) ?: '六都市長候選人';
        $view = trim((string) $request->query('view', 'politician')) ?: 'politician';
        $days = max(1, min(GroupViewProjector::MAX_DAYS, (int) $request->query('days', 30)));

        try {
            $row = DB::table('urt_show_group')
                ->where('the_group', 'like', $group)
                ->where('the_view', 'like', $view)
                ->first();
            $cached = $this->decodeMap($row->the_result ?? null);

            if ($cached !== []) {
                $cached['meta'] = [
                    'available' => true,
                    'source' => 'urt_show_group.the_result',
                    'group' => $group,
                    'view' => $view,
                    'mtime' => $row->mtime ?? null,
                    'realtime_dashboard' => true,
                    'cache_available' => true,
                    'cache_builder' => 'reports:group-view:build',
                ];

                return $cached;
            }
        } catch (QueryException) {
            // Fall through to real-time derivation when the cache table is absent.
        }

        try {
            $projection = $this->groupViewProjector->project(
                group: $group,
                view: $view,
                days: $days,
                explicitTags: $this->explicitRequestTags($request),
            );
        } catch (QueryException) {
            $projection = ['complete' => false, 'blocked_reason' => 'missing_tag_date_table', 'result' => []];
        }

        if ($projection['complete']) {
            return [
                'result' => $projection['result'],
                'meta' => [
                    'available' => true,
                    'source' => 'urt_show_tag_date derived real-time YouTube dashboard',
                    'group' => $group,
                    'view' => $view,
                    'days' => $days,
                    'realtime_dashboard' => true,
                    'cache_available' => false,
                    'cache_builder' => 'reports:group-view:build',
                ],
            ];
        }

        $result = [
            'tag_array' => $this->groupTags($request, $group),
            'group_array' => $this->groupViews($view),
            'group_data' => new stdClass,
            'data_array' => new stdClass,
        ];

        return [
            'result' => $result,
            'meta' => [
                'available' => $result['tag_array'] !== [] && $result['group_array'] !== [],
                'source' => 'tag_group + legacy group config',
                'group' => $group,
                'view' => $view,
                'realtime_dashboard' => true,
                'cache_available' => false,
                'cache_builder' => 'reports:group-view:build',
                'blocked_reason' => (string) ($projection['blocked_reason'] ?? 'missing_tag_date_source'),
            ],
        ];
    }

    /**
     * @return list<string>
     */
    private function explicitRequestTags(Request $request): array
    {
        return collect(explode(',', trim((string) $request->query('tags', ''))))
            ->map(fn (string $tag): string => trim($tag))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function groupTags(Request $request, string $group): array
    {
        $explicitTags = trim((string) $request->query('tags', ''));

        if ($explicitTags !== '') {
            return collect(explode(',', $explicitTags))
                ->map(fn (string $tag): string => trim($tag))
                ->filter()
                ->values()
                ->all();
        }

        if (str_starts_with($group, 'tags_')) {
            return LegacyGroupViewConfig::tagSets()[$group] ?? [];
        }

        try {
            return DB::table('tag_group')
                ->where('group_name', $group)
                ->where(function ($query): void {
                    $query->whereNull('del_flag')->orWhere('del_flag', '<', '1');
                })
                ->orderByDesc('latest_time')
                ->orderBy('tag')
                ->pluck('tag')
                ->map(fn (mixed $tag): string => (string) $tag)
                ->filter()
                ->values()
                ->all();
        } catch (QueryException) {
            return [];
        }
    }

    /**
     * @return list<array{name: string, tag_para: string}>
     */
    private function groupViews(string $view): array
    {
        return LegacyGroupViewConfig::views()[$view] ?? LegacyGroupViewConfig::views()['politician'];
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
        $items = is_array($value) ? $value : explode(',', (string) $value);
        $integers = collect($items)
            ->map(fn (mixed $item): int => (int) trim((string) $item))
            ->filter(fn (int $item): bool => $item > 0)
            ->unique()
            ->values()
            ->all();
        sort($integers);

        return $integers;
    }

    /**
     * @param  Builder  $query
     * @param  array{tagid_string: string, or_string: string, not_string: string}  $filters
     */
    private function applyCacheFilters($query, array $filters): void
    {
        $this->whereNullableEmptyString($query, 'tagid', $filters['tagid_string']);
        $this->whereNullableEmptyString($query, 'tag_or', $filters['or_string']);
        $this->whereNullableEmptyString($query, 'tag_not', $filters['not_string']);
    }

    /**
     * @param  Builder  $query
     */
    private function whereNullableEmptyString($query, string $column, string $value): void
    {
        if ($value !== '') {
            $query->where($column, $value);

            return;
        }

        $query->where(function ($query) use ($column): void {
            $query->where($column, '')->orWhereNull($column);
        });
    }

    private function dateQuery(Request $request, string $key, string $fallback): string
    {
        $date = (string) $request->query($key, $fallback);

        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) && $date >= '2010-01-01'
            ? $date
            : $fallback;
    }

    private function cloudDateType(Request $request): string
    {
        $type = (string) $request->query('type', 'tags_result');

        return in_array($type, ['tags_result', 'tags_video', 'tags_views', 'all'], true)
            ? $type
            : 'tags_result';
    }

    /**
     * @param  array<string, mixed>  $result
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    private function payload(array $result, string $source, array $meta): array
    {
        return [
            'result' => $result === [] ? new stdClass : $result,
            'meta' => $meta + [
                'available' => $result !== [],
                'source' => $source,
                'realtime_dashboard' => true,
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
    private function decodeWeightedMap(mixed $json): array
    {
        $decoded = $this->decodeMap($json);

        foreach (['keywords_json', 'keywords', 'tags_result', 'tags_video', 'tags_views', 'tags', 'result', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return collect($decoded)
            ->mapWithKeys(function (mixed $value, mixed $key): array {
                if (is_array($value)) {
                    $tag = (string) ($value['tag'] ?? $value['keyword'] ?? $value['word'] ?? $key);
                    $count = $value['count'] ?? $value['weight'] ?? $value['score'] ?? $value['value'] ?? null;

                    return $tag !== '' && $count !== null ? [$tag => $count] : [];
                }

                return is_string($key) ? [$key => $value] : [];
            })
            ->all();
    }
}
