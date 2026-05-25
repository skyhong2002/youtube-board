<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MayorReport
{
    /**
     * @return array<string, mixed>
     */
    public function report(Request $request, ?string $cityKey = null): array
    {
        $cityKey = $this->normalizeCity($cityKey ?? (string) $request->query('city', 'taipei'));
        $city = $this->city($cityKey);
        $range = $this->range($request);
        $type = $this->type($request);

        try {
            $records = $this->records($range['cache_from'], $range['to'], $type);
            $series = $this->series($city, $range['dates'], $records);

            return [
                'available' => true,
                'data_available' => collect($series)->contains(
                    fn (array $row): bool => collect($row['raw'])->contains(fn (float $value): bool => abs($value) > 0.000001),
                ),
                'title' => $city['label'].'候選人影片觀看支持度',
                'city' => $city,
                'cities' => $this->cities(),
                'static_cities' => $this->staticCityKeys(),
                'range' => $range,
                'type' => $type,
                'type_name' => $this->types()[$type],
                'types' => $this->types(),
                'series' => $series,
                'cache_rows' => collect($records)->flatten(1)->count(),
                'tagids' => $this->tagIds(),
                'legacy_source' => $this->legacyCityPath($cityKey),
                'generated_at' => CarbonImmutable::now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->unavailable($city, $range, $type);
        }
    }

    /**
     * @return list<string>
     */
    public function staticCityKeys(): array
    {
        return ['taipei', 'newtaipei', 'taoyuan', 'hsinchu', 'taichung'];
    }

    /**
     * @return array<string, array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}>
     */
    public function cities(): array
    {
        $fallback = $this->fallbackCities();
        $cities = [];

        foreach (array_keys($fallback) as $key) {
            $cities[$key] = $this->parseCityFile($key) ?? $fallback[$key];
        }

        return $cities;
    }

    /**
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}
     */
    private function city(string $key): array
    {
        $cities = $this->cities();

        return $cities[$key] ?? $cities['taipei'];
    }

    private function normalizeCity(string $key): string
    {
        $key = strtolower(trim($key));

        return preg_match('/^[a-z0-9_]+$/', $key) ? $key : 'taipei';
    }

    /**
     * @return list<int>
     */
    private function tagIds(): array
    {
        return [3, 4, 5, 6];
    }

    /**
     * @return array{from: string, to: string, cache_from: string, dates: list<string>, days: int, today: int, display_days: int}
     */
    private function range(Request $request): array
    {
        $now = CarbonImmutable::now('Asia/Taipei');
        $days = max(1, min(366, (int) $request->query('days', 30)));
        $today = max(0, min(3650, (int) $request->query('today', 0)));

        if ($request->filled('from') || $request->filled('to')) {
            $fallbackTo = $now->subDays($today)->toDateString();
            $to = $this->dateString($request->query('to'), $fallbackTo);
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days - 1)->toDateString());
        } else {
            $to = $request->has('today')
                ? $now->subDays($today)->toDateString()
                : $now->subDay()->toDateString();
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days - 1)->toDateString();
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $dates = [];
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 366) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return [
            'from' => $from,
            'to' => $to,
            'cache_from' => CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(13)->toDateString(),
            'dates' => $dates,
            'days' => $days,
            'today' => $today,
            'display_days' => count($dates),
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    private function type(Request $request): string
    {
        $type = (string) $request->query('type', 'tags_views');
        $aliases = [
            'tags_view' => 'tags_views',
            'views' => 'tags_views',
            'videos' => 'tags_video',
            'result' => 'tags_result',
        ];
        $type = $aliases[$type] ?? $type;

        return array_key_exists($type, $this->types()) ? $type : 'tags_views';
    }

    /**
     * @return array<string, string>
     */
    private function types(): array
    {
        return [
            'tags_views' => '觀看數',
            'tags_video' => '影片數',
            'tags_result' => '重要度',
        ];
    }

    /**
     * @return array<string, array<int, array<string, float>>>
     */
    private function records(string $from, string $to, string $type): array
    {
        $records = DB::table('urt_show_tag_date')
            ->whereBetween('the_date', [$from, $to])
            ->whereIn('tagid', collect($this->tagIds())->map(fn (int $tagId): string => (string) $tagId)->all())
            ->where(function (Builder $query): void {
                $query->whereNull('tag_or')->orWhere('tag_or', '');
            })
            ->where(function (Builder $query): void {
                $query->whereNull('tag_not')->orWhere('tag_not', '');
            })
            ->orderByDesc('pk')
            ->get();

        $byDate = [];

        foreach ($records as $record) {
            $date = substr((string) ($record->the_date ?? ''), 0, 10);
            $tagId = (int) ($record->tagid ?? 0);

            if ($date === '' || ! in_array($tagId, $this->tagIds(), true) || isset($byDate[$date][$tagId])) {
                continue;
            }

            $byDate[$date][$tagId] = $this->decodeKeywordWeights((string) ($record->{$type} ?? ''));
        }

        return $byDate;
    }

    /**
     * @param array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string} $city
     * @param list<string> $dates
     * @param array<string, array<int, array<string, float>>> $records
     * @return list<array{date: string, percentages: array<string, float>, raw: array<string, float>, total: float, cache_rows: int}>
     */
    private function series(array $city, array $dates, array $records): array
    {
        return collect($dates)
            ->map(function (string $date) use ($city, $records): array {
                $raw = [];
                $cacheRows = 0;

                foreach ($city['candidates'] as $candidate) {
                    $score = 0.0;

                    foreach ($this->tagIds() as $tagId) {
                        $factor = (float) ($city['factors'][$candidate][$tagId] ?? 0.0);

                        for ($outer = 0; $outer <= 6; $outer++) {
                            $outerDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($outer)->toDateString();
                            $rolling = 0.0;

                            for ($inner = 0; $inner <= 6; $inner++) {
                                $innerDate = CarbonImmutable::parse($outerDate, 'Asia/Taipei')->subDays($inner)->toDateString();
                                $value = (float) ($records[$innerDate][$tagId][$candidate] ?? 0.0);

                                if ($value !== 0.0) {
                                    $cacheRows++;
                                }

                                $rolling += $value;
                            }

                            $score += $factor * $rolling;
                        }
                    }

                    $raw[$candidate] = $score;
                }

                $total = array_sum($raw);
                $percentages = [];

                foreach ($raw as $candidate => $score) {
                    $percentages[$candidate] = abs($total) > 0.000001 ? ($score / $total) * 100 : 0.0;
                }

                return [
                    'date' => $date,
                    'percentages' => $percentages,
                    'raw' => $raw,
                    'total' => $total,
                    'cache_rows' => $cacheRows,
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @return array<string, float>
     */
    private function decodeKeywordWeights(string $json): array
    {
        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return [];
        }

        return collect($decoded)
            ->filter(fn (mixed $value, mixed $key): bool => is_string($key) && is_numeric($value))
            ->map(fn (mixed $value): float => (float) $value)
            ->all();
    }

    /**
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}|null
     */
    private function parseCityFile(string $key): ?array
    {
        $path = $this->legacyCityPath($key);

        if (! is_readable($path)) {
            return null;
        }

        $contents = file_get_contents($path);

        if (! is_string($contents)) {
            return null;
        }

        if (! preg_match('/\$city_name\s*=\s*"(?P<label>[^"]+)";/u', $contents, $labelMatch)
            || ! preg_match('/\$tags\s*=\s*"(?P<tags>[^"]+)";/u', $contents, $tagsMatch)) {
            return null;
        }

        $candidates = collect(explode(',', $tagsMatch['tags']))
            ->map(fn (string $tag): string => trim($tag))
            ->filter()
            ->values()
            ->all();

        $factors = [];
        preg_match_all('/\$factor\["(?P<candidate>[^"]+)"\]\["[^"]+"\]\[(?P<tagid>\d+)\]\s*=\s*(?P<expr>[^;]+);/u', $contents, $matches, PREG_SET_ORDER);

        foreach ($matches as $match) {
            $candidate = (string) $match['candidate'];
            $tagId = (int) $match['tagid'];
            $factors[$candidate][$tagId] = $this->numericExpression((string) $match['expr']);
        }

        if ($candidates === [] || $factors === []) {
            return null;
        }

        return [
            'key' => $key,
            'label' => $labelMatch['label'],
            'candidates' => $candidates,
            'factors' => $factors,
            'source' => $path,
        ];
    }

    private function numericExpression(string $expression): float
    {
        $expression = preg_replace('/\s+/', '', $expression) ?? '';

        if (! preg_match('/^-?\d+(?:\.\d+)?(?:\*-?\d+(?:\.\d+)?)*$/', $expression)) {
            return 0.0;
        }

        return collect(explode('*', $expression))
            ->reduce(fn (float $carry, string $part): float => $carry * (float) $part, 1.0);
    }

    private function legacyCityPath(string $key): string
    {
        return rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/mayor/'.$key.'.php';
    }

    /**
     * @return array<string, array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}>
     */
    private function fallbackCities(): array
    {
        return [
            'taipei' => $this->fallbackCity('taipei', '台北市', ['蔣萬安', '黃珊珊', '陳時中'], [
                '陳時中' => [3 => -0.2, 4 => 3.0, 5 => -0.4, 6 => -1.0],
                '蔣萬安' => [3 => 1.0, 4 => -0.3, 5 => 1.4, 6 => -0.5],
                '黃珊珊' => [3 => 0.3, 4 => -0.3, 5 => 1.4, 6 => 5.0],
            ]),
            'taoyuan' => $this->fallbackCity('taoyuan', '桃園市', ['張善政', '賴香伶', '鄭運鵬', '鄭寶清'], [
                '張善政' => [3 => 1.0, 4 => -0.9, 5 => 1.4, 6 => -1.0],
                '鄭運鵬' => [3 => -0.1, 4 => 2.4, 5 => -0.2, 6 => -0.5],
                '賴香伶' => [3 => 0.5, 4 => -0.3, 5 => 1.0, 6 => 5.0],
                '鄭寶清' => [3 => 0.5, 4 => -0.3, 5 => 1.0, 6 => 0.5],
            ]),
            'newtaipei' => $this->fallbackCity('newtaipei', '新北市', ['侯友宜', '林佳龍'], [
                '侯友宜' => [3 => 1.0, 4 => -0.9, 5 => 2.0, 6 => 5.0],
                '林佳龍' => [3 => -0.1, 4 => 3.0, 5 => -0.2, 6 => -0.5],
            ]),
            'hsinchu' => $this->fallbackCity('hsinchu', '新竹市', ['林耕仁', '高虹安', '沈慧虹'], [
                '沈慧虹' => [3 => -0.05, 4 => 3.0, 5 => -0.1, 6 => -0.25],
                '林耕仁' => [3 => 1.0, 4 => -0.15, 5 => 1.4, 6 => -0.25],
                '高虹安' => [3 => -0.1, 4 => -0.3, 5 => 1.4, 6 => 5.0],
            ]),
            'taichung' => $this->fallbackCity('taichung', '台中市', ['盧秀燕', '蔡其昌'], [
                '盧秀燕' => [3 => 1.0, 4 => -0.9, 5 => 1.0, 6 => 1.0],
                '蔡其昌' => [3 => -0.1, 4 => 3.0, 5 => -0.2, 6 => 0.5],
            ]),
            'kaohsiung' => $this->fallbackCity('kaohsiung', '高雄市', ['柯志恩', '陳其邁'], [
                '柯志恩' => [3 => 1.0, 4 => -0.9, 5 => 1.0, 6 => -0.5],
                '陳其邁' => [3 => -0.05, 4 => 3.0, 5 => -0.1, 6 => 2.5],
            ]),
            'keelung' => $this->fallbackCity('keelung', '基隆市', ['謝國樑', '蔡適應'], [
                '謝國樑' => [3 => 1.0, 4 => -0.9, 5 => 1.0, 6 => 1.0],
                '蔡適應' => [3 => -0.1, 4 => 3.0, 5 => -0.2, 6 => 0.5],
            ]),
            'penghu' => $this->fallbackCity('penghu', '澎湖縣', ['陳光復', '賴峰偉'], [
                '陳光復' => [3 => 1.0, 4 => -0.9, 5 => 1.0, 6 => 1.0],
                '賴峰偉' => [3 => -0.1, 4 => 3.0, 5 => -0.2, 6 => 0.5],
            ]),
            'tainan' => $this->fallbackCity('tainan', '台南市', ['謝龍介', '林義豐', '黃偉哲'], [
                '謝龍介' => [3 => 0.1, 4 => -0.9, 5 => 1.0, 6 => -1.0],
                '黃偉哲' => [3 => -0.01, 4 => 3.0, 5 => -0.02, 6 => 0.5],
                '林義豐' => [3 => 0.5, 4 => -0.3, 5 => 1.0, 6 => 5.0],
            ]),
            'yilan' => $this->fallbackCity('yilan', '宜蘭縣', ['林姿妙', '江聰淵'], [
                '林姿妙' => [3 => 1.0, 4 => -0.9, 5 => 1.0, 6 => 1.0],
                '江聰淵' => [3 => -0.1, 4 => 3.0, 5 => -0.2, 6 => 0.5],
            ]),
        ];
    }

    /**
     * @param list<string> $candidates
     * @param array<string, array<int, float>> $factors
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}
     */
    private function fallbackCity(string $key, string $label, array $candidates, array $factors): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'candidates' => $candidates,
            'factors' => $factors,
            'source' => 'fallback',
        ];
    }

    /**
     * @param array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string} $city
     * @return array<string, mixed>
     */
    private function unavailable(array $city, array $range, string $type): array
    {
        return [
            'available' => false,
            'data_available' => false,
            'title' => $city['label'].'候選人影片觀看支持度',
            'city' => $city,
            'cities' => $this->cities(),
            'static_cities' => $this->staticCityKeys(),
            'range' => $range,
            'type' => $type,
            'type_name' => $this->types()[$type],
            'types' => $this->types(),
            'series' => [],
            'cache_rows' => 0,
            'tagids' => $this->tagIds(),
            'legacy_source' => $city['source'],
            'generated_at' => CarbonImmutable::now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
