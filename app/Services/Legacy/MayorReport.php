<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MayorReport
{
    private const ROLLING_DAYS = 7;

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
                'title' => $city['label'].'候選人媒體聲量趨勢',
                'city' => $city,
                'cities' => $this->cities(),
                'city_regions' => $this->cityRegions(),
                'static_cities' => $this->staticCityKeys(),
                'range' => $range,
                'type' => $type,
                'type_name' => $this->types()[$type],
                'types' => $this->types(),
                'rolling_days' => self::ROLLING_DAYS,
                'series' => $series,
                'cache_rows' => collect($records)->flatten(1)->count(),
                'coverage' => $this->coverage($range['dates'], $records),
                'tagids' => $this->tagIds(),
                'tag_labels' => $this->tagLabels(),
                'candidate_party_labels' => $this->candidatePartyLabels($city),
                'candidate_colors' => $this->candidateColors($city),
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
     * @return array<string, array{key: string, label: string, candidates: list<string>, candidate_blocs: array<string, string>, factors: array<string, array<int, float>>, source: string}>
     */
    public function cities(): array
    {
        return $this->fallbackCities();
    }

    /**
     * @return array{key: string, label: string, candidates: list<string>, candidate_blocs: array<string, string>, factors: array<string, array<int, float>>, source: string}
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
     * @return array<int, string>
     */
    private function tagLabels(): array
    {
        return [
            3 => '泛藍',
            4 => '泛綠',
            5 => '泛紅',
            6 => '泛白',
        ];
    }

    /**
     * @return array<string, string>
     */
    private function blocPartyLabels(): array
    {
        return [
            'blue' => '中國國民黨',
            'green' => '民主進步黨',
            'white' => '台灣民眾黨',
            'other' => '無黨籍',
        ];
    }

    /**
     * @return array<string, string>
     */
    private function partyColors(): array
    {
        return [
            '中國國民黨' => '#2563eb',
            '民主進步黨' => '#16a34a',
            '台灣民眾黨' => '#0891b2',
            '無黨籍' => '#64748b',
            '台灣麻將最大黨' => '#7c3aed',
            '司法改革黨' => '#b45309',
            '台灣團結聯盟' => '#ca8a04',
            '台灣SoR無法黨' => '#be123c',
            '三勢團結促進聯盟' => '#db2777',
            '司法正義黨' => '#a16207',
            '台灣工黨' => '#0d9488',
        ];
    }

    /**
     * @param array{candidates: list<string>, candidate_blocs?: array<string, string>} $city
     * @return array<string, string>
     */
    private function candidatePartyLabels(array $city): array
    {
        $knownParties = $this->knownCandidateParties();
        $blocParties = $this->blocPartyLabels();

        return collect($city['candidates'])
            ->mapWithKeys(function (string $candidate) use ($city, $knownParties, $blocParties): array {
                $bloc = (string) ($city['candidate_blocs'][$candidate] ?? 'other');

                return [$candidate => $knownParties[$candidate] ?? $blocParties[$bloc] ?? '無黨籍'];
            })
            ->all();
    }

    /**
     * @param array{candidates: list<string>, candidate_blocs?: array<string, string>} $city
     * @return array<string, string>
     */
    private function candidateColors(array $city): array
    {
        $partyColors = $this->partyColors();
        $partyLabels = $this->candidatePartyLabels($city);

        return collect($city['candidates'])
            ->mapWithKeys(function (string $candidate) use ($partyColors, $partyLabels): array {
                $party = (string) ($partyLabels[$candidate] ?? '無黨籍');

                return [$candidate => $partyColors[$party] ?? $partyColors['無黨籍']];
            })
            ->all();
    }

    /**
     * Press spellings that cache builds count alongside the registered name.
     *
     * @return array<string, list<string>>
     */
    public function candidateKeywordAliases(): array
    {
        return [
            '温世政' => ['溫世政'],
        ];
    }

    /**
     * @return array<string, string>
     */
    private function knownCandidateParties(): array
    {
        return [
            '蔣萬安' => '中國國民黨',
            '沈伯洋' => '民主進步黨',
            '郭璽' => '台灣麻將最大黨',
            '蕭文乾' => '台灣SoR無法黨',
            '唐新民' => '三勢團結促進聯盟',
            '林志成' => '無黨籍',
            '李四川' => '中國國民黨',
            '蘇巧慧' => '民主進步黨',
            '蘇輝湟' => '無黨籍',
            '張善政' => '中國國民黨',
            '黃世杰' => '民主進步黨',
            '江啟臣' => '中國國民黨',
            '何欣純' => '民主進步黨',
            '洪麗華' => '司法正義黨',
            '謝龍介' => '中國國民黨',
            '陳亭妃' => '民主進步黨',
            '蕭燐洪' => '台灣SoR無法黨',
            '葉人文' => '無黨籍',
            '柯志恩' => '中國國民黨',
            '賴瑞隆' => '民主進步黨',
            '張靜' => '司法改革黨',
            '王肇民' => '無黨籍',
            '洪方隆' => '無黨籍',
            '謝國樑' => '中國國民黨',
            '童子瑋' => '民主進步黨',
            '魏造文' => '無黨籍',
            '高虹安' => '無黨籍',
            '莊競程' => '民主進步黨',
            '何志勇' => '無黨籍',
            '徐欣瑩' => '中國國民黨',
            '鄭朝方' => '民主進步黨',
            '朱定瑀' => '無黨籍',
            '鍾東錦' => '中國國民黨',
            '陳品安' => '民主進步黨',
            '魏平政' => '中國國民黨',
            '陳素月' => '民主進步黨',
            '陳重嘉' => '無黨籍',
            '邱建富' => '無黨籍',
            '許淑華' => '中國國民黨',
            '温世政' => '民主進步黨',
            '張嘉郡' => '中國國民黨',
            '劉建國' => '民主進步黨',
            '吳炳輝' => '無黨籍',
            '林佳瑜' => '無黨籍',
            '蔡易餘' => '民主進步黨',
            '吳品叡' => '無黨籍',
            '張啓楷' => '台灣民眾黨',
            '王美惠' => '民主進步黨',
            '黃宏成台灣阿成世界偉人財神總統' => '無黨籍',
            '陳愷璜' => '無黨籍',
            '王義成' => '無黨籍',
            '周春米' => '民主進步黨',
            '蘇清泉' => '中國國民黨',
            '吳宗憲' => '中國國民黨',
            '林國漳' => '民主進步黨',
            '陳宏毅' => '無黨籍',
            '劉燦輝' => '無黨籍',
            '楊鉯婷' => '無黨籍',
            '游淑貞' => '中國國民黨',
            '張峻' => '無黨籍',
            '魏嘉賢' => '無黨籍',
            '羅佩秦' => '台灣工黨',
            '吳秀華' => '中國國民黨',
            '陳瑩' => '民主進步黨',
            '李吳穎智' => '無黨籍',
            '王志偉' => '無黨籍',
            '陳振中' => '中國國民黨',
            '吳淑瑾' => '民主進步黨',
            '周倪安' => '台灣團結聯盟',
            '許智富' => '無黨籍',
            '陳盡川' => '無黨籍',
            '葉竹林' => '無黨籍',
            '陳玉珍' => '中國國民黨',
            '李文良' => '無黨籍',
            '洪和成' => '無黨籍',
            '黃世團' => '無黨籍',
            '張國威' => '無黨籍',
            '梁文韜' => '無黨籍',
            '張火木' => '無黨籍',
            '王忠銘' => '中國國民黨',
            '曹爾元' => '無黨籍',
        ];
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
            'cache_from' => CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(self::ROLLING_DAYS - 1)->toDateString(),
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
            'tags_views' => '觀看聲量',
            'tags_video' => '影片提及聲量',
            'tags_result' => '關鍵字重要度',
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
     * @param list<array{raw: array<string, float|null>}> $series
     */
    private function seriesHasData(array $series): bool
    {
        return collect($series)->contains(
            fn (array $row): bool => collect($row['raw'])->contains(
                fn (mixed $value): bool => is_numeric($value) && abs((float) $value) > 0.000001,
            ),
        );
    }

    /**
     * @param  list<string>  $dates
     * @param  array<string, array<int, array<string, float>>>  $records
     * @return array{requested_days: int, covered_days: int, missing_days: int, complete: bool, first_covered_date: string|null, last_covered_date: string|null}
     */
    private function coverage(array $dates, array $records): array
    {
        $coveredDates = collect($dates)
            ->filter(fn (string $date): bool => isset($records[$date]) && count($records[$date]) > 0)
            ->values();

        return [
            'requested_days' => count($dates),
            'covered_days' => $coveredDates->count(),
            'missing_days' => count($dates) - $coveredDates->count(),
            'complete' => $coveredDates->count() === count($dates),
            'first_covered_date' => $coveredDates->first(),
            'last_covered_date' => $coveredDates->last(),
        ];
    }

    /**
     * @param array{key: string, label: string, candidates: list<string>, candidate_blocs?: array<string, string>, factors: array<string, array<int, float>>, source: string} $city
     * @param list<string> $dates
     * @param array<string, array<int, array<string, float>>> $records
     * @return list<array{date: string, percentages: array<string, float|null>, raw: array<string, float|null>, total: float|null, cache_rows: int, source_available: bool}>
     */
    private function series(array $city, array $dates, array $records): array
    {
        return collect($dates)
            ->map(function (string $date) use ($city, $records): array {
                $raw = [];
                $usedCacheRows = [];
                $sourceAvailable = false;

                foreach ($city['candidates'] as $candidate) {
                    $volume = 0.0;

                    foreach ($this->tagIds() as $tagId) {
                        for ($offset = 0; $offset < self::ROLLING_DAYS; $offset++) {
                            $sourceDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($offset)->toDateString();

                            if (isset($records[$sourceDate][$tagId])) {
                                $sourceAvailable = true;
                                $usedCacheRows[$sourceDate.'|'.$tagId] = true;
                            }

                            $volume += max(0.0, (float) ($records[$sourceDate][$tagId][$candidate] ?? 0.0));
                        }
                    }

                    $raw[$candidate] = $volume;
                }

                if (! $sourceAvailable) {
                    return [
                        'date' => $date,
                        'percentages' => array_fill_keys($city['candidates'], null),
                        'raw' => array_fill_keys($city['candidates'], null),
                        'total' => null,
                        'cache_rows' => 0,
                        'source_available' => false,
                    ];
                }

                $total = array_sum($raw);
                $percentages = [];

                foreach ($raw as $candidate => $volume) {
                    $percentages[$candidate] = $total > 0.000001 ? ($volume / $total) * 100 : 0.0;
                }

                return [
                    'date' => $date,
                    'percentages' => $percentages,
                    'raw' => $raw,
                    'total' => $total,
                    'cache_rows' => count($usedCacheRows),
                    'source_available' => true,
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
     * @return array{key: string, label: string, candidates: list<string>, candidate_blocs: array<string, string>, factors: array<string, array<int, float>>, source: string}|null
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
            'candidate_blocs' => collect($candidates)->mapWithKeys(fn (string $candidate): array => [$candidate => 'other'])->all(),
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
     * @return array<string, array{key: string, label: string, candidates: list<string>, candidate_blocs: array<string, string>, factors: array<string, array<int, float>>, source: string}>
     */
    private function fallbackCities(): array
    {
        return collect([
            $this->fallbackCity('taipei', '台北市', [
                '蔣萬安' => 'blue',
                '沈伯洋' => 'green',
                '郭璽' => 'other',
                '蕭文乾' => 'other',
                '唐新民' => 'other',
                '林志成' => 'other',
            ]),
            $this->fallbackCity('newtaipei', '新北市', [
                '李四川' => 'blue',
                '蘇巧慧' => 'green',
                '蘇輝湟' => 'other',
            ]),
            $this->fallbackCity('taoyuan', '桃園市', [
                '張善政' => 'blue',
                '黃世杰' => 'green',
            ]),
            $this->fallbackCity('taichung', '台中市', [
                '江啟臣' => 'blue',
                '何欣純' => 'green',
                '洪麗華' => 'other',
            ]),
            $this->fallbackCity('tainan', '台南市', [
                '謝龍介' => 'blue',
                '陳亭妃' => 'green',
                '蕭燐洪' => 'other',
                '葉人文' => 'other',
            ]),
            $this->fallbackCity('kaohsiung', '高雄市', [
                '柯志恩' => 'blue',
                '賴瑞隆' => 'green',
                '張靜' => 'other',
                '王肇民' => 'other',
                '洪方隆' => 'other',
            ]),
            $this->fallbackCity('keelung', '基隆市', [
                '謝國樑' => 'blue',
                '童子瑋' => 'green',
                '魏造文' => 'other',
            ]),
            $this->fallbackCity('hsinchu', '新竹市', [
                '高虹安' => 'other',
                '莊競程' => 'green',
                '何志勇' => 'other',
            ]),
            $this->fallbackCity('hsinchucounty', '新竹縣', [
                '徐欣瑩' => 'blue',
                '鄭朝方' => 'green',
                '朱定瑀' => 'other',
            ]),
            $this->fallbackCity('miaoli', '苗栗縣', [
                '鍾東錦' => 'blue',
                '陳品安' => 'green',
            ]),
            $this->fallbackCity('changhua', '彰化縣', [
                '魏平政' => 'blue',
                '陳素月' => 'green',
                '陳重嘉' => 'other',
                '邱建富' => 'other',
            ]),
            $this->fallbackCity('nantou', '南投縣', [
                '許淑華' => 'blue',
                '温世政' => 'green',
            ]),
            $this->fallbackCity('yunlin', '雲林縣', [
                '張嘉郡' => 'blue',
                '劉建國' => 'green',
                '吳炳輝' => 'other',
                '林佳瑜' => 'other',
            ]),
            $this->fallbackCity('chiayi', '嘉義縣', [
                '蔡易餘' => 'green',
                '吳品叡' => 'other',
            ]),
            $this->fallbackCity('chiayicity', '嘉義市', [
                '張啓楷' => 'white',
                '王美惠' => 'green',
                '黃宏成台灣阿成世界偉人財神總統' => 'other',
                '陳愷璜' => 'other',
                '王義成' => 'other',
            ]),
            $this->fallbackCity('pingtung', '屏東縣', [
                '周春米' => 'green',
                '蘇清泉' => 'blue',
            ]),
            $this->fallbackCity('yilan', '宜蘭縣', [
                '吳宗憲' => 'blue',
                '林國漳' => 'green',
                '陳宏毅' => 'other',
                '劉燦輝' => 'other',
                '楊鉯婷' => 'other',
            ]),
            $this->fallbackCity('hualien', '花蓮縣', [
                '游淑貞' => 'blue',
                '張峻' => 'other',
                '魏嘉賢' => 'other',
                '羅佩秦' => 'other',
            ]),
            $this->fallbackCity('taitung', '台東縣', [
                '吳秀華' => 'blue',
                '陳瑩' => 'green',
                '李吳穎智' => 'other',
                '王志偉' => 'other',
            ]),
            $this->fallbackCity('penghu', '澎湖縣', [
                '陳振中' => 'blue',
                '吳淑瑾' => 'green',
                '周倪安' => 'other',
                '許智富' => 'other',
                '陳盡川' => 'other',
                '葉竹林' => 'other',
            ]),
            $this->fallbackCity('kinmen', '金門縣', [
                '陳玉珍' => 'blue',
                '李文良' => 'other',
                '洪和成' => 'other',
                '黃世團' => 'other',
                '張國威' => 'other',
                '梁文韜' => 'other',
                '張火木' => 'other',
            ]),
            $this->fallbackCity('lienchiang', '連江縣', [
                '王忠銘' => 'blue',
                '曹爾元' => 'other',
            ]),
        ])
            ->keyBy('key')
            ->all();
    }

    /**
     * @param array<string, string> $candidateBlocs
     * @return array{key: string, label: string, candidates: list<string>, candidate_blocs: array<string, string>, factors: array<string, array<int, float>>, source: string}
     */
    private function fallbackCity(string $key, string $label, array $candidateBlocs): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'candidates' => array_keys($candidateBlocs),
            'candidate_blocs' => $candidateBlocs,
            'factors' => collect($candidateBlocs)
                ->map(fn (string $bloc): array => $this->factorTemplate($bloc))
                ->all(),
            'source' => 'curated: 2026 county/city head election public nomination and declaration list, approved by the Central Election Commission 2026-10-16',
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
     * @param array{key: string, label: string, candidates: list<string>, candidate_blocs?: array<string, string>, factors: array<string, array<int, float>>, source: string} $city
     * @return array<string, mixed>
     */
    private function unavailable(array $city, array $range, string $type): array
    {
        return [
            'available' => false,
            'data_available' => false,
            'title' => $city['label'].'候選人媒體聲量趨勢',
            'city' => $city,
            'cities' => $this->cities(),
            'city_regions' => $this->cityRegions(),
            'static_cities' => $this->staticCityKeys(),
            'range' => $range,
            'type' => $type,
            'type_name' => $this->types()[$type],
            'types' => $this->types(),
            'rolling_days' => self::ROLLING_DAYS,
            'series' => [],
            'cache_rows' => 0,
            'coverage' => [
                'requested_days' => count($range['dates']),
                'covered_days' => 0,
                'missing_days' => count($range['dates']),
                'complete' => false,
                'first_covered_date' => null,
                'last_covered_date' => null,
            ],
            'tagids' => $this->tagIds(),
            'tag_labels' => $this->tagLabels(),
            'candidate_party_labels' => $this->candidatePartyLabels($city),
            'candidate_colors' => $this->candidateColors($city),
            'legacy_source' => $city['source'],
            'generated_at' => CarbonImmutable::now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
