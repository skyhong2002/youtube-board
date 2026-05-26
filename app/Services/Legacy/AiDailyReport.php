<?php

namespace App\Services\Legacy;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AiDailyReport
{
    /**
     * @return array{
     *     available: bool,
     *     row: array<string, mixed>|null,
     *     date: string|null,
     *     condition: string,
     *     title: string,
     *     topics: list<array<string, mixed>>,
     *     channels_count: int,
     *     generated_at: string
     * }
     */
    public function forRequest(Request $request): array
    {
        $condition = $this->condition($request->route('condition') ?? $request->query('condition'));

        try {
            $row = $this->row($request, $condition);

            if (! $row) {
                $fallback = $this->channelAiFallback($request, $condition);

                if ($fallback !== null) {
                    return $fallback;
                }

                return $this->empty(true, $this->routeDate($request), $condition);
            }

            $date = substr((string) $row->date_from, 0, 10);
            $dateFrom = (string) $row->date_from;
            $dateTo = (string) $row->date_to;
            $channelMap = $this->channelMap($row->channel_id ?? null);
            $channelAi = $this->channelAi($channelMap, $dateFrom, $dateTo);
            $channelTags = $this->channelTags(array_keys($channelMap));
            $topics = $this->topics($row, $channelMap, $channelAi, $channelTags);

            return [
                'available' => true,
                'row' => [
                    'pk' => (int) $row->pk,
                    'date_from' => $dateFrom,
                    'date_to' => $dateTo,
                    'data_type' => $row->data_type ?? null,
                    'condition_type' => $row->condition_type ?? null,
                ],
                'date' => $date,
                'condition' => (string) ($row->condition_type ?: $condition),
                'title' => $this->title($date, (string) ($row->condition_type ?: $condition)),
                'topics' => $topics,
                'channels_count' => count($channelMap),
                'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
            ];
        } catch (QueryException) {
            return $this->empty(false, null, $condition);
        }
    }

    private function row(Request $request, string $condition): ?object
    {
        $pk = (int) $request->query('pk', 0);

        if ($pk > 0) {
            return DB::table('urt_ai_date')->where('pk', $pk)->first();
        }

        $date = $this->routeDate($request);

        if ($date === null) {
            $date = $this->latestDate($condition);
        }

        if ($date === null) {
            return null;
        }

        $query = DB::table('urt_ai_date')
            ->whereNull('del_flag')
            ->where('date_from', $date.' 00:00:00')
            ->where('date_to', $date.' 23:59:59');

        if ($condition === 'all') {
            $query->where(function ($inner): void {
                $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
            });
        } else {
            $query->where('condition_type', $condition);
        }

        if (is_string($request->query('type')) && $request->query('type') !== '') {
            $query->where('data_type', (string) $request->query('type'));
        }

        return $query->orderByDesc('pk')->first();
    }

    /**
     * Build a read-only daily page from existing per-channel AI rows when
     * legacy `urt_ai_date` has not been generated for that date/condition.
     *
     * @return array{available: bool, row: array<string, mixed>|null, date: string|null, condition: string, title: string, topics: list<array<string, mixed>>, channels_count: int, generated_at: string}|null
     */
    private function channelAiFallback(Request $request, string $condition): ?array
    {
        $date = $this->routeDate($request);

        if ($date === null || is_string($request->query('pk'))) {
            return null;
        }

        $dateFrom = $date.' 00:00:00';
        $dateTo = $date.' 23:59:59';
        $rows = $this->channelAiFallbackRows($dateFrom, $dateTo, $condition);

        if ($rows->isEmpty()) {
            return null;
        }

        $channelMap = $rows
            ->mapWithKeys(fn (object $row): array => [(int) $row->u_id => trim((string) ($row->title ?: 'Channel '.$row->u_id))])
            ->all();
        $channelAi = $rows
            ->mapWithKeys(fn (object $row): array => [(int) $row->u_id => $this->decodeList($row->result_json ?? null)])
            ->all();
        $channelTags = $this->channelTags(array_keys($channelMap));
        $syntheticRow = (object) [
            'result_json' => json_encode($this->dailyTopicsFromChannelRows($channelMap, $channelAi), JSON_UNESCAPED_UNICODE),
        ];

        return [
            'available' => true,
            'row' => null,
            'date' => $date,
            'condition' => $condition,
            'title' => $this->title($date, $condition),
            'topics' => $this->topics($syntheticRow, $channelMap, $channelAi, $channelTags),
            'channels_count' => count($channelMap),
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }

    private function channelAiFallbackRows(string $dateFrom, string $dateTo, string $condition): Collection
    {
        $query = DB::table('urt_channel_ai as ai')
            ->where('ai.date_from', $dateFrom)
            ->where('ai.date_to', $dateTo)
            ->whereNull('ai.del_flag')
            ->orderByDesc('ai.pk');

        if ($this->hasColumn('urt_channel_ai', 'data_type')) {
            $query->where(function ($inner): void {
                $inner->whereNull('ai.data_type')->orWhereIn('ai.data_type', ['oneday', 'todate']);
            });
        }

        if ($this->hasTable('urt_channel')) {
            $query->leftJoin('urt_channel as c', 'ai.u_id', '=', 'c.u_id')
                ->select(['ai.pk', 'ai.u_id', 'ai.result_json', 'c.title']);
        } else {
            $query->select(['ai.pk', 'ai.u_id', 'ai.result_json', DB::raw('NULL as title')]);
        }

        $rows = $query->get()->unique('u_id')->values();

        if ($condition === 'all') {
            return $rows;
        }

        $channelTags = $this->channelTags($rows->pluck('u_id')->map(fn (mixed $id): int => (int) $id)->all());

        return $rows
            ->filter(fn (object $row): bool => $this->channelMatchesCondition($channelTags[(int) $row->u_id] ?? [], $condition))
            ->values();
    }

    /**
     * @param array<int, string> $channelMap
     * @param array<int, list<array<string, mixed>>> $channelAi
     * @return list<array<string, mixed>>
     */
    private function dailyTopicsFromChannelRows(array $channelMap, array $channelAi): array
    {
        $events = [];

        foreach ($channelMap as $uId => $title) {
            foreach ($channelAi[$uId] ?? [] as $event) {
                if (! is_array($event)) {
                    continue;
                }

                $eventName = $this->text($event, ['事件', '議題', '標題', 'event', 'topic', 'title']);

                if ($eventName === '') {
                    continue;
                }

                $events[$eventName][$title][] = $eventName;
            }
        }

        return collect($events)
            ->map(fn (array $mediaEvents, string $eventName): array => [
                '標題' => $eventName,
                '媒體事件' => $mediaEvents,
            ])
            ->values()
            ->all();
    }

    /**
     * @param list<int> $tags
     */
    private function channelMatchesCondition(array $tags, string $condition): bool
    {
        return match ($condition) {
            'green' => in_array(4, $tags, true),
            'blue' => in_array(3, $tags, true),
            'neutral' => ! array_intersect($tags, [3, 4, 5, 6, 31, 41]),
            'finance' => in_array(31, $tags, true),
            'world' => in_array(41, $tags, true),
            default => true,
        };
    }

    private function hasTable(string $table): bool
    {
        return Schema::hasTable($table);
    }

    private function hasColumn(string $table, string $column): bool
    {
        return Schema::hasColumn($table, $column);
    }

    private function latestDate(string $condition): ?string
    {
        $query = DB::table('urt_ai_date')
            ->whereNull('del_flag')
            ->whereIn('data_type', ['todate', 'oneday']);

        if ($condition === 'all') {
            $query->where(function ($inner): void {
                $inner->whereNull('condition_type')->orWhere('condition_type', 'all');
            });
        } else {
            $query->where('condition_type', $condition);
        }

        $latest = $query->max('date_from');

        return is_string($latest) && $latest !== '' ? substr($latest, 0, 10) : null;
    }

    private function routeDate(Request $request): ?string
    {
        $date = $request->route('date') ?? $request->query('date');

        if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $date;
        }

        $source = $request->path().' '.$request->getRequestUri().' '.$request->fullUrl();

        return preg_match('#(?:^|/)ai/days/(?P<date>\d{4}-\d{2}-\d{2})(?:/|$|\?)#', $source, $matches)
            ? $matches['date']
            : null;
    }

    private function condition(mixed $value): string
    {
        $condition = is_string($value) && $value !== '' ? $value : 'all';

        return preg_match('/^[a-zA-Z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    /**
     * @return array<int, string>
     */
    private function channelMap(mixed $json): array
    {
        $decoded = $this->decodeObject($json);

        return collect($decoded)
            ->filter(fn (mixed $title, mixed $uId): bool => is_numeric($uId) && is_scalar($title) && trim((string) $title) !== '')
            ->mapWithKeys(fn (mixed $title, mixed $uId): array => [(int) $uId => trim((string) $title)])
            ->all();
    }

    /**
     * @param  array<int, string>  $channelMap
     * @return array<int, list<array<string, mixed>>>
     */
    private function channelAi(array $channelMap, string $dateFrom, string $dateTo): array
    {
        if ($channelMap === []) {
            return [];
        }

        return DB::table('urt_channel_ai')
            ->whereIn('u_id', array_keys($channelMap))
            ->where('date_from', $dateFrom)
            ->where('date_to', $dateTo)
            ->whereNull('del_flag')
            ->orderByDesc('pk')
            ->get(['u_id', 'result_json'])
            ->unique('u_id')
            ->mapWithKeys(fn (object $row): array => [(int) $row->u_id => $this->decodeList($row->result_json ?? null)])
            ->all();
    }

    /**
     * @param  list<int>  $uIds
     * @return array<int, list<int>>
     */
    private function channelTags(array $uIds): array
    {
        if ($uIds === []) {
            return [];
        }

        return DB::table('urt_count')
            ->whereIn('u_id', $uIds)
            ->get(['u_id', 'tags'])
            ->mapWithKeys(fn (object $row): array => [(int) $row->u_id => $this->tagIds((string) ($row->tags ?? ''))])
            ->all();
    }

    /**
     * @return list<int>
     */
    private function tagIds(string $tags): array
    {
        preg_match_all('/\[(\d+)\]/', $tags, $matches);

        return collect($matches[1] ?? [])
            ->map(fn (string $tag): int => (int) $tag)
            ->values()
            ->all();
    }

    /**
     * @param  array<int, string>  $channelMap
     * @param  array<int, list<array<string, mixed>>>  $channelAi
     * @param  array<int, list<int>>  $channelTags
     * @return list<array<string, mixed>>
     */
    private function topics(object $row, array $channelMap, array $channelAi, array $channelTags): array
    {
        $titleToUId = collect($channelMap)
            ->flip()
            ->map(fn (mixed $uId): int => (int) $uId)
            ->all();

        return collect($this->decodeList($row->result_json ?? null))
            ->map(function (mixed $topic) use ($titleToUId, $channelAi, $channelTags): array {
                $topic = is_array($topic) ? $topic : [];
                $mediaEvents = $this->mediaEvents($topic['媒體事件'] ?? $topic['media_events'] ?? $topic['mediaEvents'] ?? []);
                $stats = $this->topicStats($mediaEvents, $titleToUId, $channelAi, $channelTags);

                return [
                    'title' => $this->text($topic, ['標題', '議題', 'title', 'topic']),
                    'media_events' => $mediaEvents,
                    'media_count' => count($mediaEvents),
                    'video_count' => $stats['video_count'],
                    'keywords' => $this->topCounts($stats['keywords']),
                    'people' => $this->topCounts($stats['people'], ['無']),
                    'angle' => $stats['angle'],
                    'camp' => $stats['camp'],
                    'party' => $stats['party'],
                    'videos' => array_slice($stats['videos'], 0, 3),
                    'score' => $stats['video_count'] + count($mediaEvents) * 3,
                ];
            })
            ->filter(fn (array $topic): bool => $topic['title'] !== '')
            ->sortByDesc('score')
            ->values()
            ->all();
    }

    /**
     * @return array<string, list<string>>
     */
    private function mediaEvents(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return collect($value)
            ->filter(fn (mixed $events, mixed $channel): bool => is_scalar($channel) && is_array($events))
            ->mapWithKeys(fn (array $events, mixed $channel): array => [
                trim((string) $channel) => collect($events)
                    ->filter(fn (mixed $event): bool => is_scalar($event) && trim((string) $event) !== '')
                    ->map(fn (mixed $event): string => trim((string) $event))
                    ->values()
                    ->all(),
            ])
            ->filter(fn (array $events): bool => $events !== [])
            ->all();
    }

    /**
     * @param  array<string, list<string>>  $mediaEvents
     * @param  array<string, int>  $titleToUId
     * @param  array<int, list<array<string, mixed>>>  $channelAi
     * @param  array<int, list<int>>  $channelTags
     * @return array{video_count: int, keywords: array<string, int>, people: array<string, int>, angle: array<string, int>, camp: array<string, int>, party: array<string, int>, videos: list<array<string, mixed>>}
     */
    private function topicStats(array $mediaEvents, array $titleToUId, array $channelAi, array $channelTags): array
    {
        $stats = [
            'video_count' => 0,
            'keywords' => [],
            'people' => [],
            'angle' => ['台灣' => 0, '中國' => 0],
            'camp' => ['民進黨' => 0, '國民黨' => 0],
            'party' => ['green' => 0, 'blue' => 0],
            'videos' => [],
        ];

        foreach ($mediaEvents as $channelTitle => $events) {
            $uId = $titleToUId[$channelTitle] ?? null;

            if (! $uId) {
                continue;
            }

            foreach ($events as $eventName) {
                $match = $this->findChannelEvent($channelAi[$uId] ?? [], $eventName);

                if (! $match) {
                    continue;
                }

                $videoIds = $this->stringList($match, ['videoId', 'video_id', 'video_ids', 'videos']);
                $videoCount = count($videoIds);
                $stats['video_count'] += $videoCount;

                foreach ($this->stringList($match, ['關鍵字', 'keywords']) as $keyword) {
                    $stats['keywords'][$keyword] = ($stats['keywords'][$keyword] ?? 0) + 1;
                }

                foreach ($this->stringList($match, ['人物', 'people']) as $person) {
                    $stats['people'][$person] = ($stats['people'][$person] ?? 0) + 1;
                }

                $angle = $this->text($match, ['角度', 'angle']);
                $camp = $this->text($match, ['陣營', 'camp', 'stance']);

                if (str_contains($angle, '台灣')) {
                    $stats['angle']['台灣'] += $videoCount;
                }

                if (str_contains($angle, '中國')) {
                    $stats['angle']['中國'] += $videoCount;
                }

                if (str_contains($camp, '民進黨')) {
                    $stats['camp']['民進黨'] += $videoCount;
                }

                if (str_contains($camp, '國民黨')) {
                    $stats['camp']['國民黨'] += $videoCount;
                }

                $tags = $channelTags[$uId] ?? [];

                if (in_array(4, $tags, true)) {
                    $stats['party']['green'] += $videoCount;
                }

                if (in_array(3, $tags, true)) {
                    $stats['party']['blue'] += $videoCount;
                }

                if ($videoIds !== [] && ! in_array($uId, [406, 456], true)) {
                    $stats['videos'][] = [
                        'u_id' => $uId,
                        'channel' => $channelTitle,
                        'event' => $eventName,
                        'video_id' => $videoIds[0],
                    ];
                }
            }
        }

        return $stats;
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return array<string, mixed>|null
     */
    private function findChannelEvent(array $items, string $eventName): ?array
    {
        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            if ($this->text($item, ['事件', '議題', '標題', 'event', 'topic', 'title']) === $eventName) {
                return $item;
            }
        }

        return null;
    }

    /**
     * @param  array<string, int>  $counts
     * @param  list<string>  $exclude
     * @return array<string, int>
     */
    private function topCounts(array $counts, array $exclude = []): array
    {
        foreach ($exclude as $key) {
            unset($counts[$key]);
        }

        arsort($counts);

        return array_slice($counts, 0, 5, true);
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeObject(mixed $json): array
    {
        if (! is_string($json) || trim($json) === '') {
            return [];
        }

        $decoded = json_decode($json, true);

        return json_last_error() === JSON_ERROR_NONE && is_array($decoded) ? $decoded : [];
    }

    /**
     * @return list<mixed>
     */
    private function decodeList(mixed $json): array
    {
        $decoded = $this->decodeObject($json);

        foreach (['events', '事件', 'topics', '議題', 'result', 'data'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        return array_is_list($decoded) ? $decoded : array_values($decoded);
    }

    /**
     * @param  list<string>  $keys
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
     * @param  list<string>  $keys
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

    private function title(string $date, string $condition): string
    {
        return match ($condition) {
            'green' => '泛綠媒體在 '.$date.' 主要報導',
            'blue' => '泛藍媒體在 '.$date.' 主要報導',
            'neutral' => '較無偏媒體在 '.$date.' 主要報導',
            'world' => $date.' 國際新聞報導',
            'finance' => $date.' 財經新聞報導',
            default => $date.' 主要事件與各媒體報導',
        };
    }

    /**
     * @return array{available: bool, row: array<string, mixed>|null, date: string|null, condition: string, title: string, topics: list<array<string, mixed>>, channels_count: int, generated_at: string}
     */
    private function empty(bool $available, ?string $date, string $condition): array
    {
        return [
            'available' => $available,
            'row' => null,
            'date' => $date,
            'condition' => $condition,
            'title' => $date ? $this->title($date, $condition) : '主要事件與各媒體報導',
            'topics' => [],
            'channels_count' => 0,
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
