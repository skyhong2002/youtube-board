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
            $matches = $this->matches($completion['content'], $range['from_date'], $range['to_date']);
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
    private function matches(string $content, string $fromDate, string $toDate): array
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

        return collect($items)
            ->map(function (mixed $item) use ($fromDate, $toDate): ?array {
                if (! is_array($item)) {
                    return null;
                }

                $toEvents = $this->stringList($item[$toDate] ?? $item['to'] ?? $item['current'] ?? []);
                $fromEvents = $this->stringList($item[$fromDate] ?? $item['from'] ?? $item['previous'] ?? []);

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

        if (Schema::hasColumn('urt_ai_period', 'user_token')) {
            $query->where('user_token', $userToken);
        }

        if (Schema::hasColumn('urt_ai_period', 'del_flag')) {
            $query->whereNull('del_flag');
        }

        $existingPk = $query->value('pk');
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
