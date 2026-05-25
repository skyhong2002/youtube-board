<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AiDailyPromptReport
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array{available: bool, title: string, date: string|null, condition: string, data_type: string, period: array{from: string, to: string, previous: string, next: string}, rows: list<array<string, mixed>>, media_without_events: list<string>, prompt: string, prompt_bounds: array{min: int, max: int}, filters: array<string, string|int>, generated_at: string}
     */
    public function forRequest(Request $request): array
    {
        $condition = $this->condition($request->route('condition') ?? $request->query('condition'));
        $dataType = $this->dataType($request->query('type', 'oneday'));
        $date = $this->date($request);

        try {
            if ($date === null) {
                $date = $this->latestDate($condition, $dataType);
            }

            if ($date === null) {
                return $this->empty(true, null, $condition, $dataType);
            }

            $filters = $this->filters($request, $condition);
            $period = $this->period($request, $date);
            $rows = $this->rows($filters, $period, $dataType, $condition);
            $bounds = $this->promptBounds($condition);
            $mediaWithoutEvents = collect($rows)
                ->filter(fn (array $row): bool => $row['events'] === [])
                ->pluck('title')
                ->values()
                ->all();

            return [
                'available' => true,
                'title' => $this->title($date, $condition),
                'date' => $date,
                'condition' => $condition,
                'data_type' => $dataType,
                'period' => $period,
                'rows' => $rows,
                'media_without_events' => $mediaWithoutEvents,
                'prompt' => $this->prompt($rows, $bounds, $condition),
                'prompt_bounds' => $bounds,
                'filters' => $this->displayFilters($filters, $condition, $dataType),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false, $date, $condition, $dataType);
        }
    }

    private function date(Request $request): ?string
    {
        $date = $request->route('date') ?? $request->query('date');

        return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null;
    }

    private function condition(mixed $value): string
    {
        $condition = is_string($value) && $value !== '' ? $value : 'all';

        return preg_match('/^[a-zA-Z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    private function dataType(mixed $value): string
    {
        return is_string($value) && in_array($value, ['todate', 'oneday', 'week'], true) ? $value : 'oneday';
    }

    private function latestDate(string $condition, string $dataType): ?string
    {
        $query = DB::table('urt_channel_ai')
            ->where('data_type', $dataType)
            ->whereNull('del_flag');

        if ($condition !== 'all') {
            $uIds = $this->matchingUIds($this->conditionFilters($condition));
            $query->whereIn('u_id', $uIds ?: [0]);
        }

        $latest = $query->max('date_from');

        return is_string($latest) && $latest !== '' ? substr($latest, 0, 10) : null;
    }

    /**
     * @return array{from: string, to: string, previous: string, next: string}
     */
    private function period(Request $request, string $date): array
    {
        if ($request->filled('from')) {
            $fromDate = $this->boundedDate((string) $request->query('from'), $date);
            $toDate = $this->boundedDate((string) $request->query('to', $fromDate), $fromDate);

            if ($fromDate > $toDate) {
                [$fromDate, $toDate] = [$toDate, $fromDate];
            }
        } else {
            $fromDate = $date;
            $toDate = $date;
        }

        return [
            'from' => $fromDate.' 00:00:00',
            'to' => $toDate.' 23:59:59',
            'previous' => Carbon::parse($fromDate, 'Asia/Taipei')->subDay()->toDateString(),
            'next' => Carbon::parse($toDate, 'Asia/Taipei')->addDay()->toDateString(),
        ];
    }

    private function boundedDate(string $date, string $fallback): string
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : $fallback;
    }

    /**
     * @return array{or: list<int>, tagid: list<int>, not: list<int>, limit: int}
     */
    private function filters(Request $request, string $condition): array
    {
        $hasExplicitCondition = $request->route('condition') !== null || $request->query->has('condition');
        $hasLegacyFilter = $request->query->has('tagid') || $request->query->has('or') || $request->query->has('not');
        $filters = $condition === 'all'
            ? $this->tagFilter->filters($request)
            : $this->conditionFilters($condition);

        if ($condition === 'all' && $hasExplicitCondition) {
            $filters = ['or' => [], 'tagid' => [], 'not' => [], 'limit' => $filters['limit']];
        } elseif ($condition === 'all' && ! $hasLegacyFilter) {
            $filters = ['or' => [], 'tagid' => [], 'not' => [31, 41], 'limit' => $filters['limit']];
        }

        $filters['limit'] = max(1, min(1000, (int) $request->query('limit', $filters['limit'] ?? 1000)));

        return $filters;
    }

    /**
     * @return array{or: list<int>, tagid: list<int>, not: list<int>, limit: int}
     */
    private function conditionFilters(string $condition): array
    {
        return match ($condition) {
            'blue' => ['or' => [], 'tagid' => [3], 'not' => [], 'limit' => 1000],
            'green' => ['or' => [], 'tagid' => [4], 'not' => [], 'limit' => 1000],
            'neutral' => ['or' => [], 'tagid' => [], 'not' => [3, 4, 5, 6, 31, 41], 'limit' => 1000],
            'finance' => ['or' => [], 'tagid' => [31], 'not' => [], 'limit' => 1000],
            'world' => ['or' => [], 'tagid' => [41], 'not' => [], 'limit' => 1000],
            default => ['or' => [], 'tagid' => [], 'not' => [], 'limit' => 1000],
        };
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>} $filters
     * @return list<int>
     */
    private function matchingUIds(array $filters): array
    {
        if ($filters['or'] === [] && $filters['tagid'] === [] && $filters['not'] === []) {
            return [];
        }

        return $this->tagFilter->matchingChannelTags($filters)
            ->pluck('u_id')
            ->map(fn (mixed $uId): int => (int) $uId)
            ->values()
            ->all();
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, limit: int} $filters
     * @param array{from: string, to: string} $period
     * @return list<array<string, mixed>>
     */
    private function rows(array $filters, array $period, string $dataType, string $condition): array
    {
        $query = DB::table('urt_channel_ai as ai')
            ->leftJoin('urt_channel as c', 'ai.u_id', '=', 'c.u_id')
            ->where('ai.date_from', $period['from'])
            ->where('ai.date_to', $period['to'])
            ->where('ai.data_type', $dataType)
            ->whereNull('ai.del_flag')
            ->orderByDesc('ai.pk')
            ->select(['ai.pk', 'ai.u_id', 'ai.result_json', 'c.title']);

        $uIds = $this->matchingUIds($filters);

        if ($uIds !== []) {
            $query->whereIn('ai.u_id', $uIds);
        } elseif ($filters['or'] !== [] || $filters['tagid'] !== [] || $filters['not'] !== []) {
            $query->whereRaw('1 = 0');
        }

        $seen = [];
        $rows = [];

        foreach ($query->limit($filters['limit'])->get() as $row) {
            $uId = (int) $row->u_id;

            if (isset($seen[$uId])) {
                continue;
            }

            $seen[$uId] = true;
            $events = $this->events($row->result_json ?? null, $condition);
            $videoCount = collect($events)->sum('video_count');

            $rows[] = [
                'pk' => (int) $row->pk,
                'u_id' => $uId,
                'title' => $row->title ?? 'Unknown channel',
                'events' => $events,
                'video_count' => $videoCount,
            ];
        }

        return collect($rows)
            ->sortByDesc('video_count')
            ->values()
            ->all();
    }

    /**
     * @return list<array{event: string, description: string, video_count: int, keywords: list<string>}>
     */
    private function events(mixed $json, string $condition): array
    {
        return collect($this->decodeList($json))
            ->map(function (mixed $item) use ($condition): ?array {
                $item = is_array($item) ? $item : [];
                $videoIds = $this->stringList($item, ['videoId', 'video_id', 'video_ids', 'videos']);

                if ($condition === 'all' && count($videoIds) <= 1) {
                    return null;
                }

                $event = $this->text($item, ['事件', '議題', 'topic', 'title']);

                if ($event === '') {
                    return null;
                }

                return [
                    'event' => $event,
                    'description' => $this->text($item, ['描述', '說明', 'description', 'content']),
                    'video_count' => count($videoIds),
                    'keywords' => $this->stringList($item, ['關鍵字', 'keywords']),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<mixed>
     */
    private function decodeList(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        if (json_last_error() !== JSON_ERROR_NONE || ! is_array($decoded)) {
            return [];
        }

        foreach (['events', '事件', 'topics', '議題', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return array_is_list($decoded) ? $decoded : array_values($decoded);
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
     * @param list<string> $keys
     * @return list<string>
     */
    private function stringList(array $item, array $keys): array
    {
        foreach ($keys as $key) {
            if (! isset($item[$key])) {
                continue;
            }

            if (is_array($item[$key])) {
                return collect($item[$key])
                    ->flatten()
                    ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
                    ->map(fn (mixed $value): string => trim((string) $value))
                    ->values()
                    ->all();
            }

            if (is_scalar($item[$key]) && trim((string) $item[$key]) !== '') {
                return [trim((string) $item[$key])];
            }
        }

        return [];
    }

    /**
     * @return array{min: int, max: int}
     */
    private function promptBounds(string $condition): array
    {
        return $condition === 'all' ? ['min' => 15, 'max' => 20] : ['min' => 8, 'max' => 12];
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param array{min: int, max: int} $bounds
     */
    private function prompt(array $rows, array $bounds, string $condition): string
    {
        $lines = [
            '下面是幾個媒體的事件列表，其中包含事件與描述，能否把可能是不同媒體事件但是指相同事情合併成 '.$bounds['min'].' 到 '.$bounds['max'].' 個事件，且不要一個事件只剩一個媒體。',
            '',
            '輸出資料其中包含事件整體標題，及屬於這分類的媒體與事件列表，格式用',
            '',
            '[',
            '    {',
            '        "標題": "<標題名>",',
            '        "媒體事件": {',
            '            "<媒體名>": ["<事件名>"]',
            '        }',
            '    }',
            ']',
            '這樣的 JSON 輸出，輸出時請勿更動媒體名與其事件名，且過濾掉只有一個媒體的事件：',
            '',
        ];

        foreach ($rows as $row) {
            if ($row['events'] === []) {
                continue;
            }

            $lines[] = '媒體名：'.$row['title'];

            foreach ($row['events'] as $event) {
                $lines[] = '- 事件：'.$event['event'];
                $lines[] = '  描述：'.$event['description'];
                $lines[] = '  新聞數：'.$event['video_count'];
                $lines[] = '  關鍵字：'.implode(', ', $event['keywords']);
            }

            $lines[] = '';
        }

        if ($condition !== 'all') {
            $lines[] = '條件：'.$condition;
        }

        return implode("\n", $lines);
    }

    /**
     * @param array{or: list<int>, tagid: list<int>, not: list<int>, limit: int} $filters
     * @return array<string, string|int>
     */
    private function displayFilters(array $filters, string $condition, string $dataType): array
    {
        return array_filter([
            'condition' => $condition,
            'type' => $dataType,
            'tagid' => implode(',', $filters['tagid']),
            'or' => implode(',', $filters['or']),
            'not' => implode(',', $filters['not']),
            'limit' => $filters['limit'],
        ], fn (mixed $value): bool => $value !== '');
    }

    private function title(string $date, string $condition): string
    {
        return $date.' '.$condition.' AI daily prompt preview';
    }

    /**
     * @return array{available: bool, title: string, date: string|null, condition: string, data_type: string, period: array{from: string, to: string, previous: string, next: string}, rows: list<array<string, mixed>>, media_without_events: list<string>, prompt: string, prompt_bounds: array{min: int, max: int}, filters: array<string, string|int>, generated_at: string}
     */
    private function empty(bool $available, ?string $date, string $condition, string $dataType): array
    {
        return [
            'available' => $available,
            'title' => ($date ?? 'AI daily').' prompt preview',
            'date' => $date,
            'condition' => $condition,
            'data_type' => $dataType,
            'period' => ['from' => '', 'to' => '', 'previous' => '', 'next' => ''],
            'rows' => [],
            'media_without_events' => [],
            'prompt' => '',
            'prompt_bounds' => $this->promptBounds($condition),
            'filters' => ['condition' => $condition, 'type' => $dataType],
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
