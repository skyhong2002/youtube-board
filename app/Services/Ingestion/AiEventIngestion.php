<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\AiDailyReport;
use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class AiEventIngestion
{
    private const PROMPT_TYPES = AiCommandInputValidator::EVENT_PROMPT_TYPES;

    public function __construct(
        private readonly AiDailyReport $dailyReport,
        private readonly OpenCodeChatClient $client,
        private readonly AiJsonPayloadValidator $jsonValidator,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?string $date = null,
        string $condition = 'all',
        ?int $aipk = null,
        ?string $event = null,
        string $promptTypes = 'summary,people,media',
        int $limit = 20,
        bool $missingOnly = false,
        bool $includePrompt = false,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $promptTypes = $this->promptTypes($promptTypes);
        $day = $this->day($date, $condition, $aipk, $limit);
        $topics = $this->topics($day, $event, $limit);
        $rows = $this->planRows($day, $topics, $promptTypes, $missingOnly, $includePrompt);
        $ready = $this->blockedReason($day, $topics, $promptTypes) === null;

        return [
            'mode' => 'ingestion-preview',
            'source' => 'legacy_ai_event',
            'date' => $day['date'],
            'date_from' => $day['date_from'],
            'date_to' => $day['date_to'],
            'condition' => $day['condition'],
            'aipk' => $day['pk'],
            'topics' => count($topics),
            'prompt_types' => $promptTypes,
            'existing_event_rows' => collect($rows)->sum('existing_rows'),
            'would_call_ai_requests' => $ready ? collect($rows)->where('skipped', false)->count() : 0,
            'would_upsert_ai_event_rows' => $ready ? collect($rows)->where('skipped', false)->count() : 0,
            'blocked_reason' => $this->blockedReason($day, $topics, $promptTypes),
            'rows' => $rows,
            'api_call_skipped' => 'AI chat completions are intentionally skipped in planning mode',
            'writes_skipped' => [
                'OpenAI/OpenCode chat completion for event summary/people/media',
                'urt_ai_event upsert',
            ],
            'writes' => [],
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $date = null,
        string $condition = 'all',
        ?int $aipk = null,
        ?string $event = null,
        string $promptTypes = 'summary,people,media',
        int $limit = 20,
        int $aiCallLimit = 60,
        bool $missingOnly = false,
        string $userToken = 'CLI',
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $promptTypes = $this->promptTypes($promptTypes);
        $limit = max(1, min(100, $limit));
        $aiCallLimit = max(0, $aiCallLimit);
        $day = $this->day($date, $condition, $aipk, $limit);
        $topics = $this->topics($day, $event, $limit);
        $blockedReason = $this->blockedReason($day, $topics, $promptTypes);
        $rows = [];
        $aiCallsUsed = 0;

        if ($blockedReason !== null) {
            return $this->executeResult($day, $topics, $promptTypes, $now, [[
                'event' => $event ? trim($event) : null,
                'prompt_type' => null,
                'prompt_chars' => 0,
                'existing_rows' => 0,
                'ai_call_attempted' => false,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'failed' => false,
                'skip_reason' => $blockedReason,
                'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
                'provider' => null,
                'provider_failures' => [],
                'usage' => null,
            ]], $aiCallLimit, $aiCallsUsed);
        }

        foreach ($topics as $topic) {
            foreach ($promptTypes as $promptType) {
                $existingRows = $this->existingEventRows((int) $day['pk'], (string) $topic['title'], $promptType);
                $prompt = $this->prompt($day, $topic, $promptType);
                $baseRow = [
                    'event' => (string) $topic['title'],
                    'prompt_type' => $promptType,
                    'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                    'existing_rows' => $existingRows,
                ];

                if ($missingOnly && $existingRows > 0) {
                    $rows[] = $baseRow + $this->skippedRow('existing_row');

                    continue;
                }

                if ($aiCallsUsed >= $aiCallLimit) {
                    $rows[] = $baseRow + $this->skippedRow('ai_call_guard_exhausted', true);

                    continue;
                }

                $identity = [
                    'aipk' => (int) $day['pk'],
                    'event_name' => (string) $topic['title'],
                    'prompt_type' => $promptType,
                ];

                if (Schema::hasColumn('urt_ai_event', 'condition_type')) {
                    $identity['condition_type'] = (string) $day['condition'];
                }

                $lock = $this->businessKeyLock->acquire('urt_ai_event', $identity);

                if ($lock === null) {
                    $rows[] = $baseRow + $this->skippedRow('business_key_locked', true);

                    continue;
                }

                try {
                    $existingRows = $this->existingEventRows((int) $day['pk'], (string) $topic['title'], $promptType);
                    $baseRow['existing_rows'] = $existingRows;

                    if ($missingOnly && $existingRows > 0) {
                        $rows[] = $baseRow + $this->skippedRow('existing_row');

                        continue;
                    }

                    $aiCallsUsed++;
                    $completion = $this->client->complete($prompt);
                    $fallbackUsed = false;
                    $fallbackReason = null;

                    try {
                        $resultJson = $this->normalizedJson($completion['content'], $promptType);
                    } catch (RuntimeException $exception) {
                        if ($exception->getMessage() !== 'invalid_json_response') {
                            throw $exception;
                        }

                        $resultJson = $this->fallbackJson($topic, $promptType);
                        $fallbackUsed = true;
                        $fallbackReason = 'invalid_json_response';
                    }

                    $upsert = $this->upsertEvent($day, $topic, $promptType, $resultJson, $completion['configured_model'], $userToken, $now);
                    $rows[] = $baseRow + [
                        'ai_call_attempted' => true,
                        'inserted' => $upsert['inserted'],
                        'updated' => $upsert['updated'],
                        'skipped' => false,
                        'failed' => false,
                        'skip_reason' => null,
                        'fallback_used' => $fallbackUsed,
                        'fallback_reason' => $fallbackReason,
                        'model' => $completion['model'],
                        'provider' => $completion['provider'],
                        'provider_failures' => $completion['provider_failures'],
                        'usage' => $completion['usage'],
                    ];
                } catch (Throwable $exception) {
                    $rows[] = $baseRow + [
                        'ai_call_attempted' => true,
                        'inserted' => false,
                        'updated' => false,
                        'skipped' => true,
                        'failed' => true,
                        'skip_reason' => $this->sanitizedFailure($exception),
                        'fallback_used' => false,
                        'fallback_reason' => null,
                        'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
                        'provider' => null,
                        'provider_failures' => [],
                        'usage' => null,
                    ];
                    Log::warning('AI event ingestion row failed.', [
                        'stage' => 'completion_or_write',
                        'date' => $day['date'],
                        'aipk' => $day['pk'],
                        'prompt_type' => $promptType,
                        'exception_class' => $exception::class,
                    ]);
                } finally {
                    $lock->release();
                }
            }
        }

        return $this->executeResult($day, $topics, $promptTypes, $now, $rows, $aiCallLimit, $aiCallsUsed);
    }

    /**
     * @param  list<array<string, mixed>>  $topics
     * @param  list<string>  $promptTypes
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function executeResult(array $day, array $topics, array $promptTypes, CarbonImmutable $now, array $rows, int $aiCallLimit, int $aiCallsUsed): array
    {
        $failedRows = collect($rows)->where('failed', true)->count();

        return [
            'mode' => 'execute',
            'status' => $failedRows > 0 ? 'partial_failure' : 'success',
            'exit_code' => $failedRows > 0 ? 1 : 0,
            'failed_rows' => $failedRows,
            'source' => 'legacy_ai_event',
            'date' => $day['date'],
            'date_from' => $day['date_from'],
            'date_to' => $day['date_to'],
            'condition' => $day['condition'],
            'aipk' => $day['pk'],
            'topics' => count($topics),
            'prompt_types' => $promptTypes,
            'event_ai' => [
                'attempted' => count($rows),
                'inserted' => collect($rows)->where('inserted', true)->count(),
                'updated' => collect($rows)->where('updated', true)->count(),
                'skipped' => collect($rows)->where('skipped', true)->count(),
                'failed' => $failedRows,
                'rows' => $rows,
            ],
            'ai_call_guard' => [
                'limit' => $aiCallLimit,
                'used' => $aiCallsUsed,
                'remaining' => max(0, $aiCallLimit - $aiCallsUsed),
            ],
            'write_targets' => ['urt_ai_event'],
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array{date: string|null, date_from: string|null, date_to: string|null, condition: string, pk: int|null, available: bool, topics: list<array<string, mixed>>}
     */
    private function day(?string $date, string $condition, ?int $aipk, int $limit): array
    {
        $condition = $this->condition($condition);
        $query = [];

        if ($aipk !== null && $aipk > 0) {
            $query['pk'] = $aipk;
        }

        $pathDate = $this->dateString($date) ?? 'latest';
        $request = Request::create('/ai/days/'.$pathDate.'/'.$condition, 'GET', [
            'date' => $pathDate,
            'condition' => $condition,
        ] + $query);

        try {
            $payload = $this->dailyReport->forRequest($request);
        } catch (QueryException) {
            return [
                'date' => $this->dateString($date),
                'date_from' => null,
                'date_to' => null,
                'condition' => $condition,
                'pk' => $aipk,
                'available' => false,
                'topics' => [],
            ];
        }

        return [
            'date' => $payload['date'] ?? $this->dateString($date),
            'date_from' => $payload['row']['date_from'] ?? null,
            'date_to' => $payload['row']['date_to'] ?? null,
            'condition' => (string) ($payload['condition'] ?? $condition),
            'pk' => isset($payload['row']['pk']) ? (int) $payload['row']['pk'] : null,
            'available' => (bool) ($payload['available'] ?? false),
            'topics' => collect($payload['topics'] ?? [])
                ->take(max(1, min(100, $limit)))
                ->map(fn (array $topic): array => $this->topic($topic))
                ->filter(fn (array $topic): bool => $topic['title'] !== '')
                ->values()
                ->all(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function topic(array $topic): array
    {
        return [
            'title' => trim((string) ($topic['title'] ?? '')),
            'media_count' => (int) ($topic['media_count'] ?? 0),
            'video_count' => (int) ($topic['video_count'] ?? 0),
            'keywords' => array_keys(array_slice((array) ($topic['keywords'] ?? []), 0, 12, true)),
            'people' => array_keys(array_slice((array) ($topic['people'] ?? []), 0, 12, true)),
            'angle' => (array) ($topic['angle'] ?? []),
            'camp' => (array) ($topic['camp'] ?? []),
            'party' => (array) ($topic['party'] ?? []),
            'media_event_rows' => collect($topic['media_event_rows'] ?? [])
                ->take(20)
                ->map(fn (array $row): array => [
                    'channel' => trim((string) ($row['channel'] ?? '')),
                    'u_id' => isset($row['u_id']) ? (int) $row['u_id'] : null,
                    'event' => trim((string) ($row['event'] ?? '')),
                    'video_count' => isset($row['video_count']) ? (int) $row['video_count'] : null,
                ])
                ->filter(fn (array $row): bool => $row['channel'] !== '' || $row['event'] !== '')
                ->values()
                ->all(),
            'videos' => collect($topic['videos'] ?? [])
                ->take(8)
                ->map(fn (array $video): array => [
                    'u_id' => isset($video['u_id']) ? (int) $video['u_id'] : null,
                    'channel' => trim((string) ($video['channel'] ?? '')),
                    'event' => trim((string) ($video['event'] ?? '')),
                    'video_id' => trim((string) ($video['video_id'] ?? $video['videoId'] ?? '')),
                ])
                ->filter(fn (array $video): bool => $video['video_id'] !== '')
                ->values()
                ->all(),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function topics(array $day, ?string $event, int $limit): array
    {
        $topics = collect($day['topics']);
        $event = is_string($event) ? trim($event) : '';

        if ($event !== '') {
            $topics = $topics->filter(fn (array $topic): bool => $topic['title'] === $event);
        }

        return $topics
            ->take(max(1, min(100, $limit)))
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $promptTypes
     * @param  list<array<string, mixed>>  $topics
     * @return list<array<string, mixed>>
     */
    private function planRows(array $day, array $topics, array $promptTypes, bool $missingOnly, bool $includePrompt): array
    {
        $rows = [];

        foreach ($topics as $topic) {
            foreach ($promptTypes as $promptType) {
                $prompt = $this->prompt($day, $topic, $promptType);
                $existingRows = $day['pk'] === null ? 0 : $this->existingEventRows((int) $day['pk'], (string) $topic['title'], $promptType);
                $row = [
                    'event' => (string) $topic['title'],
                    'prompt_type' => $promptType,
                    'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                    'existing_rows' => $existingRows,
                    'skipped' => $missingOnly && $existingRows > 0,
                    'skip_reason' => $missingOnly && $existingRows > 0 ? 'existing_row' : null,
                ];

                if ($includePrompt) {
                    $row['prompt'] = $prompt;
                }

                $rows[] = $row;
            }
        }

        return $rows;
    }

    /**
     * @param  list<string>  $promptTypes
     * @param  list<array<string, mixed>>  $topics
     */
    private function blockedReason(array $day, array $topics, array $promptTypes): ?string
    {
        if (! Schema::hasTable('urt_ai_event')) {
            return 'missing_urt_ai_event_table';
        }

        if (! $day['available']) {
            return 'daily_report_unavailable';
        }

        if ($day['pk'] === null) {
            return 'missing_daily_pk';
        }

        if ($day['date_from'] === null || $day['date_to'] === null) {
            return 'missing_daily_date_window';
        }

        if ($topics === []) {
            return 'missing_daily_topics';
        }

        return $promptTypes === [] ? 'missing_prompt_types' : null;
    }

    private function prompt(array $day, array $topic, string $promptType): string
    {
        return match ($promptType) {
            'people' => $this->peoplePrompt($day, $topic),
            'media' => $this->mediaPrompt($day, $topic),
            default => $this->summaryPrompt($day, $topic),
        };
    }

    private function summaryPrompt(array $day, array $topic): string
    {
        return implode("\n", [
            ...$this->basePromptLines($day, $topic),
            '',
            '請產生事件摘要 JSON。欄位必須完全使用下列英文 key：',
            '{"events":[{"event":"<事件標題>","description":"<100字內摘要>","keywords":["<關鍵字>"],"media":["<媒體名稱>"],"fact":[{"media":"<媒體名稱>","headline":"<事實陳述>","video_id":"<影片ID>"}],"opinion":[{"media":"<媒體名稱>","stance":"<立場或角度>","intensity":"高|中|低","content":"<評論重點>","video_id":"<影片ID>"}]}]}',
            'fact 和 opinion 至少各給 1 筆；video_id 必須優先使用輸入影片 ID，沒有就用空字串。只輸出合法 JSON，不要 markdown、code fence 或解釋。',
        ]);
    }

    private function peoplePrompt(array $day, array $topic): string
    {
        return implode("\n", [
            ...$this->basePromptLines($day, $topic),
            '',
            '請產生人物立場 JSON。欄位必須完全使用下列英文 key：',
            '{"main_subject":"<事件主體>","supporting_persons":[{"person":"<人物>","role":"<角色>","support_or_opposition":"支持|反對|中立|其他","strength":"高|中|低","description":"<立場說明>","videos":[{"media":"<媒體名稱>","video_id":"<影片ID>"}]}],"opposing_persons":[],"other_opinions_persons":[]}',
            '請依輸入的人物、媒體事件與影片整理，不要發明不在輸入訊號中的姓名；沒有某類人物就輸出空陣列。只輸出合法 JSON，不要 markdown、code fence 或解釋。',
        ]);
    }

    private function mediaPrompt(array $day, array $topic): string
    {
        return implode("\n", [
            ...$this->basePromptLines($day, $topic),
            '',
            '請產生媒體立場 JSON。欄位必須完全使用下列英文 key：',
            '{"main_subject":"<事件主體>","supporting_medias":[{"media":"<媒體名稱>","support_or_opposition":"支持|反對|中立|其他","strength":"高|中|低","description":"<報導角度>"}],"opposing_medias":[],"other_opinions_medias":[],"all_medias":["<媒體名稱>"]}',
            '每個出現在媒體事件中的媒體都要放入 all_medias，並依報導角度分到一個陣列。只輸出合法 JSON，不要 markdown、code fence 或解釋。',
        ]);
    }

    /**
     * @return list<string>
     */
    private function basePromptLines(array $day, array $topic): array
    {
        return [
            '你是台灣 YouTube 政論與新聞事件分析助理。',
            '只能使用下方輸入資料，不要補入外部資料或不存在的影片 ID。',
            '日期：'.($day['date'] ?? ''),
            'condition：'.$day['condition'],
            'urt_ai_date.pk：'.($day['pk'] ?? ''),
            '每日主題：'.$topic['title'],
            '媒體數：'.$topic['media_count'].'；影片數：'.$topic['video_count'],
            '關鍵字：'.$this->commaLine($topic['keywords']),
            '人物：'.$this->commaLine($topic['people']),
            '角度統計：'.json_encode($topic['angle'], JSON_UNESCAPED_UNICODE),
            '陣營統計：'.json_encode($topic['camp'], JSON_UNESCAPED_UNICODE),
            '媒體事件：',
            ...$this->mediaEventLines($topic),
            '代表影片：',
            ...$this->videoLines($topic),
        ];
    }

    /**
     * @return list<string>
     */
    private function mediaEventLines(array $topic): array
    {
        $lines = [];

        foreach ($topic['media_event_rows'] as $index => $row) {
            $lines[] = sprintf(
                '%d. %s | %s | videos=%s',
                $index + 1,
                $row['channel'] ?: '未知媒體',
                $row['event'] ?: '未知事件',
                $row['video_count'] === null ? '?' : (string) $row['video_count'],
            );
        }

        return $lines ?: ['- 無媒體事件明細'];
    }

    /**
     * @return list<string>
     */
    private function videoLines(array $topic): array
    {
        $lines = [];

        foreach ($topic['videos'] as $index => $video) {
            $lines[] = sprintf(
                '%d. %s | %s | %s | video_id=%s',
                $index + 1,
                $video['channel'] ?: '未知媒體',
                $video['event'] ?: '未知事件',
                $video['u_id'] === null ? 'u_id=?' : 'u_id='.$video['u_id'],
                $video['video_id'],
            );
        }

        return $lines ?: ['- 無代表影片'];
    }

    private function commaLine(array $items): string
    {
        return $items === [] ? '無' : implode('、', $items);
    }

    /**
     * @return list<string>
     */
    private function promptTypes(string $promptTypes): array
    {
        return AiCommandInputValidator::promptTypes($promptTypes);
    }

    private function dateString(?string $date): ?string
    {
        return AiCommandInputValidator::date($date, '--date');
    }

    private function condition(string $condition): string
    {
        return AiCommandInputValidator::condition($condition, AiCommandInputValidator::DAILY_CONDITIONS);
    }

    private function existingEventRows(int $aipk, string $event, string $promptType): int
    {
        if (! Schema::hasTable('urt_ai_event')) {
            return 0;
        }

        $query = DB::table('urt_ai_event')
            ->where('aipk', $aipk)
            ->where('event_name', $event)
            ->where('prompt_type', $promptType);

        if (Schema::hasColumn('urt_ai_event', 'del_flag')) {
            $query->whereNull('del_flag');
        }

        return $query->count();
    }

    /**
     * @return array{inserted: bool, updated: bool}
     */
    private function upsertEvent(array $day, array $topic, string $promptType, string $resultJson, string $model, string $userToken, CarbonImmutable $now): array
    {
        if (! Schema::hasTable('urt_ai_event')) {
            throw new RuntimeException('urt_ai_event table is missing');
        }

        $query = DB::table('urt_ai_event')
            ->where('aipk', (int) $day['pk'])
            ->where('event_name', (string) $topic['title'])
            ->where('prompt_type', $promptType);

        if (Schema::hasColumn('urt_ai_event', 'condition_type')) {
            $query->where('condition_type', $day['condition']);
        }

        if (Schema::hasColumn('urt_ai_event', 'del_flag')) {
            $query->whereNull('del_flag');
        }

        $existingPk = $query->orderByDesc('pk')->value('pk');
        $values = [
            'result_json' => $resultJson,
        ];

        foreach ([
            'mtime' => $now->format('Y-m-d H:i:s'),
            'date_from' => $day['date_from'],
            'date_to' => $day['date_to'],
            'ai_type' => $model,
            'data_type' => 'oneday',
            'user_token' => $userToken,
        ] as $column => $value) {
            if (Schema::hasColumn('urt_ai_event', $column)) {
                $values[$column] = $value;
            }
        }

        if ($existingPk === null) {
            $insert = [
                'aipk' => (int) $day['pk'],
                'event_name' => (string) $topic['title'],
                'prompt_type' => $promptType,
            ] + $values;

            foreach ([
                'ctime' => $now->format('Y-m-d H:i:s'),
                'condition_type' => $day['condition'],
                'del_flag' => null,
            ] as $column => $value) {
                if (Schema::hasColumn('urt_ai_event', $column)) {
                    $insert[$column] = $value;
                }
            }

            DB::table('urt_ai_event')->insert($insert);

            return ['inserted' => true, 'updated' => false];
        }

        if (Schema::hasColumn('urt_ai_event', 'condition_type')) {
            $values['condition_type'] = $day['condition'];
        }

        DB::table('urt_ai_event')
            ->where('pk', $existingPk)
            ->update($values);

        return ['inserted' => false, 'updated' => true];
    }

    private function normalizedJson(string $content, string $promptType): string
    {
        $validated = $this->jsonValidator->validateEventPayload($content, $promptType);

        if (! $validated['valid'] || ! is_string($validated['json'])) {
            $reason = (string) ($validated['failure_reason'] ?? 'invalid_ai_payload');

            throw new RuntimeException($reason === 'invalid_ai_json' ? 'invalid_json_response' : $reason);
        }

        return $validated['json'];
    }

    private function fallbackJson(array $topic, string $promptType): string
    {
        $payload = match ($promptType) {
            'people' => $this->fallbackPeoplePayload($topic),
            'media' => $this->fallbackMediaPayload($topic),
            default => $this->fallbackSummaryPayload($topic),
        };

        return json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @return array<string, mixed>
     */
    private function fallbackSummaryPayload(array $topic): array
    {
        $media = $this->topicMedia($topic);
        $facts = collect($topic['media_event_rows'])
            ->take(8)
            ->map(function (array $row) use ($topic): array {
                $video = $this->matchingVideo($topic, $row);

                return [
                    'media' => $row['channel'] ?: 'YouTube',
                    'headline' => $row['event'] ?: (string) $topic['title'],
                    'video_id' => $video['video_id'] ?? '',
                ];
            })
            ->filter(fn (array $row): bool => $row['headline'] !== '')
            ->values()
            ->all();

        if ($facts === []) {
            $facts[] = [
                'media' => $media[0] ?? 'YouTube',
                'headline' => (string) $topic['title'],
                'video_id' => (string) (($topic['videos'][0]['video_id'] ?? '') ?: ''),
            ];
        }

        $opinions = collect($topic['media_event_rows'])
            ->take(6)
            ->map(function (array $row) use ($topic): array {
                $video = $this->matchingVideo($topic, $row);

                return [
                    'media' => $row['channel'] ?: 'YouTube',
                    'stance' => '報導焦點',
                    'intensity' => '中',
                    'content' => $row['event'] ?: (string) $topic['title'],
                    'video_id' => $video['video_id'] ?? '',
                ];
            })
            ->filter(fn (array $row): bool => $row['content'] !== '')
            ->values()
            ->all();

        return [
            'events' => [
                [
                    'event' => (string) $topic['title'],
                    'description' => $this->fallbackDescription($topic, $media),
                    'keywords' => $topic['keywords'] !== [] ? $topic['keywords'] : [(string) $topic['title']],
                    'media' => $media,
                    'fact' => $facts,
                    'opinion' => $opinions,
                ],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function fallbackPeoplePayload(array $topic): array
    {
        $people = $topic['people'] !== [] ? $topic['people'] : [(string) $topic['title']];
        $videos = collect($topic['videos'])
            ->take(3)
            ->map(fn (array $video): array => [
                'media' => $video['channel'] ?: 'YouTube',
                'video_id' => $video['video_id'],
            ])
            ->values()
            ->all();

        return [
            'main_subject' => $people[0] ?? (string) $topic['title'],
            'supporting_persons' => collect($people)
                ->take(6)
                ->map(fn (string $person): array => [
                    'person' => $person,
                    'role' => '事件相關人物',
                    'support_or_opposition' => '其他',
                    'strength' => '中',
                    'description' => $person.' 出現在這個 daily topic 的人物訊號中。',
                    'videos' => $videos,
                ])
                ->values()
                ->all(),
            'opposing_persons' => [],
            'other_opinions_persons' => [],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function fallbackMediaPayload(array $topic): array
    {
        $media = $this->topicMedia($topic);

        return [
            'main_subject' => (string) $topic['title'],
            'supporting_medias' => collect($media)
                ->map(fn (string $name): array => [
                    'media' => $name,
                    'support_or_opposition' => '其他',
                    'strength' => '中',
                    'description' => $name.' 以此 daily topic 相關事件作為報導焦點。',
                ])
                ->values()
                ->all(),
            'opposing_medias' => [],
            'other_opinions_medias' => [],
            'all_medias' => $media,
        ];
    }

    /**
     * @return list<string>
     */
    private function topicMedia(array $topic): array
    {
        $media = collect($topic['media_event_rows'])
            ->map(fn (array $row): string => $row['channel'] ?: '')
            ->filter()
            ->unique()
            ->values()
            ->all();

        return $media === [] ? ['YouTube'] : $media;
    }

    private function fallbackDescription(array $topic, array $media): string
    {
        $mediaText = $media === [] ? '多個 YouTube 頻道' : implode('、', array_slice($media, 0, 4));

        return $mediaText.'在這一天共同報導「'.$topic['title'].'」，系統以 daily topic 的媒體事件、關鍵字、人物與影片訊號建立可顯示摘要。';
    }

    /**
     * @return array<string, mixed>
     */
    private function matchingVideo(array $topic, array $mediaEvent): array
    {
        foreach ($topic['videos'] as $video) {
            if (($mediaEvent['channel'] ?? '') !== '' && ($video['channel'] ?? '') === $mediaEvent['channel']) {
                return $video;
            }

            if (($mediaEvent['event'] ?? '') !== '' && ($video['event'] ?? '') === $mediaEvent['event']) {
                return $video;
            }
        }

        return $topic['videos'][0] ?? [];
    }

    /**
     * @return array<string, mixed>
     */
    private function skippedRow(string $reason, bool $failed = false): array
    {
        return [
            'ai_call_attempted' => false,
            'inserted' => false,
            'updated' => false,
            'skipped' => true,
            'failed' => $failed,
            'skip_reason' => $reason,
            'fallback_used' => false,
            'fallback_reason' => null,
            'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
            'provider' => null,
            'provider_failures' => [],
            'usage' => null,
        ];
    }

    private function sanitizedFailure(Throwable $exception): string
    {
        return SensitiveTextRedactor::exception($exception, 180);
    }
}
