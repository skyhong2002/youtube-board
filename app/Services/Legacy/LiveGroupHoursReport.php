<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class LiveGroupHoursReport
{
    public function __construct(private readonly LegacyLiveGroupDefinitions $groups)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function forRequest(Request $request): array
    {
        $groupKey = (string) ($request->route('group') ?? $request->query('group', 'media'));
        $group = $this->groups->get($groupKey);
        $hours = collect(range(0, 23))->map(fn (int $hour): string => sprintf('%02d', $hour))->all();

        try {
            $date = $this->date($request, $group);
            $records = $this->recordsForDate($group, $date);
            $rows = [];

            foreach ($hours as $hour) {
                $cells = [];

                foreach ($group['groups'] as $item) {
                    $record = $records[$item['name']] ?? null;
                    $hourMap = $this->decodeMap($record->hour_result ?? null);
                    $cells[$item['name']] = [
                        'views' => (int) ($hourMap[$hour]['views'] ?? 0),
                        'count' => (int) ($hourMap[$hour]['count'] ?? 0),
                    ];
                }

                $rows[] = [
                    'hour' => $hour,
                    'cells' => $cells,
                ];
            }

            return [
                'available' => true,
                'data_available' => collect($rows)->contains(fn (array $row): bool => collect($row['cells'])->contains(fn (array $cell): bool => $cell['views'] > 0 || $cell['count'] > 0)),
                'title' => $group['label'].' 在 '.$date.' 每小時直播總人數',
                'group' => $group,
                'date' => $date,
                'rows' => $rows,
                'cache_rows' => count($records),
                'options' => $this->groups->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            $date = $this->requestedDate($request);

            return [
                'available' => false,
                'data_available' => false,
                'title' => $group['label'].' 在 '.$date.' 每小時直播總人數',
                'group' => $group,
                'date' => $date,
                'rows' => [],
                'cache_rows' => 0,
                'options' => $this->groups->options(),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        }
    }

    private function isCalendarDate(string $value): bool
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $parts) === 1
            && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
    }

    private function requestedDate(Request $request): string
    {
        $requested = (string) $request->query('date', '');

        if ($this->isCalendarDate($requested)) {
            return $requested;
        }

        return now('Asia/Taipei')->toDateString();
    }

    /**
     * @param array{name: string, label: string, groups: list<array{name: string, filters: array<string, mixed>}>} $group
     */
    private function date(Request $request, array $group): string
    {
        $requested = (string) $request->query('date', '');

        if ($this->isCalendarDate($requested)) {
            return $requested;
        }

        $latest = null;

        foreach ($group['groups'] as $item) {
            $filters = $item['filters'];
            $date = DB::table('urt_show_live_tag_date')
                ->where('tagid', $filters['tagid_string'])
                ->where('tag_or', $filters['or_string'])
                ->where('tag_not', $filters['not_string'])
                ->max('the_date');

            if (is_string($date) && ($latest === null || $date > $latest)) {
                $latest = substr($date, 0, 10);
            }
        }

        return $latest ?? now('Asia/Taipei')->toDateString();
    }

    /**
     * @param array{name: string, label: string, groups: list<array{name: string, filters: array<string, mixed>}>} $group
     * @return array<string, object>
     */
    private function recordsForDate(array $group, string $date): array
    {
        $records = [];

        foreach ($group['groups'] as $item) {
            $filters = $item['filters'];
            $record = DB::table('urt_show_live_tag_date')
                ->where('tagid', $filters['tagid_string'])
                ->where('tag_or', $filters['or_string'])
                ->where('tag_not', $filters['not_string'])
                ->where('the_date', $date)
                ->orderByDesc('pk')
                ->first();

            if ($record) {
                $records[$item['name']] = $record;
            }
        }

        return $records;
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
