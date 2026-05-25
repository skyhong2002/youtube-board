<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class KeywordListReport
{
    private const SORT_COLUMNS = ['weight', 'hours_count', 'max_count', 'max_hours'];

    public function __construct(private readonly LegacyStopwords $stopwords)
    {
    }

    /**
     * @return array{available: bool, rows: array<int, array<string, mixed>>, filters: array<string, mixed>, generated_at: string, sort: string, cached_metrics_available: bool}
     */
    public function forRequest(Request $request): array
    {
        $sort = $this->sort($request);
        $limit = max(1, min(1000, (int) $request->query('limit', 500)));

        try {
            $cachedSums = $this->cachedSums();
            $now = now('Asia/Taipei');
            $stopwords = $this->stopwords->lookup();

            $rows = DB::table('tags')
                ->where(function ($query): void {
                    $query->whereNull('no_tag')
                        ->orWhere('no_tag', '<', 1);
                })
                ->orderByDesc('hours_count')
                ->limit(5000)
                ->get()
                ->reject(fn (object $row): bool => isset($stopwords[(string) $row->tag]))
                ->map(function (object $row) use ($cachedSums, $now): array {
                    $tag = (string) $row->tag;
                    $hoursCount = (int) $row->hours_count;
                    $maxCount = (int) $row->max_count;
                    $maxHours = (string) $row->max_hours;
                    $periodDays = max(1 / 24, $now->diffInSeconds($maxHours, true) / 86400);
                    $weight = $hoursCount > 1 && $maxCount > 1
                        ? log($hoursCount) / $periodDays * log($maxCount) * 100
                        : 0;
                    $sum = $cachedSums[$tag] ?? null;

                    return [
                        'tag' => $tag,
                        'hours_count' => $hoursCount,
                        'max_count' => $maxCount,
                        'max_hours' => $maxHours,
                        'weight' => max(0, $weight),
                        'weight_score' => (int) floor(sqrt(max(0, $weight))),
                        'video_count' => is_array($sum) ? (int) ($sum['video'] ?? 0) : null,
                        'views' => is_array($sum) ? (int) ($sum['views'] ?? 0) : null,
                        'views_all' => is_array($sum) ? (int) ($sum['views_all'] ?? 0) : null,
                    ];
                })
                ->sortByDesc($sort)
                ->values()
                ->take($limit)
                ->map(fn (array $row, int $index): array => ['rank' => $index + 1] + $this->withGrowth($row))
                ->all();

            return [
                'available' => true,
                'rows' => $rows,
                'filters' => $request->query(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'sort' => $sort,
                'cached_metrics_available' => $cachedSums !== [],
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'rows' => [],
                'filters' => $request->query(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
                'sort' => $sort,
                'cached_metrics_available' => false,
            ];
        }
    }

    private function sort(Request $request): string
    {
        $sort = (string) $request->query('sort', 'weight');

        return in_array($sort, self::SORT_COLUMNS, true) ? $sort : 'weight';
    }

    /**
     * @return array<string, mixed>
     */
    private function cachedSums(): array
    {
        try {
            $json = DB::table('urt_show_data')
                ->where('data_name', 'tags_all')
                ->value('the_result');
        } catch (QueryException) {
            return [];
        }

        if (! is_string($json) || $json === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        foreach (['result', 'tags_all', 'data'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

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
    private function withGrowth(array $row): array
    {
        if (($row['views_all'] ?? 0) > 0 && ($row['views'] ?? null) !== null) {
            $row['growth_percent'] = (($row['views'] / 7) - ($row['views_all'] / 30)) / ($row['views_all'] / 30) * 100;
        } else {
            $row['growth_percent'] = null;
        }

        return $row;
    }
}
