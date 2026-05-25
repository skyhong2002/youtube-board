<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class HomeTagIndexReport
{
    private const SORT_COLUMNS = ['num', 'total', 'ave', 'median'];

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, filters: array<string, mixed>, summary: array<string, int|float>, generated_at: string, sort: string}
     */
    public function forRequest(Request $request): array
    {
        $sort = $this->sort($request);
        $min = max(0, (int) $request->query('min', 10));
        $limit = max(1, min(1000, (int) $request->query('limit', 500)));

        try {
            $tagNames = DB::table('urt_tag')
                ->orderBy('tag_id')
                ->pluck('tag_name', 'tag_id')
                ->mapWithKeys(fn ($name, $id) => [(int) $id => (string) $name])
                ->all();

            $tagStats = [];

            DB::table('urt_count')
                ->select(['tags', 'view_week'])
                ->where('view_week', '>=', $min)
                ->orderBy('u_id')
                ->get()
                ->each(function (object $row) use (&$tagStats): void {
                    $viewWeek = (int) ($row->view_week ?? 0);

                    foreach ($this->tagIds((string) ($row->tags ?? '')) as $tagId) {
                        $tagStats[$tagId]['num'] = ($tagStats[$tagId]['num'] ?? 0) + 1;
                        $tagStats[$tagId]['total'] = ($tagStats[$tagId]['total'] ?? 0) + $viewWeek;
                        $tagStats[$tagId]['values'][] = $viewWeek;
                    }
                });

            $rows = collect($tagStats)
                ->map(function (array $stats, int $tagId) use ($tagNames): array {
                    $num = (int) $stats['num'];
                    $total = (int) $stats['total'];

                    return [
                        'tag_id' => $tagId,
                        'name' => $tagNames[$tagId] ?? (string) $tagId,
                        'num' => $num,
                        'total' => $total,
                        'ave' => $num > 0 ? $total / $num : 0,
                        'median' => $this->median($stats['values'] ?? []),
                    ];
                })
                ->sortByDesc($sort)
                ->values()
                ->take($limit)
                ->map(fn (array $row, int $index): array => ['rank' => $index + 1] + $row)
                ->all();

            return [
                'available' => true,
                'rows' => $rows,
                'filters' => $request->query(),
                'summary' => [
                    'visible_tags' => count($rows),
                    'total_channels' => array_sum(array_column($rows, 'num')),
                    'weekly_views' => array_sum(array_column($rows, 'total')),
                ],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'sort' => $sort,
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'rows' => [],
                'filters' => $request->query(),
                'summary' => ['visible_tags' => 0, 'total_channels' => 0, 'weekly_views' => 0],
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'sort' => $sort,
            ];
        }
    }

    private function sort(Request $request): string
    {
        $sort = (string) $request->query('sort', 'num');

        return in_array($sort, self::SORT_COLUMNS, true) ? $sort : 'num';
    }

    /**
     * @return array<int>
     */
    private function tagIds(string $tagString): array
    {
        preg_match_all('/\[(\d+)\]/', $tagString, $matches);

        return collect($matches[1] ?? [])
            ->map(fn (string $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param array<int, int> $values
     */
    private function median(array $values): float
    {
        $values = array_values($values);
        sort($values);
        $count = count($values);

        if ($count === 0) {
            return 0;
        }

        $middle = intdiv($count - 1, 2);

        if ($count % 2 === 1) {
            return (float) $values[$middle];
        }

        return ($values[$middle] + $values[$middle + 1]) / 2;
    }
}
