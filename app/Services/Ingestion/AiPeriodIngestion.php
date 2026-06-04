<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\AiDailyReport;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class AiPeriodIngestion
{
    public function __construct(
        private readonly AiDailyReport $dailyReport,
        private readonly OpenCodeChatClient $client,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(?string $from = null, ?string $to = null, string $condition = 'all', int $limit = 20, bool $includePrompt = false): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $range = $this->range($from, $to, $now);
        $condition = $this->condition($condition);
        $limit = max(1, min(100, $limit));
        $fromDay = $this->day($range['from_date'], $condition, $limit);
        $toDay = $this->day($range['to_date'], $condition, $limit);
        $prompt = $this->prompt($fromDay, $toDay, $condition);
        $ready = $this->dayReady($fromDay) && $this->dayReady($toDay) && trim($prompt) !== '';

        return [
            'mode' => 'ingestion-preview',
            'source' => 'legacy_ai_period',
            'condition' => $condition,
            'date_from' => $range['date_from'],
            'date_to' => $range['date_to'],
            'from_date' => $range['from_date'],
            'to_date' => $range['to_date'],
            'from_pk' => $fromDay['pk'],
            'to_pk' => $toDay['pk'],
            'from_topics' => count($fromDay['topics']),
            'to_topics' => count($toDay['topics']),
            'sample_from_topics' => array_column(array_slice($fromDay['topics'], 0, 5), 'title'),
            'sample_to_topics' => array_column(array_slice($toDay['topics'], 0, 5), 'title'),
            'existing_period_rows' => $this->existingPeriodRows($range, $condition),
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'would_call_ai_requests' => $ready ? 1 : 0,
            'would_insert_ai_period_rows' => $ready ? 1 : 0,
            'blocked_reason' => $ready ? null : $this->blockedReason($fromDay, $toDay, $prompt),
            'api_call_skipped' => 'AI chat completions are intentionally skipped in planning mode',
            'writes_skipped' => [
                'OpenAI/OpenCode chat completion for period event matching',
                'urt_ai_period upsert',
            ],
            'writes' => [],
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ] + ($includePrompt ? ['prompt' => $prompt] : []);
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(?string $from = null, ?string $to = null, string $condition = 'all', int $limit = 20, int $aiCallLimit = 1, string $userToken = 'CLI'): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $range = $this->range($from, $to, $now);
        $condition = $this->condition($condition);
        $limit = max(1, min(100, $limit));
        $aiCallLimit = max(0, $aiCallLimit);
        $fromDay = $this->day($range['from_date'], $condition, $limit);
        $toDay = $this->day($range['to_date'], $condition, $limit);
        $prompt = $this->prompt($fromDay, $toDay, $condition);
        $blockedReason = $this->blockedReason($fromDay, $toDay, $prompt);

        if ($blockedReason !== null) {
            return $this->executeResult($range, $condition, $fromDay, $toDay, $now, [
                'ai_call_attempted' => false,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'skip_reason' => $blockedReason,
                'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
                'usage' => null,
                'matches' => [],
                'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                'ai_calls_used' => 0,
            ]);
        }

        if ($aiCallLimit < 1) {
            return $this->executeResult($range, $condition, $fromDay, $toDay, $now, [
                'ai_call_attempted' => false,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'skip_reason' => 'ai_call_guard_exhausted',
                'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
                'usage' => null,
                'matches' => [],
                'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                'ai_calls_used' => 0,
            ]);
        }

        try {
            $completion = $this->client->complete($prompt);
            $matches = $this->matches(
                $completion['content'],
                $range['from_date'],
                $range['to_date'],
                $fromDay['topics'],
                $toDay['topics'],
            );
            $matches = $this->mergeMatches(
                $matches,
                $this->deterministicMatches($fromDay, $toDay, $range['from_date'], $range['to_date']),
                $range['from_date'],
                $range['to_date'],
            );
            $upsert = $this->upsertPeriod($range, $condition, (string) $fromDay['pk'], (string) $toDay['pk'], $matches, $completion['model'], $userToken, $now);

            return $this->executeResult($range, $condition, $fromDay, $toDay, $now, [
                'ai_call_attempted' => true,
                'inserted' => $upsert['inserted'],
                'updated' => $upsert['updated'],
                'skipped' => false,
                'skip_reason' => null,
                'model' => $completion['model'],
                'usage' => $completion['usage'],
                'matches' => $matches,
                'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                'ai_calls_used' => 1,
            ]);
        } catch (Throwable $exception) {
            return $this->executeResult($range, $condition, $fromDay, $toDay, $now, [
                'ai_call_attempted' => true,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'skip_reason' => $this->sanitizedFailure($exception),
                'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
                'usage' => null,
                'matches' => [],
                'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                'ai_calls_used' => 1,
            ]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function executeResult(array $range, string $condition, array $fromDay, array $toDay, CarbonImmutable $now, array $row): array
    {
        return [
            'mode' => 'execute',
            'source' => 'legacy_ai_period',
            'condition' => $condition,
            'date_from' => $range['date_from'],
            'date_to' => $range['date_to'],
            'from_date' => $range['from_date'],
            'to_date' => $range['to_date'],
            'from_pk' => $fromDay['pk'],
            'to_pk' => $toDay['pk'],
            'from_topics' => count($fromDay['topics']),
            'to_topics' => count($toDay['topics']),
            'period_ai' => [
                'attempted' => 1,
                'inserted' => $row['inserted'],
                'updated' => $row['updated'],
                'skipped' => $row['skipped'],
                'rows' => [$row],
            ],
            'ai_call_guard' => [
                'limit' => 1,
                'used' => $row['ai_calls_used'],
                'remaining' => max(0, 1 - (int) $row['ai_calls_used']),
            ],
            'write_targets' => ['urt_ai_period'],
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array{from_date: string, to_date: string, date_from: string, date_to: string}
     */
    private function range(?string $from, ?string $to, CarbonImmutable $now): array
    {
        $toDate = $this->dateString($to) ?? $now->subDay()->toDateString();
        $fromDate = $this->dateString($from) ?? CarbonImmutable::parse($toDate, $now->getTimezone())->subDay()->toDateString();

        if ($fromDate > $toDate) {
            [$fromDate, $toDate] = [$toDate, $fromDate];
        }

        return [
            'from_date' => $fromDate,
            'to_date' => $toDate,
            'date_from' => $fromDate.' 00:00:00',
            'date_to' => $toDate.' 23:59:59',
        ];
    }

    private function dateString(?string $date): ?string
    {
        return is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ? $date : null;
    }

    private function condition(string $condition): string
    {
        $condition = trim($condition) !== '' ? trim($condition) : 'all';

        return preg_match('/^[A-Za-z0-9_-]{1,40}$/', $condition) ? $condition : 'all';
    }

    /**
     * @return array{date: string, pk: int|null, available: bool, topics: list<array<string, mixed>>}
     */
    private function day(string $date, string $condition, int $limit): array
    {
        $request = Request::create('/ai/days/'.$date.'/'.$condition, 'GET', [
            'date' => $date,
            'condition' => $condition,
        ]);

        try {
            $payload = $this->dailyReport->forRequest($request);
        } catch (QueryException) {
            return [
                'date' => $date,
                'pk' => null,
                'available' => false,
                'topics' => [],
            ];
        }

        return [
            'date' => $date,
            'pk' => isset($payload['row']['pk']) ? (int) $payload['row']['pk'] : null,
            'available' => (bool) ($payload['available'] ?? false),
            'topics' => collect($payload['topics'] ?? [])
                ->take($limit)
                ->map(fn (array $topic): array => [
                    'title' => (string) ($topic['title'] ?? ''),
                    'media_count' => (int) ($topic['media_count'] ?? 0),
                    'video_count' => (int) ($topic['video_count'] ?? 0),
                    'keywords' => array_keys(array_slice((array) ($topic['keywords'] ?? []), 0, 8, true)),
                    'people' => array_keys(array_slice((array) ($topic['people'] ?? []), 0, 8, true)),
                    'media_events' => collect($topic['media_event_rows'] ?? [])
                        ->take(12)
                        ->map(fn (array $row): array => [
                            'channel' => (string) ($row['channel'] ?? ''),
                            'event' => (string) ($row['event'] ?? ''),
                            'video_count' => (int) ($row['video_count'] ?? 0),
                        ])
                        ->values()
                        ->all(),
                ])
                ->filter(fn (array $topic): bool => $topic['title'] !== '')
                ->values()
                ->all(),
        ];
    }

    private function dayReady(array $day): bool
    {
        return $day['available'] && $day['pk'] !== null && $day['topics'] !== [];
    }

    private function blockedReason(array $fromDay, array $toDay, string $prompt): ?string
    {
        if (! $fromDay['available'] || ! $toDay['available']) {
            return 'daily_report_unavailable';
        }

        if ($fromDay['pk'] === null || $toDay['pk'] === null) {
            return 'missing_daily_pk';
        }

        if ($fromDay['topics'] === [] || $toDay['topics'] === []) {
            return 'missing_daily_topics';
        }

        return trim($prompt) === '' ? 'empty_prompt' : null;
    }

    private function prompt(array $fromDay, array $toDay, string $condition): string
    {
        if ($fromDay['topics'] === [] || $toDay['topics'] === []) {
            return '';
        }

        $lines = [
            '請判斷兩天的每日 AI 主題中，哪些其實是同一條持續事件線。',
            '只使用輸入中的主題標題，不要改寫、翻譯或創造新標題。',
            '如果某個 '.$toDay['date'].' 主題和 '.$fromDay['date'].' 的一個或多個主題是同一事件，請輸出一筆 mapping；沒有明確關聯就不要輸出。',
            '輸出必須是合法 JSON array，格式如下：',
            '[',
            '  {',
            '    "'.$toDay['date'].'": ["<'.$toDay['date'].' 主題標題>"],',
            '    "'.$fromDay['date'].'": ["<'.$fromDay['date'].' 主題標題>"]',
            '  }',
            ']',
            '每個 array 內的字串必須逐字等於下方輸入標題。只輸出 JSON，不要 markdown、code fence 或解釋。',
            'condition='.$condition,
            '',
            $fromDay['date'].' topics:',
            ...$this->promptTopicLines($fromDay['topics']),
            '',
            $toDay['date'].' topics:',
            ...$this->promptTopicLines($toDay['topics']),
        ];

        return implode("\n", $lines);
    }

    /**
     * @param  list<array<string, mixed>>  $topics
     * @return list<string>
     */
    private function promptTopicLines(array $topics): array
    {
        $lines = [];

        foreach ($topics as $index => $topic) {
            $lines[] = sprintf(
                '%d. %s | 媒體數=%d 影片數=%d 關鍵字=%s 人物=%s',
                $index + 1,
                $topic['title'],
                $topic['media_count'],
                $topic['video_count'],
                implode(',', $topic['keywords']),
                implode(',', $topic['people']),
            );

            foreach ($topic['media_events'] as $mediaEvent) {
                if (($mediaEvent['channel'] ?? '') === '' || ($mediaEvent['event'] ?? '') === '') {
                    continue;
                }

                $lines[] = sprintf(
                    '   - %s => %s (%d)',
                    $mediaEvent['channel'],
                    $mediaEvent['event'],
                    $mediaEvent['video_count'],
                );
            }
        }

        return $lines;
    }

    /**
     * @return list<array<string, list<string>>>
     */
    private function matches(string $content, string $fromDate, string $toDate, array $fromTopics, array $toTopics): array
    {
        $decoded = json_decode($this->stripJsonFence($content), true);

        if (json_last_error() !== JSON_ERROR_NONE || ! is_array($decoded)) {
            return [];
        }

        foreach (['matches', 'result', 'data', 'events'] as $key) {
            if (! array_is_list($decoded) && isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        $items = array_is_list($decoded) ? $decoded : array_values($decoded);
        $fromTitleSet = $this->topicTitleSet($fromTopics);
        $toTitleSet = $this->topicTitleSet($toTopics);

        return collect($items)
            ->map(function (mixed $item) use ($fromDate, $toDate, $fromTitleSet, $toTitleSet): ?array {
                if (! is_array($item)) {
                    return null;
                }

                $toEvents = $this->filterKnownTitles($this->stringList($item[$toDate] ?? $item['to'] ?? $item['current'] ?? []), $toTitleSet);
                $fromEvents = $this->filterKnownTitles($this->stringList($item[$fromDate] ?? $item['from'] ?? $item['previous'] ?? []), $fromTitleSet);

                if ($toEvents === [] || $fromEvents === []) {
                    return null;
                }

                return [
                    $toDate => $toEvents,
                    $fromDate => $fromEvents,
                ];
            })
            ->filter()
            ->unique(fn (array $item): string => json_encode($item, JSON_UNESCAPED_UNICODE))
            ->values()
            ->all();
    }

    /**
     * @param  list<array<string, mixed>>  $topics
     * @return array<string, true>
     */
    private function topicTitleSet(array $topics): array
    {
        return collect($topics)
            ->map(fn (array $topic): string => trim((string) ($topic['title'] ?? '')))
            ->filter()
            ->mapWithKeys(fn (string $title): array => [$title => true])
            ->all();
    }

    /**
     * @param  list<string>  $titles
     * @param  array<string, true>  $validTitleSet
     * @return list<string>
     */
    private function filterKnownTitles(array $titles, array $validTitleSet): array
    {
        return collect($titles)
            ->filter(fn (string $title): bool => isset($validTitleSet[$title]))
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, list<string>>>
     */
    private function deterministicMatches(array $fromDay, array $toDay, string $fromDate, string $toDate): array
    {
        $matches = [];

        foreach ($toDay['topics'] as $toTopic) {
            $best = null;

            foreach ($fromDay['topics'] as $fromTopic) {
                $score = $this->topicSimilarityScore($fromTopic, $toTopic);

                if ($score < 10) {
                    continue;
                }

                if ($best === null || $score > $best['score']) {
                    $best = [
                        'score' => $score,
                        'topic' => $fromTopic,
                    ];
                }
            }

            if ($best !== null) {
                $matches[] = [
                    $toDate => [(string) $toTopic['title']],
                    $fromDate => [(string) $best['topic']['title']],
                ];
            }
        }

        return $matches;
    }

    private function topicSimilarityScore(array $fromTopic, array $toTopic): int
    {
        $from = $this->topicSignals($fromTopic);
        $to = $this->topicSignals($toTopic);
        $people = $this->intersectSignals($from['people'], $to['people']);
        $keywords = $this->intersectSignals($from['keywords'], $to['keywords']);
        $titles = $this->intersectSignals($from['titles'], $to['titles']);
        $media = $this->intersectSignals($from['media'], $to['media']);
        $score = count($people) * 6
            + count($keywords) * 3
            + count($titles) * 4
            + count($media) * 4;

        if ($people !== [] && $this->sharedSignalAppearsInTitles($people, $fromTopic, $toTopic)) {
            $score += 4;
        }

        if ($this->titleContains($fromTopic, $toTopic)) {
            $score += 6;
        }

        return $this->passesSimilarityFloor($score, $people, $keywords, $titles, $media) ? $score : 0;
    }

    /**
     * @return array{people: list<string>, keywords: list<string>, titles: list<string>, media: list<string>}
     */
    private function topicSignals(array $topic): array
    {
        $mediaEvents = collect($topic['media_events'] ?? [])
            ->map(fn (array $row): string => (string) ($row['event'] ?? ''))
            ->filter()
            ->values()
            ->all();

        return [
            'people' => $this->normalizedSignals((array) ($topic['people'] ?? [])),
            'keywords' => $this->normalizedSignals((array) ($topic['keywords'] ?? [])),
            'titles' => $this->normalizedSignals($this->titleSignals((string) ($topic['title'] ?? ''))),
            'media' => $this->normalizedSignals($mediaEvents),
        ];
    }

    /**
     * @param  list<string>  $signals
     * @return list<string>
     */
    private function normalizedSignals(array $signals): array
    {
        return collect($signals)
            ->map(fn (mixed $signal): string => $this->normalizedSignal((string) $signal))
            ->filter(fn (string $signal): bool => mb_strlen($signal, 'UTF-8') >= 2)
            ->reject(fn (string $signal): bool => $this->isWeakSignal($signal))
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $left
     * @param  list<string>  $right
     * @return list<string>
     */
    private function intersectSignals(array $left, array $right): array
    {
        return array_values(array_intersect($left, $right));
    }

    private function passesSimilarityFloor(int $score, array $people, array $keywords, array $titles, array $media): bool
    {
        if ($people !== [] && ($keywords !== [] || $titles !== [] || $media !== [])) {
            return $score >= 10;
        }

        if (count($keywords) >= 2 || $media !== [] || count($titles) >= 2) {
            return $score >= 10;
        }

        return false;
    }

    private function sharedSignalAppearsInTitles(array $signals, array $fromTopic, array $toTopic): bool
    {
        $fromTitle = $this->normalizedSignal((string) ($fromTopic['title'] ?? ''));
        $toTitle = $this->normalizedSignal((string) ($toTopic['title'] ?? ''));

        foreach ($signals as $signal) {
            if (str_contains($fromTitle, $signal) && str_contains($toTitle, $signal)) {
                return true;
            }
        }

        return false;
    }

    private function titleContains(array $fromTopic, array $toTopic): bool
    {
        $fromTitle = $this->normalizedSignal((string) ($fromTopic['title'] ?? ''));
        $toTitle = $this->normalizedSignal((string) ($toTopic['title'] ?? ''));

        return $fromTitle !== ''
            && $toTitle !== ''
            && (str_contains($fromTitle, $toTitle) || str_contains($toTitle, $fromTitle));
    }

    /**
     * @return list<string>
     */
    private function titleSignals(string $title): array
    {
        preg_match_all('/[A-Za-z0-9][A-Za-z0-9-]{1,}/u', $title, $latinMatches);
        $chunks = preg_split('/(?:的|與|及|和|在|參加|出席|訪|到|對|問題|事件|活動|高人氣|主題|演講|型|機)/u', $title) ?: [];

        return collect([
            $title,
            ...($latinMatches[0] ?? []),
            ...$chunks,
        ])
            ->map(fn (string $signal): string => trim($signal))
            ->filter(fn (string $signal): bool => $signal !== '')
            ->values()
            ->all();
    }

    private function normalizedSignal(string $value): string
    {
        $value = preg_replace('/[\s　[:punct:]]+/u', '', $value) ?? $value;
        $value = str_replace(['事件', '事故', '新聞', '後續', '焦點', '最新', '相關'], '', $value);

        return mb_strtolower(trim($value), 'UTF-8');
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
            '活動',
            '高人氣',
        ], true);
    }

    /**
     * @return list<array<string, list<string>>>
     */
    private function mergeMatches(array $matches, array $additionalMatches, string $fromDate, string $toDate): array
    {
        $merged = [];

        foreach ([...$matches, ...$additionalMatches] as $match) {
            foreach ($this->stringList($match[$toDate] ?? []) as $toEvent) {
                $fromEvents = $this->stringList($match[$fromDate] ?? []);

                if ($toEvent === '' || $fromEvents === []) {
                    continue;
                }

                $merged[$toEvent] ??= [
                    $toDate => [$toEvent],
                    $fromDate => [],
                ];
                $merged[$toEvent][$fromDate] = array_values(array_unique([
                    ...$merged[$toEvent][$fromDate],
                    ...$fromEvents,
                ]));
            }
        }

        return array_values($merged);
    }

    /**
     * @return list<string>
     */
    private function stringList(mixed $items): array
    {
        if (is_scalar($items) && trim((string) $items) !== '') {
            return [trim((string) $items)];
        }

        if (! is_array($items)) {
            return [];
        }

        return collect($items)
            ->flatten()
            ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
            ->map(fn (mixed $value): string => trim((string) $value))
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return array{inserted: bool, updated: bool}
     */
    private function upsertPeriod(array $range, string $condition, string $fromPk, string $toPk, array $matches, string $model, string $userToken, CarbonImmutable $now): array
    {
        if (! Schema::hasTable('urt_ai_period')) {
            throw new RuntimeException('urt_ai_period table is missing');
        }

        $query = DB::table('urt_ai_period')
            ->where('date_from', $range['date_from'])
            ->where('date_to', $range['date_to']);

        if (Schema::hasColumn('urt_ai_period', 'condition_type')) {
            $query->where('condition_type', $condition);
        }

        if (Schema::hasColumn('urt_ai_period', 'data_type')) {
            $query->where('data_type', 'oneday');
        }

        if (Schema::hasColumn('urt_ai_period', 'del_flag')) {
            $query->whereNull('del_flag');
        }

        $existingPk = $query->orderByDesc('pk')->value('pk');
        $values = [
            'result_json' => json_encode($matches, JSON_UNESCAPED_UNICODE),
            'data_json' => json_encode([$fromPk, $toPk], JSON_UNESCAPED_UNICODE),
        ];

        if (Schema::hasColumn('urt_ai_period', 'mtime')) {
            $values['mtime'] = $now->format('Y-m-d H:i:s');
        }

        if ($existingPk === null) {
            $insert = [
                'date_from' => $range['date_from'],
                'date_to' => $range['date_to'],
            ] + $values;

            foreach ([
                'ctime' => $now->format('Y-m-d H:i:s'),
                'ai_type' => $model,
                'data_type' => 'oneday',
                'condition_type' => $condition,
                'user_token' => $userToken,
                'del_flag' => null,
            ] as $column => $value) {
                if (Schema::hasColumn('urt_ai_period', $column)) {
                    $insert[$column] = $value;
                }
            }

            DB::table('urt_ai_period')->insert($insert);

            return ['inserted' => true, 'updated' => false];
        }

        foreach ([
            'ai_type' => $model,
            'data_type' => 'oneday',
            'user_token' => $userToken,
        ] as $column => $value) {
            if (Schema::hasColumn('urt_ai_period', $column)) {
                $values[$column] = $value;
            }
        }

        DB::table('urt_ai_period')
            ->where('pk', $existingPk)
            ->update($values);

        return ['inserted' => false, 'updated' => true];
    }

    private function existingPeriodRows(array $range, string $condition): int
    {
        if (! Schema::hasTable('urt_ai_period')) {
            return 0;
        }

        $query = DB::table('urt_ai_period')
            ->where('date_from', $range['date_from'])
            ->where('date_to', $range['date_to']);

        if (Schema::hasColumn('urt_ai_period', 'condition_type')) {
            $query->where('condition_type', $condition);
        }

        if (Schema::hasColumn('urt_ai_period', 'del_flag')) {
            $query->whereNull('del_flag');
        }

        return $query->count();
    }

    private function stripJsonFence(string $content): string
    {
        $content = trim($content);
        $content = preg_replace('/^```json\s*/i', '', $content) ?? $content;
        $content = preg_replace('/^```\s*/', '', $content) ?? $content;
        $content = preg_replace('/\s*```$/', '', $content) ?? $content;

        return trim($content);
    }

    private function sanitizedFailure(Throwable $exception): string
    {
        return mb_strimwidth(
            preg_replace('/(api[_-]?key|password|secret|token|authorization)[^,\s]*/i', '$1=<redacted>', $exception->getMessage()) ?? 'ai_completion_failed',
            0,
            240,
            '...',
            'UTF-8',
        );
    }
}
