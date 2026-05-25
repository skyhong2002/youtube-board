<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class GroupLiveReport
{
    public function __construct(private readonly LegacyKeywordGroupDefinitions $groupDefinitions)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forRequest(Request $request): array
    {
        $tagSetKey = (string) ($request->route('groupName') ?? $request->query('group', 'tags_president2024'));
        $tagSet = $this->tagSet($tagSetKey);
        $viewKey = (string) $request->query('view', 'position');
        $comparison = $this->groupDefinitions->get($viewKey, $request->boolean('all'));
        $metric = $this->metric($request);

        try {
            $dateRange = $this->dateRange($request, $comparison);
            $dates = $this->dates($dateRange['from'], $dateRange['to']);
            $lookbackFrom = CarbonImmutable::parse($dateRange['from'], 'Asia/Taipei')->subDays(6)->toDateString();
            $groups = $this->groups($comparison, $tagSet['tags'], $metric['column'], $lookbackFrom, $dateRange['to'], $dates);
            $dataAvailable = collect($groups)
                ->contains(fn (array $group): bool => collect($group['series'])->contains(fn (array $series): bool => $series['peak'] > 0));

            return [
                'available' => $tagSet['tags'] !== [] && $dataAvailable,
                'data_available' => $dataAvailable,
                'title' => $tagSet['label'].' 分 '.$comparison['label'].' 的直播排行',
                'tag_set' => $tagSet,
                'comparison' => $comparison,
                'metric' => $metric,
                'from' => $dateRange['from'],
                'to' => $dateRange['to'],
                'days' => $dateRange['days'],
                'dates' => $dates,
                'groups' => $groups,
                'options' => $this->groupDefinitions->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            $dateRange = $this->fallbackDateRange($request);

            return [
                'available' => false,
                'data_available' => false,
                'title' => $tagSet['label'].' 分 '.$comparison['label'].' 的直播排行',
                'tag_set' => $tagSet,
                'comparison' => $comparison,
                'metric' => $metric,
                'from' => $dateRange['from'],
                'to' => $dateRange['to'],
                'days' => $dateRange['days'],
                'dates' => [],
                'groups' => [],
                'options' => $this->groupDefinitions->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    /**
     * @param  array{name: string, label: string, groups: list<array{name: string, filters: array<string, mixed>}>}  $comparison
     * @param  list<string>  $tags
     * @param  list<string>  $dates
     * @return list<array<string, mixed>>
     */
    private function groups(array $comparison, array $tags, string $metricColumn, string $lookbackFrom, string $to, array $dates): array
    {
        return collect($comparison['groups'])
            ->map(function (array $group) use ($tags, $metricColumn, $lookbackFrom, $to, $dates): array {
                $records = $this->records($group, $metricColumn, $lookbackFrom, $to);
                $dailyMax = [];

                foreach ($records as $date => $json) {
                    $metricMap = $this->decodeMap($json);

                    foreach ($tags as $tag) {
                        $dailyMax[$tag][$date] = $this->maxHourlyValue($metricMap[$tag] ?? []);
                    }
                }

                $series = collect($tags)
                    ->map(function (string $tag) use ($dailyMax, $dates): array {
                        $values = collect($dates)
                            ->map(function (string $date) use ($dailyMax, $tag): array {
                                $value = 0;

                                for ($offset = 0; $offset < 7; $offset++) {
                                    $day = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($offset)->toDateString();
                                    $value += (int) ($dailyMax[$tag][$day] ?? 0);
                                }

                                return [
                                    'date' => $date,
                                    'value' => $value,
                                ];
                            })
                            ->values()
                            ->all();

                        return [
                            'tag' => $tag,
                            'values' => $values,
                            'latest' => (int) (collect($values)->last()['value'] ?? 0),
                            'peak' => collect($values)->max('value') ?? 0,
                        ];
                    })
                    ->sortByDesc('latest')
                    ->values()
                    ->all();

                return [
                    'name' => $group['name'],
                    'tag_para' => $group['tag_para'],
                    'cache_rows' => count($records),
                    'series' => $series,
                    'latest_total' => collect($series)->sum('latest'),
                ];
            })
            ->values()
            ->all();
    }

    /**
     * @param  array{name: string, filters: array<string, mixed>}  $group
     * @return array<string, string|null>
     */
    private function records(array $group, string $metricColumn, string $from, string $to): array
    {
        $filters = $group['filters'];

        return DB::table('urt_show_live_tag_date')
            ->where('tagid', $filters['tagid_string'])
            ->where('tag_or', $filters['or_string'])
            ->where('tag_not', $filters['not_string'])
            ->whereBetween('the_date', [$from, $to])
            ->orderBy('the_date')
            ->get(['the_date', $metricColumn])
            ->mapWithKeys(fn (object $row): array => [substr((string) $row->the_date, 0, 10) => $row->{$metricColumn}])
            ->all();
    }

    /**
     * @param  array{name: string, groups: list<array{name: string, filters: array<string, mixed>}>}  $comparison
     * @return array{from: string, to: string, days: int}
     */
    private function dateRange(Request $request, array $comparison): array
    {
        if ($request->query('from') || $request->query('to') || $request->query('today') !== null) {
            return $this->fallbackDateRange($request);
        }

        $latest = $this->latestCacheDate($comparison) ?? now('Asia/Taipei')->toDateString();
        $days = max(1, min(120, (int) $request->query('days', 30)));

        return [
            'from' => CarbonImmutable::parse($latest, 'Asia/Taipei')->subDays($days - 1)->toDateString(),
            'to' => $latest,
            'days' => $days,
        ];
    }

    /**
     * @param  array{name: string, groups: list<array{name: string, filters: array<string, mixed>}>}  $comparison
     */
    private function latestCacheDate(array $comparison): ?string
    {
        $latest = null;

        foreach ($comparison['groups'] as $group) {
            $filters = $group['filters'];
            $date = DB::table('urt_show_live_tag_date')
                ->where('tagid', $filters['tagid_string'])
                ->where('tag_or', $filters['or_string'])
                ->where('tag_not', $filters['not_string'])
                ->max('the_date');

            if (is_string($date) && ($latest === null || $date > $latest)) {
                $latest = substr($date, 0, 10);
            }
        }

        return $latest;
    }

    /**
     * @return array{from: string, to: string, days: int}
     */
    private function fallbackDateRange(Request $request): array
    {
        $days = max(1, min(120, (int) $request->query('days', 30)));
        $todayOffset = max(0, min(365, (int) $request->query('today', 0)));
        $to = $this->validDate((string) $request->query('to', ''))
            ?? now('Asia/Taipei')->subDays($todayOffset)->toDateString();
        $from = $this->validDate((string) $request->query('from', ''))
            ?? CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days - 1)->toDateString();

        return [
            'from' => $from,
            'to' => $to,
            'days' => count($this->dates($from, $to)),
        ];
    }

    private function validDate(string $value): ?string
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : null;
    }

    /**
     * @return list<string>
     */
    private function dates(string $from, string $to): array
    {
        return collect(CarbonPeriod::create($from, '1 day', $to))
            ->map(fn ($date): string => CarbonImmutable::instance($date)->toDateString())
            ->values()
            ->all();
    }

    /**
     * @return array{column: string, label: string}
     */
    private function metric(Request $request): array
    {
        return (string) $request->query('type', 'tags_views') === 'tags_video'
            ? ['column' => 'tags_video', 'label' => '直播影片數']
            : ['column' => 'tags_views', 'label' => '直播觀看數'];
    }

    /**
     * @return array{name: string, label: string, source_status: string, tags: list<string>}
     */
    private function tagSet(string $key): array
    {
        $key = trim(urldecode($key)) ?: 'tags_president2024';

        if (str_starts_with($key, 'tags_')) {
            return $this->tagSetFromLegacyFile($key);
        }

        try {
            $tags = DB::table('tag_group')
                ->where('group_name', $key)
                ->where(function ($query): void {
                    $query->whereNull('del_flag')->orWhere('del_flag', '<', '1');
                })
                ->orderBy('tag')
                ->pluck('tag')
                ->map(fn (mixed $tag): string => (string) $tag)
                ->filter()
                ->values()
                ->all();
        } catch (QueryException) {
            $tags = [];
        }

        return [
            'name' => $key,
            'label' => $key,
            'source_status' => $tags === [] ? 'missing' : 'tag_group',
            'tags' => $tags,
        ];
    }

    /**
     * @return array{name: string, label: string, source_status: string, tags: list<string>}
     */
    private function tagSetFromLegacyFile(string $key): array
    {
        $safeKey = preg_replace('/[^A-Za-z0-9_]/', '', $key) ?: 'tags_president2024';
        $path = rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube/group/'.$safeKey.'.php';
        $fallbacks = [
            'tags_president2024' => ['label' => '總統候選人', 'tags' => ['侯友宜', '柯文哲', '賴清德', '趙少康', '蕭美琴', '吳欣盈']],
            'tags_straits' => ['label' => '兩岸', 'tags' => ['石斑魚', '軍演', '共軍', '航母', '解放軍', '台海', '兩岸', '兩岸統一', '台獨']],
        ];

        if (! is_readable($path)) {
            $fallback = $fallbacks[$safeKey] ?? ['label' => $safeKey, 'tags' => []];

            return [
                'name' => $safeKey,
                'label' => $fallback['label'],
                'source_status' => 'fallback',
                'tags' => $fallback['tags'],
            ];
        }

        $source = (string) file_get_contents($path);
        $source = preg_replace('/\/\*.*?\*\//s', '', $source) ?? $source;
        $source = preg_replace('/^\s*\/\/.*$/m', '', $source) ?? $source;

        preg_match('/\$tags_name\s*=\s*"([^"]+)";/u', $source, $labelMatch);
        preg_match_all('/\$tag_array\[\]\s*=\s*"([^"]+)";/u', $source, $matches);

        return [
            'name' => $safeKey,
            'label' => $labelMatch[1] ?? $safeKey,
            'source_status' => 'parsed',
            'tags' => collect($matches[1] ?? [])->unique()->values()->all(),
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
     * @param  mixed  $hourly
     */
    private function maxHourlyValue(mixed $hourly): int
    {
        if (! is_array($hourly)) {
            return 0;
        }

        return collect($hourly)
            ->map(fn (mixed $value): int => (int) $value)
            ->max() ?? 0;
    }
}
