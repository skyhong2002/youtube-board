<?php

namespace App\Services\Legacy;

use App\Support\AiDailyContract;
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
     *     coverage: array<string, int|null>,
     *     generated_at: string
     * }
     */
    public function forRequest(Request $request): array
    {
        $condition = $this->condition($request->route('condition') ?? $request->query('condition'));

        try {
            $row = $this->row($request, $condition);

            if (! $row) {
                $fallbackDate = $this->routeDate($request) ?? $this->latestDate($condition);
                $fallback = $this->channelAiFallback($request, $condition, $fallbackDate);

                if ($fallback !== null) {
                    return $fallback;
                }

                return $this->empty(true, $fallbackDate, $condition);
            }

            $date = substr((string) $row->date_from, 0, 10);
            $dateFrom = (string) $row->date_from;
            $dateTo = (string) $row->date_to;
            $channelMap = $this->channelMap($row->channel_id ?? null);
            $channelAi = $this->channelAi($channelMap, $dateFrom, $dateTo);
            $channelTags = $this->channelTags(array_keys($channelMap));
            $topics = $this->topics($row, $channelMap, $channelAi, $channelTags);
            $resolvedCondition = (string) ($row->condition_type ?: $condition);

            if ($this->shouldRegroupDailyTopics($topics, $resolvedCondition)) {
                $fallback = $this->channelAiFallback($request, $resolvedCondition, $date, $row);

                if ($fallback !== null && $this->shouldPreferFallback($topics, $fallback['topics'], $resolvedCondition)) {
                    return $fallback;
                }
            }

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
                'condition' => $resolvedCondition,
                'title' => $this->title($date, $resolvedCondition),
                'topics' => $topics,
                'channels_count' => count($channelMap),
                'coverage' => $this->coverage($dateFrom, $dateTo, $resolvedCondition, $channelAi, $topics),
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
     * Build a real-time YouTube dashboard daily page from existing per-channel AI rows when
     * legacy `urt_ai_date` has not been generated for that date/condition.
     *
     * @return array{available: bool, row: array<string, mixed>|null, date: string|null, condition: string, title: string, topics: list<array<string, mixed>>, channels_count: int, coverage: array<string, int|null>, generated_at: string}|null
     */
    private function channelAiFallback(Request $request, string $condition, ?string $date = null, ?object $sourceRow = null): ?array
    {
        $date ??= $this->routeDate($request);

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
            'result_json' => json_encode($this->dailyTopicsFromChannelRows($channelMap, $channelAi, $condition), JSON_UNESCAPED_UNICODE),
        ];
        $topics = $this->topics($syntheticRow, $channelMap, $channelAi, $channelTags);

        if ($topics === []) {
            return null;
        }

        return [
            'available' => true,
            'row' => $sourceRow ? [
                'pk' => (int) $sourceRow->pk,
                'date_from' => (string) $sourceRow->date_from,
                'date_to' => (string) $sourceRow->date_to,
                'data_type' => $sourceRow->data_type ?? null,
                'condition_type' => $sourceRow->condition_type ?? null,
            ] : null,
            'date' => $date,
            'condition' => $condition,
            'title' => $this->title($date, $condition),
            'topics' => $topics,
            'channels_count' => count($channelMap),
            'coverage' => $this->coverage($dateFrom, $dateTo, $condition, $channelAi, $topics),
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
     * @param  array<int, string>  $channelMap
     * @param  array<int, list<array<string, mixed>>>  $channelAi
     * @return list<array<string, mixed>>
     */
    private function dailyTopicsFromChannelRows(array $channelMap, array $channelAi, string $condition): array
    {
        $entries = [];

        foreach ($channelMap as $uId => $title) {
            foreach ($channelAi[$uId] ?? [] as $event) {
                if (! is_array($event)) {
                    continue;
                }

                $eventName = $this->text($event, ['事件', '議題', '標題', 'event', 'topic', 'title']);

                if ($eventName === '') {
                    continue;
                }

                $videoIds = $this->stringList($event, ['videoId', 'video_id', 'video_ids', 'videos']);

                $entries[] = [
                    'title' => $title,
                    'event' => $eventName,
                    'video_count' => max(1, count($videoIds)),
                    'category' => $this->category($event),
                    'signals' => $this->eventSignals($event, $eventName),
                ];
            }
        }

        if ($entries === []) {
            return [];
        }

        $clusters = $this->eventClusters($entries);

        if ($clusters === []) {
            $clusters = $this->categoryClusters($entries);
        }

        return collect($clusters)
            ->filter(fn (array $cluster): bool => count($cluster['media_events']) >= 2)
            ->sortByDesc(fn (array $cluster): int => $cluster['video_count'] + count($cluster['media_events']) * 3)
            ->take(AiDailyContract::maxTopics($condition))
            ->map(fn (array $cluster): array => [
                '標題' => $cluster['title'],
                '媒體事件' => $cluster['media_events'],
            ])
            ->values()
            ->all();
    }

    /**
     * @param  list<array<string, mixed>>  $topics
     */
    private function shouldRegroupDailyTopics(array $topics, string $condition): bool
    {
        $bounds = AiDailyContract::bounds($condition);
        $topicCount = count($topics);

        if ($topicCount < $bounds['min'] || $topicCount > $bounds['max']) {
            return true;
        }

        $singleMediaTopics = collect($topics)
            ->filter(fn (array $topic): bool => (int) ($topic['media_count'] ?? 0) <= 1)
            ->count();

        return $singleMediaTopics > (int) floor($topicCount / 2);
    }

    /**
     * Prefer a request-time rebuild when it fixes an undersized cache, or when the
     * cached payload exceeds the contract or is dominated by single-media topics.
     *
     * @param  list<array<string, mixed>>  $topics
     * @param  list<array<string, mixed>>  $fallbackTopics
     */
    private function shouldPreferFallback(array $topics, array $fallbackTopics, string $condition): bool
    {
        if (! $this->isCrossMediaTopicSet($fallbackTopics)) {
            return false;
        }

        $minimumTopics = AiDailyContract::minTopics($condition);

        if (count($fallbackTopics) < $minimumTopics && count($fallbackTopics) < count($topics)) {
            return false;
        }

        $currentQuality = $this->topicSetQuality($topics, $condition);
        $fallbackQuality = $this->topicSetQuality($fallbackTopics, $condition);

        foreach ($currentQuality as $index => $currentValue) {
            if ($fallbackQuality[$index] === $currentValue) {
                continue;
            }

            return $fallbackQuality[$index] > $currentValue;
        }

        return false;
    }

    /**
     * Contract-valid sets win first. For two incomplete sets, preserve the one
     * with a valid count before comparing cross-media evidence and distance.
     *
     * @param  list<array<string, mixed>>  $topics
     * @return array{int, int, int, int, int}
     */
    private function topicSetQuality(array $topics, string $condition): array
    {
        $bounds = AiDailyContract::bounds($condition);
        $topicCount = count($topics);
        $withinBounds = $topicCount >= $bounds['min'] && $topicCount <= $bounds['max'];
        $multiMediaTopics = collect($topics)
            ->filter(fn (array $topic): bool => (int) ($topic['media_count'] ?? 0) >= 2)
            ->count();
        $allTopicsCrossMedia = $topicCount > 0 && $multiMediaTopics === $topicCount;
        $distance = $topicCount < $bounds['min']
            ? $bounds['min'] - $topicCount
            : max(0, $topicCount - $bounds['max']);

        return [
            (int) ($withinBounds && $allTopicsCrossMedia),
            (int) $withinBounds,
            $multiMediaTopics,
            -$distance,
            $topicCount,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $topics
     */
    private function isCrossMediaTopicSet(array $topics): bool
    {
        return $topics !== [] && collect($topics)
            ->every(fn (array $topic): bool => (int) ($topic['media_count'] ?? 0) >= 2);
    }

    /**
     * @param  list<array{title: string, event: string, video_count: int, category: string, signals: list<string>}>  $entries
     * @return list<array{title: string, media_events: array<string, list<string>>, video_count: int, signals: list<string>}>
     */
    private function eventClusters(array $entries): array
    {
        $clusters = [];

        foreach (collect($entries)->sortByDesc('video_count')->values() as $entry) {
            $bestIndex = null;
            $bestOverlap = 0;

            foreach ($clusters as $index => $cluster) {
                $overlap = $this->strongSignalOverlap($entry['signals'], $cluster['signals']);

                if ($overlap > $bestOverlap) {
                    $bestIndex = $index;
                    $bestOverlap = $overlap;
                }
            }

            if ($bestIndex === null || $bestOverlap <= 0) {
                $clusters[] = [
                    'title' => $entry['event'],
                    'media_events' => [$entry['title'] => [$entry['event']]],
                    'video_count' => $entry['video_count'],
                    'signals' => $entry['signals'],
                ];

                continue;
            }

            $clusters[$bestIndex]['media_events'][$entry['title']][] = $entry['event'];
            $clusters[$bestIndex]['video_count'] += $entry['video_count'];
            $clusters[$bestIndex]['signals'] = array_values(array_unique(array_merge(
                $clusters[$bestIndex]['signals'],
                $entry['signals'],
            )));
        }

        return collect($clusters)
            ->values()
            ->all();
    }

    /**
     * @param  list<array{title: string, event: string, video_count: int, category: string, signals: list<string>}>  $entries
     * @return list<array{title: string, media_events: array<string, list<string>>, video_count: int}>
     */
    private function categoryClusters(array $entries): array
    {
        $clusters = [];

        foreach ($entries as $entry) {
            if ($entry['category'] === '') {
                continue;
            }

            $category = $entry['category'];
            $clusters[$category] ??= [
                'title' => $category.'焦點',
                'media_events' => [],
                'video_count' => 0,
            ];
            $clusters[$category]['media_events'][$entry['title']][] = $entry['event'];
            $clusters[$category]['video_count'] += $entry['video_count'];
        }

        return array_values($clusters);
    }

    /**
     * @param  list<string>  $left
     * @param  list<string>  $right
     */
    private function strongSignalOverlap(array $left, array $right): int
    {
        return collect(array_intersect($left, $right))
            ->reject(fn (string $signal): bool => $this->isWeakSignal($signal))
            ->count();
    }

    private function isWeakSignal(string $signal): bool
    {
        return in_array($signal, [
            'ai',
            '台灣',
            '中國',
            '美國',
            '日本',
            '國際',
            '政治',
            '財經',
            '社會',
            '新聞',
            '直播',
            '最新',
            '民進黨',
            '國民黨',
            '川普',
            '專家',
        ], true);
    }

    /**
     * @return list<string>
     */
    private function eventSignals(array $event, string $eventName): array
    {
        return collect([
            ...$this->stringList($event, ['關鍵字', 'keywords']),
            ...$this->stringList($event, ['人物', 'people']),
            ...$this->titleSignals($eventName),
        ])
            ->map(fn (string $signal): string => $this->normalizedSignal($signal))
            ->filter(fn (string $signal): bool => mb_strlen($signal, 'UTF-8') >= 2)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function titleSignals(string $eventName): array
    {
        preg_match_all('/[A-Za-z0-9][A-Za-z0-9-]{1,}/u', $eventName, $matches);

        return collect([
            $eventName,
            ...($matches[0] ?? []),
        ])
            ->filter(fn (string $signal): bool => trim($signal) !== '')
            ->values()
            ->all();
    }

    private function normalizedSignal(string $value): string
    {
        $value = preg_replace('/[\s　[:punct:]]+/u', '', $value) ?? $value;

        return mb_strtolower(trim(str_replace(['事件', '事故', '新聞', '後續', '焦點', '最新'], '', $value)), 'UTF-8');
    }

    private function category(array $event): string
    {
        $category = $this->text($event, ['分類', '類型', 'category', 'type']);

        if ($category !== '') {
            return $category;
        }

        return $this->stringList($event, ['分類', '類型', 'category', 'type'])[0] ?? '';
    }

    /**
     * @param  list<int>  $tags
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

        $latestDaily = $query->max('date_from');

        if ($condition !== 'all' || ! $this->hasTable('urt_channel_ai')) {
            return is_string($latestDaily) && $latestDaily !== '' ? substr($latestDaily, 0, 10) : null;
        }

        $channelQuery = DB::table('urt_channel_ai')
            ->whereNull('del_flag')
            ->whereNotNull('result_json')
            ->where('result_json', '!=', '');

        if ($this->hasColumn('urt_channel_ai', 'data_type')) {
            $channelQuery->where(function ($inner): void {
                $inner->whereNull('data_type')->orWhereIn('data_type', ['todate', 'oneday']);
            });
        }

        $latestChannel = $channelQuery->max('date_from');

        $latest = collect([$latestDaily, $latestChannel])
            ->filter(fn (mixed $date): bool => is_string($date) && $date !== '')
            ->max();

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

    /**
     * @param  array<int, list<array<string, mixed>>>  $channelAi
     * @param  list<array<string, mixed>>  $topics
     * @return array<string, int|null>
     */
    private function coverage(string $dateFrom, string $dateTo, string $condition, array $channelAi, array $topics): array
    {
        $source = $this->sourceStats($channelAi, $condition);

        return $source + [
            'raw_video_rows' => $this->rawVideoRows($dateFrom, $dateTo, $condition),
            'summary_topics' => count($topics),
            'summary_video_refs' => collect($topics)->sum(fn (array $topic): int => (int) ($topic['video_count'] ?? 0)),
        ];
    }

    /**
     * @param  array<int, list<array<string, mixed>>>  $channelAi
     * @return array<string, int>
     */
    private function sourceStats(array $channelAi, string $condition): array
    {
        $stats = [
            'ai_source_channels' => count($channelAi),
            'ai_source_channels_with_events' => 0,
            'ai_source_channels_without_events' => 0,
            'ai_source_event_rows' => 0,
            'ai_source_video_refs' => 0,
        ];

        foreach ($channelAi as $events) {
            $channelEvents = 0;
            $channelVideos = 0;

            foreach ($events as $event) {
                if (! is_array($event)) {
                    continue;
                }

                $videoIds = $this->stringList($event, ['videoId', 'video_id', 'video_ids', 'videos']);

                if ($condition === 'all' && count($videoIds) <= 1) {
                    continue;
                }

                if ($this->text($event, ['事件', '議題', '標題', 'event', 'topic', 'title']) === '') {
                    continue;
                }

                $channelEvents++;
                $channelVideos += count($videoIds);
            }

            if ($channelEvents > 0) {
                $stats['ai_source_channels_with_events']++;
            } else {
                $stats['ai_source_channels_without_events']++;
            }

            $stats['ai_source_event_rows'] += $channelEvents;
            $stats['ai_source_video_refs'] += $channelVideos;
        }

        return $stats;
    }

    private function rawVideoRows(string $dateFrom, string $dateTo, string $condition): ?int
    {
        if (! $this->hasTable('urt_video') || ! $this->hasColumn('urt_video', 'publishedAt')) {
            return null;
        }

        $query = DB::table('urt_video')
            ->where('publishedAt', '>=', $dateFrom)
            ->where('publishedAt', '<=', $dateTo);
        $uIds = $this->conditionUIds($condition);

        if ($uIds !== null) {
            if ($uIds === []) {
                return 0;
            }

            $query->whereIn('u_id', $uIds);
        }

        return $query->count();
    }

    /**
     * @return list<int>|null Null means no condition filter.
     */
    private function conditionUIds(string $condition): ?array
    {
        if ($condition === 'all') {
            return null;
        }

        if (! $this->hasTable('urt_count')) {
            return [];
        }

        return DB::table('urt_count')
            ->get(['u_id', 'tags'])
            ->filter(fn (object $row): bool => $this->channelMatchesCondition($this->tagIds((string) ($row->tags ?? '')), $condition))
            ->pluck('u_id')
            ->map(fn (mixed $uId): int => (int) $uId)
            ->values()
            ->all();
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
                    'title' => $this->text($topic, ['事件', '議題', '標題', 'event', 'topic', 'title']),
                    'media_events' => $mediaEvents,
                    'media_event_rows' => $this->mediaEventRows($mediaEvents, $titleToUId, $stats['event_video_counts']),
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
            ->filter(fn (mixed $events, mixed $channel): bool => is_string($channel)
                && trim($channel) !== ''
                && is_array($events))
            ->mapWithKeys(fn (array $events, string $channel): array => [
                trim($channel) => collect($events)
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
     * @param  array<string, array<string, int>>  $eventVideoCounts
     * @return list<array{channel: string, u_id: int|null, event: string, video_count: int|null}>
     */
    private function mediaEventRows(array $mediaEvents, array $titleToUId, array $eventVideoCounts): array
    {
        $rows = [];

        foreach ($mediaEvents as $channelTitle => $events) {
            foreach ($events as $eventName) {
                $rows[] = [
                    'channel' => $channelTitle,
                    'u_id' => $titleToUId[$channelTitle] ?? null,
                    'event' => $eventName,
                    'video_count' => $eventVideoCounts[$channelTitle][$eventName] ?? null,
                ];
            }
        }

        return $rows;
    }

    /**
     * @param  array<string, list<string>>  $mediaEvents
     * @param  array<string, int>  $titleToUId
     * @param  array<int, list<array<string, mixed>>>  $channelAi
     * @param  array<int, list<int>>  $channelTags
     * @return array{video_count: int, keywords: array<string, int>, people: array<string, int>, angle: array<string, int>, camp: array<string, int>, party: array<string, int>, videos: list<array<string, mixed>>, event_video_counts: array<string, array<string, int>>}
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
            'event_video_counts' => [],
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
                $stats['event_video_counts'][$channelTitle][$eventName] = $videoCount;

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
                $value = trim((string) $item[$key]);

                if ($value !== '') {
                    return $value;
                }
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
     * @return array{available: bool, row: array<string, mixed>|null, date: string|null, condition: string, title: string, topics: list<array<string, mixed>>, channels_count: int, coverage: array<string, int|null>, generated_at: string}
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
            'coverage' => [
                'raw_video_rows' => null,
                'ai_source_channels' => 0,
                'ai_source_channels_with_events' => 0,
                'ai_source_channels_without_events' => 0,
                'ai_source_event_rows' => 0,
                'ai_source_video_refs' => 0,
                'summary_topics' => 0,
                'summary_video_refs' => 0,
            ],
            'generated_at' => now('Asia/Taipei')->format('Y-m-d H:i:s'),
        ];
    }
}
