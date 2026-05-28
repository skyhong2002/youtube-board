<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MayorReport
{
    private const CITY_REGIONS = [
        'north' => [
            'label' => '北部',
            'cities' => ['taipei', 'newtaipei', 'taoyuan', 'keelung', 'hsinchu', 'hsinchucounty', 'yilan'],
        ],
        'central' => [
            'label' => '中部',
            'cities' => ['taichung', 'miaoli', 'changhua', 'nantou', 'yunlin'],
        ],
        'south' => [
            'label' => '南部',
            'cities' => ['tainan', 'kaohsiung', 'chiayi', 'chiayicity', 'pingtung'],
        ],
        'east' => [
            'label' => '東部',
            'cities' => ['hualien', 'taitung'],
        ],
        'islands' => [
            'label' => '離島',
            'cities' => ['penghu', 'kinmen', 'lienchiang'],
        ],
    ];

    /**
     * @return array<string, mixed>
     */
    public function report(Request $request, ?string $cityKey = null): array
    {
        $cityKey = $this->normalizeCity($cityKey ?? (string) $request->query('city', 'taipei'));
        $city = $this->city($cityKey);
        $type = $this->type($request);
        $range = $this->range($request);

        try {
            $records = $this->records($range['cache_from'], $range['to'], $type);
            $series = $this->series($city, $range['dates'], $records);

            if (! $this->seriesHasData($series) && ! $this->hasExplicitDate($request)) {
                $latestDate = $this->latestCacheDate($type);

                if ($latestDate !== null && $latestDate !== $range['to']) {
                    $range = $this->range($request, $latestDate);
                    $records = $this->records($range['cache_from'], $range['to'], $type);
                    $series = $this->series($city, $range['dates'], $records);
                }
            }

            if (! $this->seriesHasData($series) && ! $request->filled('type') && $type === 'tags_views') {
                $fallbackType = 'tags_video';
                $fallbackRecords = $this->records($range['cache_from'], $range['to'], $fallbackType);
                $fallbackSeries = $this->series($city, $range['dates'], $fallbackRecords);

                if ($this->seriesHasData($fallbackSeries)) {
                    $type = $fallbackType;
                    $records = $fallbackRecords;
                    $series = $fallbackSeries;
                }
            }

            return [
                'available' => true,
                'data_available' => $this->seriesHasData($series),
                'title' => $city['label'].'候選人影片觀看支持度',
                'city' => $city,
                'cities' => $this->cities(),
                'city_regions' => $this->cityRegions(),
                'static_cities' => $this->staticCityKeys(),
                'range' => $range,
                'type' => $type,
                'type_name' => $this->types()[$type],
                'types' => $this->types(),
                'series' => $series,
                'cache_rows' => collect($records)->flatten(1)->count(),
                'tagids' => $this->tagIds(),
                'legacy_source' => $city['source'],
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
        return collect(self::CITY_REGIONS)
            ->flatMap(fn (array $region): array => $region['cities'])
            ->values()
            ->all();
    }

    /**
     * @return array<string, array{label: string, cities: list<string>}>
     */
    public function cityRegions(): array
    {
        return self::CITY_REGIONS;
    }

    /**
     * @return array<string, array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}>
     */
    public function cities(): array
    {
        return $this->fallbackCities();
    }

    /**
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}
     */
    private function city(string $key): array
    {
        $cities = $this->cities();

        return $cities[$key] ?? $this->parseCityFile($key) ?? $cities['taipei'];
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
    private function range(Request $request, ?string $defaultTo = null): array
    {
        $now = CarbonImmutable::now('Asia/Taipei');
        $days = max(1, min(366, (int) $request->query('days', 30)));
        $today = max(0, min(3650, (int) $request->query('today', 0)));

        if ($request->filled('from') || $request->filled('to')) {
            $fallbackTo = $now->subDays($today)->toDateString();
            $to = $this->dateString($request->query('to'), $fallbackTo);
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days - 1)->toDateString());
        } else {
            $to = $defaultTo !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $defaultTo)
                ? $defaultTo
                : ($request->has('today')
                ? $now->subDays($today)->toDateString()
                : $now->subDay()->toDateString());
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

    private function latestCacheDate(string $type): ?string
    {
        $latest = DB::table('urt_show_tag_date')
            ->whereIn('tagid', collect($this->tagIds())->map(fn (int $tagId): string => (string) $tagId)->all())
            ->where(function (Builder $query): void {
                $query->whereNull('tag_or')->orWhere('tag_or', '');
            })
            ->where(function (Builder $query): void {
                $query->whereNull('tag_not')->orWhere('tag_not', '');
            })
            ->whereNotNull($type)
            ->max('the_date');

        return is_string($latest) && preg_match('/^\d{4}-\d{2}-\d{2}/', $latest)
            ? substr($latest, 0, 10)
            : null;
    }

    private function hasExplicitDate(Request $request): bool
    {
        return $request->filled('from') || $request->filled('to') || $request->has('today');
    }

    /**
     * @param list<array{raw: array<string, float>}> $series
     */
    private function seriesHasData(array $series): bool
    {
        return collect($series)->contains(
            fn (array $row): bool => collect($row['raw'])->contains(fn (float $value): bool => abs($value) > 0.000001),
        );
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

                $supportScores = collect($raw)
                    ->map(fn (float $score): float => max(0.0, $score))
                    ->all();
                $total = array_sum($supportScores);
                $percentages = [];

                foreach ($supportScores as $candidate => $score) {
                    $percentages[$candidate] = $total > 0.000001 ? ($score / $total) * 100 : 0.0;
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
        return collect([
            $this->fallbackCity('taipei', '台北市', [
                '蔣萬安' => 'blue',
                '沈伯洋' => 'green',
                '郭璽' => 'other',
            ]),
            $this->fallbackCity('newtaipei', '新北市', [
                '李四川' => 'blue',
                '蘇巧慧' => 'green',
            ]),
            $this->fallbackCity('taoyuan', '桃園市', [
                '張善政' => 'blue',
                '黃世杰' => 'green',
            ]),
            $this->fallbackCity('taichung', '台中市', [
                '江啟臣' => 'blue',
                '何欣純' => 'green',
            ]),
            $this->fallbackCity('tainan', '台南市', [
                '謝龍介' => 'blue',
                '陳亭妃' => 'green',
            ]),
            $this->fallbackCity('kaohsiung', '高雄市', [
                '柯志恩' => 'blue',
                '賴瑞隆' => 'green',
                '張靜' => 'other',
            ]),
            $this->fallbackCity('keelung', '基隆市', [
                '謝國樑' => 'blue',
                '童子瑋' => 'green',
            ]),
            $this->fallbackCity('hsinchu', '新竹市', [
                '高虹安' => 'white',
                '莊競程' => 'green',
            ]),
            $this->fallbackCity('hsinchucounty', '新竹縣', [
                '徐欣瑩' => 'blue',
            ]),
            $this->fallbackCity('miaoli', '苗栗縣', [
                '鍾東錦' => 'blue',
                '陳品安' => 'green',
            ]),
            $this->fallbackCity('changhua', '彰化縣', [
                '魏平政' => 'blue',
                '陳素月' => 'green',
                '蔡壁如' => 'white',
            ]),
            $this->fallbackCity('nantou', '南投縣', [
                '許淑華' => 'blue',
                '溫世政' => 'green',
            ]),
            $this->fallbackCity('yunlin', '雲林縣', [
                '張嘉郡' => 'blue',
                '劉建國' => 'green',
            ]),
            $this->fallbackCity('chiayi', '嘉義縣', [
                '蔡易餘' => 'green',
            ]),
            $this->fallbackCity('chiayicity', '嘉義市', [
                '張啓楷' => 'white',
                '王美惠' => 'green',
                '黃宏成台灣阿成世界偉人財神總統' => 'other',
            ]),
            $this->fallbackCity('pingtung', '屏東縣', [
                '周春米' => 'green',
                '蘇清泉' => 'blue',
            ]),
            $this->fallbackCity('yilan', '宜蘭縣', [
                '吳宗憲' => 'blue',
                '林國漳' => 'green',
                '陳琬惠' => 'white',
            ]),
            $this->fallbackCity('hualien', '花蓮縣', [
                '游淑貞' => 'blue',
                '張峻' => 'other',
                '魏嘉賢' => 'other',
            ]),
            $this->fallbackCity('taitung', '台東縣', [
                '吳秀華' => 'blue',
                '陳瑩' => 'green',
            ]),
            $this->fallbackCity('penghu', '澎湖縣', [
                '陳光復' => 'green',
                '陳振中' => 'blue',
                '葉竹林' => 'other',
                '陳盡川' => 'other',
                '許智富' => 'other',
            ]),
            $this->fallbackCity('kinmen', '金門縣', [
                '陳玉珍' => 'blue',
                '楊鎮浯' => 'blue',
                '李文良' => 'other',
            ]),
            $this->fallbackCity('lienchiang', '連江縣', [
                '王忠銘' => 'blue',
            ]),
        ])
            ->keyBy('key')
            ->all();
    }

    /**
     * @param array<string, string> $candidateBlocs
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}
     */
    private function fallbackCity(string $key, string $label, array $candidateBlocs): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'candidates' => array_keys($candidateBlocs),
            'factors' => collect($candidateBlocs)
                ->map(fn (string $bloc): array => $this->factorTemplate($bloc))
                ->all(),
            'source' => 'curated: 2026 county/city head election public nomination and declaration list, updated 2026-05-28',
        ];
    }

    /**
     * @return array<int, float>
     */
    private function factorTemplate(string $bloc): array
    {
        return match ($bloc) {
            'green' => [3 => -0.1, 4 => 3.0, 5 => -0.2, 6 => 0.5],
            'white' => [3 => 0.5, 4 => -0.3, 5 => 1.0, 6 => 5.0],
            'other' => [3 => 0.2, 4 => 0.2, 5 => 0.8, 6 => 0.8],
            default => [3 => 1.0, 4 => -0.9, 5 => 1.0, 6 => 1.0],
        };
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
            'city_regions' => $this->cityRegions(),
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
