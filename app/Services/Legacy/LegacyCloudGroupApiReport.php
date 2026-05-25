<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;

class LegacyCloudGroupApiReport
{
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
            $result = $this->decodeMap($row->keywords_json ?? null);

            return $this->payload($result, 'urt_show_cloud.keywords_json', [
                'u_id' => $uId,
                'days' => $days,
                'mtime' => $row->mtime ?? null,
                'blocked_reason' => $result === [] ? 'local channel cloud cache is empty; legacy generation is intentionally not run' : null,
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
                ? $this->decodeMap($row->tags_result ?? null)
                : $this->decodeMap($row?->{$type} ?? null);

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
                $payload['tags_result'] = $this->decodeMap($row->tags_result ?? null);
                $payload['tags_video'] = $this->decodeMap($row->tags_video ?? null);
                $payload['tags_views'] = $this->decodeMap($row->tags_views ?? null);
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
                    'read_only' => true,
                ];

                return $cached;
            }
        } catch (QueryException) {
            // Fall through to a read-only membership shell when the cache table is absent.
        }

        $result = [
            'tag_array' => $this->groupTags($request, $group),
            'group_array' => $this->groupViews($view),
            'group_data' => new stdClass(),
            'data_array' => new stdClass(),
        ];

        return [
            'result' => $result,
            'meta' => [
                'available' => $result['tag_array'] !== [] && $result['group_array'] !== [],
                'source' => 'tag_group + legacy group config',
                'group' => $group,
                'view' => $view,
                'read_only' => true,
                'cache_available' => false,
                'blocked_reason' => 'local urt_show_group cache is missing or empty; legacy group trend generation is intentionally not run',
            ],
        ];
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
            return $this->configuredTagSets()[$group] ?? [];
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
        return $this->configuredViews()[$view] ?? $this->configuredViews()['politician'];
    }

    /**
     * @return array<string, list<array{name: string, tag_para: string}>>
     */
    private function configuredViews(): array
    {
        return [
            'all' => [
                ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
            ],
            'china' => [
                ['name' => '中國官方', 'tag_para' => 'tagid=11'],
                ['name' => '大外宣', 'tag_para' => 'tagid=15'],
                ['name' => '新大外宣', 'tag_para' => 'tagid=90'],
                ['name' => '泛藍', 'tag_para' => 'tagid=3'],
                ['name' => '泛紅', 'tag_para' => 'tagid=5'],
            ],
            'media' => [
                ['name' => '旺中', 'tag_para' => 'tagid=53'],
                ['name' => 'TVBS', 'tag_para' => 'tagid=29'],
                ['name' => '三立', 'tag_para' => 'tagid=64'],
                ['name' => '東森', 'tag_para' => 'tagid=63'],
                ['name' => '民視', 'tag_para' => 'tagid=50'],
                ['name' => '台視', 'tag_para' => 'tagid=65'],
                ['name' => '年代', 'tag_para' => 'tagid=80'],
            ],
            'media_social' => [
                ['name' => '旺中', 'tag_para' => 'tagid=53 or=1,13'],
                ['name' => 'TVBS', 'tag_para' => 'tagid=29 or=1,13'],
                ['name' => '三立', 'tag_para' => 'tagid=64 or=1,13'],
                ['name' => '東森', 'tag_para' => 'tagid=63 or=1,13'],
            ],
            'people' => [
                ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
                ['name' => '新聞', 'tag_para' => 'tagid=13'],
            ],
            'politic' => [
                ['name' => '全部', 'tag_para' => 'or=1,2,13,14'],
                ['name' => '個人社論', 'tag_para' => 'tagid=1 not=2,9,10,13'],
                ['name' => '新聞', 'tag_para' => 'tagid=13'],
                ['name' => '台灣立場', 'tag_para' => 'tagid=9,48'],
                ['name' => '中國立場', 'tag_para' => 'tagid=9,49'],
                ['name' => '政治人物', 'tag_para' => 'tagid=2'],
            ],
            'politician' => [
                ['name' => '新聞', 'tag_para' => 'tagid=13'],
                ['name' => '個人社論', 'tag_para' => 'tagid=1 not=2,9,10,13'],
                ['name' => '台灣立場', 'tag_para' => 'tagid=9,48'],
                ['name' => '中國立場', 'tag_para' => 'tagid=9,49'],
            ],
            'position' => [
                ['name' => '泛藍', 'tag_para' => 'tagid=3'],
                ['name' => '泛白', 'tag_para' => 'tagid=6'],
                ['name' => '泛綠', 'tag_para' => 'tagid=4'],
                ['name' => '泛紅', 'tag_para' => 'tagid=5'],
            ],
            'tv_position' => [
                ['name' => '台灣立場', 'tag_para' => 'tagid=48'],
                ['name' => '中國立場', 'tag_para' => 'tagid=49'],
            ],
            'two' => [
                ['name' => '台灣立場', 'tag_para' => 'tagid=9,48'],
                ['name' => '中國立場', 'tag_para' => 'tagid=9,49'],
            ],
        ];
    }

    /**
     * @return array<string, list<string>>
     */
    private function configuredTagSets(): array
    {
        return [
            'tags_coldwar' => ['新冷戰', '環太軍演', '一帶一路', '第一島鏈', 'G7', '北約', '金磚', '戰狼', '訪台', '裴洛西', '佩洛西', '華春瑩'],
            'tags_country' => ['中國', '大陸', '香港', '美國', '俄羅斯', '烏克蘭'],
            'tags_covid' => ['確診', '疫情', '快篩', '疫苗', '恩恩', '通報', '清零', 'Novavax'],
            'tags_economy' => ['台積電', '聯發科', '通膨', '缺電', '電價', '特斯拉', '鴻海', '經濟衰退', '升息', '爛尾樓'],
            'tags_elect' => ['選舉', '候選人', '停電', '論文抄襲', '網軍', '通膨', '缺電'],
            'tags_parties' => ['國民黨', '民眾黨', '民進黨', '時代力量'],
            'tags_president' => ['蔡英文', '習近平', '岸田文雄', '拜登', '普丁', '馬克宏', '澤倫斯基', '莫迪'],
            'tags_president2024' => ['侯友宜', '柯文哲', '賴清德', '趙少康', '蕭美琴', '吳欣盈'],
            'tags_straits' => ['石斑魚', '軍演', '共軍', '航母', '解放軍', '台海', '兩岸', '兩岸統一', '王心凌', '台獨', '第一島鏈', '海峽中線', '一中政策', '一個中國', '訪台', '一中原則'],
        ];
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
     * @param array<string, mixed> $result
     * @param array<string, mixed> $meta
     * @return array<string, mixed>
     */
    private function payload(array $result, string $source, array $meta): array
    {
        return [
            'result' => $result === [] ? new stdClass() : $result,
            'meta' => $meta + [
                'available' => $result !== [],
                'source' => $source,
                'read_only' => true,
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
}
