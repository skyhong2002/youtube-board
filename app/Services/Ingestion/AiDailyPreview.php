<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LegacyTagFilter;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AiDailyPreview
{
    /**
     * @var list<string>
     */
    private const SHELL_CONDITIONS = ['all', 'green', 'blue', 'neutral', 'finance', 'world'];

    /**
     * Legacy `maint/make_channel_ai.php` hard-coded channel refresh list.
     *
     * @var list<int>
     */
    private const CHANNEL_AI_UIDS = [
        76, 404, 405, 39, 38, 185, 406, 96, 41, 445,
        270, 458, 274, 1405, 1006, 1674, 407, 350, 268, 456,
        498, 187, 432, 1635, 79, 70, 267, 7, 45, 354,
        460, 61, 1064, 709, 1063, 47, 499, 429, 15,
    ];

    public function __construct(private readonly LegacyTagFilter $tagFilter) {}

    /**
     * @return list<int>
     */
    public static function channelAiUids(): array
    {
        return self::CHANNEL_AI_UIDS;
    }

    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?string $date = null,
        ?string $condition = null,
        string $dataType = 'oneday',
        int $limit = 1000,
        ?CarbonInterface $now = null,
        bool $includePrompts = false,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $date = $this->date($date, $now);
        $dataType = $this->dataType($dataType);
        $limit = max(1, min(1000, $limit));
        $conditions = $this->conditions($condition);
        $period = [
            'from' => $date.' 00:00:00',
            'to' => $date.' 23:59:59',
        ];

        $conditionRows = collect($conditions)
            ->map(fn (string $condition): array => $this->conditionPreview($condition, $period, $dataType, $limit, $includePrompts))
            ->values();
        $channelRefresh = $this->channelAiRefreshPreview($period, $now);
        $eligibleConditionRows = $conditionRows->where('would_call_ai', true)->count();

        return [
            'mode' => 'ingestion-preview',
            'source' => 'legacy_make_ai_day',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'date' => $date,
            'date_from' => $period['from'],
            'date_to' => $period['to'],
            'data_type' => $dataType,
            'conditions' => $conditions,
            'condition_rows' => $conditionRows->all(),
            'channel_ai_refresh' => $channelRefresh,
            'total_prompt_source_rows' => $conditionRows->sum('source_rows'),
            'total_prompt_media_rows' => $conditionRows->sum('media_rows'),
            'total_prompt_event_rows' => $conditionRows->sum('prompt_event_rows'),
            'total_prompt_video_refs' => $conditionRows->sum('prompt_video_refs'),
            'would_call_channel_ai_requests' => $channelRefresh['would_call_channel_ai_requests'],
            'would_insert_channel_ai_rows' => $channelRefresh['would_insert_channel_ai_candidates'],
            'would_call_ai_requests' => $eligibleConditionRows,
            'would_insert_ai_date_rows' => $eligibleConditionRows,
            'api_call_skipped' => 'AI chat completions are intentionally skipped in planning mode',
            'writes_skipped' => [
                'OpenAI/OpenCode chat completion for channel AI',
                'urt_channel_ai insert',
                'OpenAI/OpenCode chat completion for daily AI merge',
                'urt_ai_date insert',
            ],
            'writes' => [],
        ];
    }

    private function date(?string $date, CarbonImmutable $now): string
    {
        if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $date;
        }

        return $now->subDay()->toDateString();
    }

    private function dataType(string $dataType): string
    {
        return in_array($dataType, ['oneday', 'todate', 'week'], true) ? $dataType : 'oneday';
    }

    /**
     * @return list<string>
     */
    private function conditions(?string $condition): array
    {
        if (! is_string($condition) || trim($condition) === '') {
            return self::SHELL_CONDITIONS;
        }

        $condition = trim($condition);

        return in_array($condition, self::SHELL_CONDITIONS, true) ? [$condition] : ['all'];
    }

    /**
     * @param  array{from: string, to: string}  $period
     * @return array<string, mixed>
     */
    private function conditionPreview(string $condition, array $period, string $dataType, int $limit, bool $includePrompts): array
    {
        $filters = $this->conditionFilters($condition);
        $matchingUIds = $this->matchingUIds($filters);
        $query = $this->channelAiQuery($period, $dataType, $matchingUIds, $filters);
        $sourceRows = (clone $query)->count();
        $rawRows = (clone $query)->limit($limit)->get();
        $rows = $this->dedupeAndMapChannelAiRows($rawRows, $condition);
        $bounds = $this->promptBounds($condition);
        $prompt = $this->prompt($rows, $bounds, $condition);
        $promptEventRows = collect($rows)->sum(fn (array $row): int => count($row['events']));
        $hasEligibleSource = $promptEventRows > 0;

        $row = [
            'condition' => $condition,
            'filters' => [
                'tagid' => $filters['tagid'],
                'or' => $filters['or'],
                'not' => $filters['not'],
            ],
            'matching_channels' => $matchingUIds === null ? null : count($matchingUIds),
            'source_rows' => $sourceRows,
            'media_rows' => count($rows),
            'media_without_events' => collect($rows)
                ->filter(fn (array $row): bool => $row['events'] === [])
                ->count(),
            'prompt_event_rows' => $promptEventRows,
            'prompt_video_refs' => collect($rows)->sum('video_count'),
            'prompt_bounds' => $bounds,
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'existing_ai_date_rows' => $this->existingAiDateRows($condition, $period, $dataType),
            'would_call_ai' => $hasEligibleSource,
            'would_insert_ai_date' => $hasEligibleSource,
            'sample_media' => collect($rows)
                ->take(5)
                ->map(fn (array $row): array => [
                    'u_id' => $row['u_id'],
                    'title' => $row['title'],
                    'event_rows' => count($row['events']),
                    'video_refs' => $row['video_count'],
                ])
                ->values()
                ->all(),
        ];

        if ($includePrompts) {
            $row['prompt'] = $prompt;
            $row['channel_id_json'] = json_encode(
                collect($rows)
                    ->mapWithKeys(fn (array $row): array => [(string) $row['u_id'] => $row['title']])
                    ->all(),
                JSON_UNESCAPED_UNICODE,
            );
        }

        return $row;
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
     * @param  array{or: list<int>, tagid: list<int>, not: list<int>}  $filters
     * @return list<int>|null Null means no tag filter, matching legacy `condition=all`.
     */
    private function matchingUIds(array $filters): ?array
    {
        if ($filters['or'] === [] && $filters['tagid'] === [] && $filters['not'] === []) {
            return null;
        }

        if (! Schema::hasTable('urt_count')) {
            return [];
        }

        return $this->tagFilter->matchingChannelTags($filters)
            ->pluck('u_id')
            ->map(fn (mixed $uId): int => (int) $uId)
            ->filter(fn (int $uId): bool => $uId > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  array{from: string, to: string}  $period
     * @param  list<int>|null  $matchingUIds
     * @param  array{or: list<int>, tagid: list<int>, not: list<int>}  $filters
     */
    private function channelAiQuery(array $period, string $dataType, ?array $matchingUIds, array $filters): Builder
    {
        $query = DB::table('urt_channel_ai as ai');

        if (! Schema::hasTable('urt_channel_ai')) {
            return $query->whereRaw('1 = 0');
        }

        if (Schema::hasTable('urt_channel')) {
            $query->leftJoin('urt_channel as c', 'ai.u_id', '=', 'c.u_id')
                ->select(['ai.pk', 'ai.u_id', 'ai.result_json', 'c.title']);
        } else {
            $query->select(['ai.pk', 'ai.u_id', 'ai.result_json', DB::raw('NULL as title')]);
        }

        $query
            ->where('ai.date_from', $period['from'])
            ->where('ai.date_to', $period['to'])
            ->where('ai.data_type', $dataType)
            ->whereNull('ai.del_flag')
            ->orderByDesc('ai.pk');

        if ($matchingUIds !== null && $matchingUIds !== []) {
            $query->whereIn('ai.u_id', $matchingUIds);
        } elseif ($matchingUIds === [] && ($filters['or'] !== [] || $filters['tagid'] !== [] || $filters['not'] !== [])) {
            $query->whereRaw('1 = 0');
        }

        return $query;
    }

    /**
     * @param  Collection<int, object>  $rawRows
     * @return list<array<string, mixed>>
     */
    private function dedupeAndMapChannelAiRows(Collection $rawRows, string $condition): array
    {
        $seen = [];
        $rows = [];

        foreach ($rawRows as $row) {
            $uId = (int) $row->u_id;

            if ($uId <= 0 || isset($seen[$uId])) {
                continue;
            }

            $seen[$uId] = true;
            $events = $this->events($row->result_json ?? null, $condition);
            $videoCount = collect($events)->sum('video_count');

            $rows[] = [
                'pk' => (int) $row->pk,
                'u_id' => $uId,
                'title' => is_string($row->title ?? null) && $row->title !== '' ? $row->title : 'Unknown channel',
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

                $event = $this->text($item, ['事件', '議題', '標題', 'event', 'topic', 'title']);

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
     * @param  array<string, mixed>  $item
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
     * @param  array<string, mixed>  $item
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

    /**
     * @return array{min: int, max: int}
     */
    private function promptBounds(string $condition): array
    {
        return $condition === 'all' ? ['min' => 8, 'max' => 10] : ['min' => 5, 'max' => 8];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array{min: int, max: int}  $bounds
     */
    private function prompt(array $rows, array $bounds, string $condition): string
    {
        $lines = [
            '下面是多個媒體的事件列表，其中包含事件、描述、新聞數與關鍵字。請用 legacy ai_day.php 的方式，把不同媒體其實在講同一件事的事件合併成 '.$bounds['min'].' 到 '.$bounds['max'].' 個每日主要事件。',
            '這不是逐媒體逐事件清單。請合併同一人物、事故、展會、戰爭、政策、股市或國際局勢，即使各媒體的事件名稱不同也要放在同一個大事件。',
            '優先挑選跨媒體、新聞數多、公共影響較大的事件，排序依媒體數與新聞數由高到低。每個輸出事件至少要包含 2 個媒體；若來源不足，可以少於指定數量，不要硬湊。',
            '標題請寫成整體事件標題，例如「鄭麗文訪美及兩岸關係」「T-34墜機事故」「台股行情與AI影響」這種層級，不要只複製單一媒體的小事件名稱。',
            '輸出資料要包含事件整體標題，以及屬於這個分類的媒體與事件列表，格式用',
            '[',
            '    {',
            '        "標題": "<標題名>",',
            '        "媒體事件": {',
            '            "<媒體名>": ["<事件名>"]',
            '        }',
            '    }',
            ']',
            '這樣的 JSON 輸出。媒體事件中的媒體名與事件名必須逐字使用輸入內容，請勿創造新的媒體名或改寫事件名；過濾掉只有一個媒體的事件。只輸出合法 JSON，不要 markdown、code fence 或解釋。',
            '',
        ];

        foreach ($rows as $row) {
            if ($row['events'] === []) {
                continue;
            }

            $lines[] = '媒體名：'.$row['title'];

            foreach ($row['events'] as $event) {
                $lines[] = '事件：'.$event['event'];
                $lines[] = '描述：'.$event['description'];
                $lines[] = '新聞數：'.$event['video_count'];
                $lines[] = '關鍵字：'.implode(', ', $event['keywords']);
            }

            $lines[] = '';
        }

        if ($condition !== 'all') {
            $lines[] = '條件：'.$condition;
        }

        return implode("\n", $lines);
    }

    /**
     * @param  array{from: string, to: string}  $period
     */
    private function existingAiDateRows(string $condition, array $period, string $dataType): int
    {
        if (! Schema::hasTable('urt_ai_date')) {
            return 0;
        }

        return DB::table('urt_ai_date')
            ->where('date_from', $period['from'])
            ->where('date_to', $period['to'])
            ->where('data_type', $dataType)
            ->where('condition_type', $condition)
            ->whereNull('del_flag')
            ->count();
    }

    /**
     * @param  array{from: string, to: string}  $period
     * @return array<string, mixed>
     */
    private function channelAiRefreshPreview(array $period, CarbonImmutable $now): array
    {
        $date = substr($period['from'], 0, 10);
        $legacyDataType = $date === $now->toDateString() ? 'todate' : 'oneday';
        $existingChannels = $this->existingConfiguredChannels();
        $candidateRows = $this->channelRefreshCandidates($period);

        return [
            'source' => 'legacy_make_channel_ai',
            'date' => $date,
            'data_type' => $legacyDataType,
            'configured_channels' => count(self::CHANNEL_AI_UIDS),
            'existing_channels' => $existingChannels,
            'would_attempt_channel_ai_refresh' => count(self::CHANNEL_AI_UIDS),
            'would_call_channel_ai_requests' => $candidateRows->count(),
            'would_insert_channel_ai_candidates' => $candidateRows->count(),
            'existing_channel_ai_rows' => $this->existingChannelAiRows($period, $legacyDataType),
            'minimum_video_rows_per_channel' => 10,
            'sample_channels' => $candidateRows
                ->take(5)
                ->map(fn (object $row): array => [
                    'u_id' => (int) $row->u_id,
                    'title' => is_string($row->title ?? null) && $row->title !== '' ? $row->title : (is_string($row->channel_title ?? null) ? $row->channel_title : 'Unknown channel'),
                    'video_rows' => (int) $row->video_rows,
                ])
                ->values()
                ->all(),
        ];
    }

    private function existingConfiguredChannels(): int
    {
        if (! Schema::hasTable('urt_channel')) {
            return 0;
        }

        return DB::table('urt_channel')
            ->whereIn('u_id', self::CHANNEL_AI_UIDS)
            ->count();
    }

    /**
     * @param  array{from: string, to: string}  $period
     * @return Collection<int, object>
     */
    private function channelRefreshCandidates(array $period): Collection
    {
        if (! Schema::hasTable('urt_video')) {
            return collect();
        }

        $query = DB::table('urt_video as v')
            ->whereIn('v.u_id', self::CHANNEL_AI_UIDS)
            ->where('v.publishedAt', '>=', $period['from'])
            ->where('v.publishedAt', '<=', $period['to'])
            ->groupBy('v.u_id')
            ->havingRaw('COUNT(*) >= 10')
            ->orderByDesc('video_rows');

        if (Schema::hasTable('urt_channel')) {
            $query->leftJoin('urt_channel as c', 'v.u_id', '=', 'c.u_id')
                ->select(['v.u_id', DB::raw('COUNT(*) as video_rows'), DB::raw('MAX(c.title) as title'), DB::raw('MAX(v.channelTitle) as channel_title')]);
        } else {
            $query->select(['v.u_id', DB::raw('COUNT(*) as video_rows'), DB::raw('NULL as title'), DB::raw('MAX(v.channelTitle) as channel_title')]);
        }

        return $query->get();
    }

    /**
     * @param  array{from: string, to: string}  $period
     */
    private function existingChannelAiRows(array $period, string $dataType): int
    {
        if (! Schema::hasTable('urt_channel_ai')) {
            return 0;
        }

        return DB::table('urt_channel_ai')
            ->whereIn('u_id', self::CHANNEL_AI_UIDS)
            ->where('date_from', $period['from'])
            ->where('date_to', $period['to'])
            ->where('data_type', $dataType)
            ->whereNull('del_flag')
            ->count();
    }
}
