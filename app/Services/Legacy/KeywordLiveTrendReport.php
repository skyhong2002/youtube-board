<?php

namespace App\Services\Legacy;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class KeywordLiveTrendReport
{
    public function __construct(private readonly LegacyLiveGroupDefinitions $groups)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forRequest(Request $request): array
    {
        $keyword = trim((string) ($request->route('keyword') ?? $request->query('tag', '柯文哲'))) ?: '柯文哲';
        $group = $this->groups->get((string) $request->query('group', $request->query('view', 'position')));
        $type = $this->type($request);
        $range = $this->range($request);

        try {
            $series = $this->series($group, $keyword, $type, $range);

            return [
                'available' => true,
                'data_available' => collect($series)->contains(fn (array $row): bool => collect($row['values'])->contains(fn (int $value): bool => $value > 0)),
                'title' => $keyword.' 依 '.$group['label'].' 在 '.$range['days'].' 天的逐日直播線圖',
                'keyword' => $keyword,
                'group' => $group,
                'type' => $type,
                'type_name' => $type === 'videos' ? '直播影片數' : '直播觀看數',
                'range' => $range,
                'series' => $series,
                'cache_rows' => collect($series)->sum('cache_rows'),
                'options' => $this->groups->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return [
                'available' => false,
                'data_available' => false,
                'title' => $keyword.' 依 '.$group['label'].' 在 '.$range['days'].' 天的逐日直播線圖',
                'keyword' => $keyword,
                'group' => $group,
                'type' => $type,
                'type_name' => $type === 'videos' ? '直播影片數' : '直播觀看數',
                'range' => $range,
                'series' => [],
                'cache_rows' => 0,
                'options' => $this->groups->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    private function type(Request $request): string
    {
        $type = (string) $request->query('type', 'views');

        return in_array($type, ['videos', 'count_videos', 'tags_video'], true) ? 'videos' : 'views';
    }

    /**
     * @return array{from: string, to: string, cache_from: string, days: int, dates: list<string>}
     */
    private function range(Request $request): array
    {
        $days = max(1, min(90, (int) $request->query('days', 10)));
        $todayOffset = max(0, min(3650, (int) $request->query('today', 0)));
        $fallbackTo = now('Asia/Taipei')->subDays($todayOffset)->toDateString();

        if ($request->filled('from') || $request->filled('to')) {
            $from = $this->dateString($request->query('from'), CarbonImmutable::parse($fallbackTo, 'Asia/Taipei')->subDays($days)->toDateString());
            $to = $this->dateString($request->query('to'), $fallbackTo);
        } else {
            $to = $fallbackTo;
            $from = CarbonImmutable::parse($to, 'Asia/Taipei')->subDays($days)->toDateString();
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $dates = [];
        $cursor = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');

        while ($cursor <= $end && count($dates) < 91) {
            $dates[] = $cursor->toDateString();
            $cursor = $cursor->addDay();
        }

        return [
            'from' => $from,
            'to' => $to,
            'cache_from' => CarbonImmutable::parse($from, 'Asia/Taipei')->subDays(6)->toDateString(),
            'days' => max(1, count($dates) - 1),
            'dates' => $dates,
        ];
    }

    private function dateString(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) ? $value : $fallback;
    }

    /**
     * @param array{name: string, label: string, groups: list<array{name: string, filters: array<string, mixed>}>} $group
     * @param array{from: string, to: string, cache_from: string, dates: list<string>} $range
     * @return list<array{date: string, values: array<string, int>, cache_rows: int}>
     */
    private function series(array $group, string $keyword, string $type, array $range): array
    {
        $byGroup = [];

        foreach ($group['groups'] as $item) {
            $filters = $item['filters'];
            $records = DB::table('urt_show_live_tag_date')
                ->where('tagid', $filters['tagid_string'])
                ->where('tag_or', $filters['or_string'])
                ->where('tag_not', $filters['not_string'])
                ->whereBetween('the_date', [$range['cache_from'], $range['to']])
                ->orderByDesc('pk')
                ->get();

            $byDate = [];

            foreach ($records as $record) {
                $date = substr((string) $record->the_date, 0, 10);

                if ($date !== '' && ! isset($byDate[$date])) {
                    $byDate[$date] = $record;
                }
            }

            $byGroup[$item['name']] = $byDate;
        }

        $series = [];

        foreach ($range['dates'] as $date) {
            $values = [];
            $cacheRows = 0;

            foreach ($group['groups'] as $item) {
                $sum = 0;

                for ($i = 0; $i <= 6; $i++) {
                    $priorDate = CarbonImmutable::parse($date, 'Asia/Taipei')->subDays($i)->toDateString();
                    $record = $byGroup[$item['name']][$priorDate] ?? null;

                    if (! $record) {
                        continue;
                    }

                    $cacheRows++;
                    $column = $type === 'videos' ? 'tags_video' : 'tags_views';
                    $keywordHours = $this->decodeMap($record->{$column} ?? null)[$keyword] ?? [];
                    $sum += $this->maxHourValue($keywordHours);
                }

                $values[$item['name']] = $sum;
            }

            $series[] = [
                'date' => $date,
                'values' => $values,
                'cache_rows' => $cacheRows,
            ];
        }

        return $series;
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

    private function maxHourValue(mixed $hours): int
    {
        if (! is_array($hours)) {
            return 0;
        }

        return collect($hours)
            ->filter(fn (mixed $value): bool => is_scalar($value))
            ->map(fn (mixed $value): int => (int) $value)
            ->max() ?? 0;
    }
}
