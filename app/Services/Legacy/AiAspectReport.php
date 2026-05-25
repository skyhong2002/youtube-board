<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AiAspectReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, title: string, rows: list<array<string, mixed>>, filters: array<string, mixed>, generated_at: string}
     */
    public function forRequest(Request $request): array
    {
        $filters = $this->filters($request);

        try {
            $tagNames = $this->tagFilter->tagNames();
            $countRows = $this->matchingCountRows($filters);
            $rows = $this->rows($filters, $countRows, $tagNames);

            return [
                'available' => true,
                'title' => $this->title($filters, $tagNames),
                'rows' => $rows,
                'filters' => $this->displayFilters($filters),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'title' => '立場分布表',
                'rows' => [],
                'filters' => $this->displayFilters($filters),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    /**
     * @return array{or: list<int>, tagid: list<int>, not: list<int>, limit: int, condition: string|null}
     */
    private function filters(Request $request): array
    {
        $filters = $this->tagFilter->filters($request);
        $condition = $request->query('condition');

        if (is_string($condition)) {
            if ($condition === 'blue') {
                $filters['tagid'] = [3];
            } elseif ($condition === 'green') {
                $filters['tagid'] = [4];
            } elseif ($condition === 'neutral') {
                $filters['not'] = [3, 4, 5, 6, 31, 41];
            } elseif ($condition === 'finance') {
                $filters['tagid'] = [31];
            } elseif ($condition === 'world') {
                $filters['tagid'] = [41];
            } elseif ($condition !== 'all') {
                $condition = null;
            }
        } else {
            $condition = null;
        }

        $filters['limit'] = max(1, min(200, (int) $request->query('limit', 100)));
        $filters['condition'] = $condition;

        return $filters;
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>} $filters
     * @return \Illuminate\Support\Collection<int, object>
     */
    private function matchingCountRows(array $filters)
    {
        if ($filters['or'] === [] && $filters['tagid'] === [] && $filters['not'] === []) {
            return DB::table('urt_count')->select(['u_id', 'tags'])->get();
        }

        return $this->tagFilter->matchingChannelTags($filters);
    }

    /**
     * @param array{limit: int} $filters
     * @param \Illuminate\Support\Collection<int, object> $countRows
     * @param array<int, string> $tagNames
     * @return list<array<string, mixed>>
     */
    private function rows(array $filters, $countRows, array $tagNames): array
    {
        if ($countRows->isEmpty()) {
            return [];
        }

        $countByChannel = $countRows->keyBy('u_id');
        $latestByChannel = DB::table('urt_channel_ai')
            ->select('u_id', DB::raw('max(pk) as pk'))
            ->where('data_type', 'aspect')
            ->whereRaw('length(result_json) > 10')
            ->whereIn('u_id', $countByChannel->keys()->all())
            ->groupBy('u_id');

        return DB::query()
            ->fromSub($latestByChannel, 'latest')
            ->join('urt_channel_ai as ai', 'ai.pk', '=', 'latest.pk')
            ->join('urt_channel as c', 'c.u_id', '=', 'ai.u_id')
            ->select(['ai.u_id', 'ai.pk', 'ai.result_json', 'c.youtube_id', 'c.title', 'c.thumbnails', 'c.flag_del'])
            ->where(function ($query): void {
                $query->whereNull('c.flag_del')->orWhere('c.flag_del', '<', 1);
            })
            ->get()
            ->map(function (object $row) use ($countByChannel, $tagNames): array {
                $aspect = $this->aspectValues((string) $row->result_json);
                $tags = $this->tagFilter->visibleTags((string) ($countByChannel->get($row->u_id)->tags ?? ''), $tagNames);

                return [
                    'u_id' => (int) $row->u_id,
                    'pk' => (int) $row->pk,
                    'title' => $row->title ?? 'Unknown channel',
                    'youtube_id' => $row->youtube_id ?? null,
                    'thumbnail' => $row->thumbnails ?? null,
                    'tags' => $tags,
                    'values' => $aspect['values'],
                    'descriptions' => $aspect['descriptions'],
                    'balance' => $aspect['values']['泛綠'] + $aspect['values']['泛白'] - $aspect['values']['泛藍'] - $aspect['values']['泛紅'] + $aspect['values']['台灣'] - $aspect['values']['中國'],
                ];
            })
            ->sortByDesc('balance')
            ->take($filters['limit'])
            ->values()
            ->all();
    }

    /**
     * @return array{values: array<string, int>, descriptions: array<string, string>}
     */
    private function aspectValues(string $json): array
    {
        $decoded = json_decode($json, true);
        $values = array_fill_keys(['台灣', '泛綠', '泛白', '泛藍', '泛紅', '中國'], 0);
        $descriptions = array_fill_keys(array_keys($values), '');

        if (! is_array($decoded)) {
            return ['values' => $values, 'descriptions' => $descriptions];
        }

        $decoded = $this->unwrapAspectPayload($decoded);

        foreach ($this->itemsFromGroups($decoded, ['兩岸角度', '兩岸']) as $item) {
            $name = $this->text($item, ['項目', 'item', 'name']);

            if (array_key_exists($name, $values)) {
                $values[$name] = $this->score($item);
                $descriptions[$name] = $this->text($item, ['描述', 'description', 'content']);
            }
        }

        foreach ($this->itemsFromGroups($decoded, ['政治傾向', '政治立場', '政治偏向', '政治']) as $item) {
            $name = $this->text($item, ['項目', 'item', 'name']);

            if (array_key_exists($name, $values)) {
                $values[$name] = $this->score($item);
                $descriptions[$name] = $this->text($item, ['描述', 'description', 'content']);
            }
        }

        return ['values' => $values, 'descriptions' => $descriptions];
    }

    /**
     * @param array<string, mixed> $decoded
     * @return array<string, mixed>
     */
    private function unwrapAspectPayload(array $decoded): array
    {
        foreach (['aspect', 'aspects', '立場', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                return $this->unwrapAspectPayload($decoded[$key]);
            }
        }

        if (array_is_list($decoded)) {
            $groups = [];

            foreach ($decoded as $item) {
                if (! is_array($item)) {
                    continue;
                }

                $group = $this->text($item, ['分類', '群組', '類型', 'group', 'category', 'type']);

                if ($group !== '') {
                    $groups[$group][] = $item;
                }
            }

            return $groups !== [] ? $groups : ['政治' => $decoded, '兩岸' => $decoded];
        }

        return $decoded;
    }

    /**
     * @param array<string, mixed> $decoded
     * @param list<string> $groupNames
     * @return list<array<string, mixed>>
     */
    private function itemsFromGroups(array $decoded, array $groupNames): array
    {
        foreach ($groupNames as $groupName) {
            if (isset($decoded[$groupName]) && is_array($decoded[$groupName])) {
                return collect($decoded[$groupName])
                    ->filter(fn (mixed $item): bool => is_array($item))
                    ->values()
                    ->all();
            }
        }

        return [];
    }

    /**
     * @param array<string, mixed> $item
     * @param list<string> $keys
     */
    private function text(array $item, array $keys): string
    {
        foreach ($keys as $key) {
            if (isset($item[$key]) && is_scalar($item[$key])) {
                return trim((string) $item[$key]);
            }
        }

        return '';
    }

    /**
     * @param array<string, mixed> $item
     */
    private function score(array $item): int
    {
        foreach (['偏好度', 'score', 'value', 'preference'] as $key) {
            if (isset($item[$key]) && is_numeric($item[$key])) {
                return (int) $item[$key];
            }
        }

        return 0;
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, condition: string|null} $filters
     * @param array<int, string> $tagNames
     */
    private function title(array $filters, array $tagNames): string
    {
        $names = collect(array_merge($filters['tagid'], $filters['or']))
            ->map(fn (int $tagId): string => $tagNames[$tagId] ?? (string) $tagId)
            ->filter()
            ->implode(' ');

        if ($names !== '') {
            return $names.' 立場分布表';
        }

        if ($filters['condition'] === 'neutral') {
            return '中立頻道 立場分布表';
        }

        return '全部頻道 立場分布表';
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, limit: int, condition: string|null} $filters
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters): array
    {
        return array_filter([
            'condition' => $filters['condition'],
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
            'limit' => $filters['limit'],
        ], fn (mixed $value): bool => $value !== null && $value !== '');
    }
}
