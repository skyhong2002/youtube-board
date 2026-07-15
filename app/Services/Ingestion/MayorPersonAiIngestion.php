<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\MayorPersonDailyReport;
use App\Services\Legacy\MayorReport;
use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

class MayorPersonAiIngestion
{
    public function __construct(
        private readonly MayorReport $mayorReport,
        private readonly MayorPersonDailyReport $dailyReport,
        private readonly OpenCodeChatClient $client,
        private readonly AiJsonPayloadValidator $jsonValidator,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(
        string $cityKey = 'taipei',
        ?string $person = null,
        ?string $date = null,
        int $limit = 10,
        ?CarbonInterface $now = null,
        bool $includePrompt = false,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $date = $this->date($date, $now);
        $city = $this->city($cityKey);
        $targets = $this->targets($city, $person, $limit);
        $rows = collect($targets)
            ->map(fn (array $target): array => $this->previewRow($city, $target, $date, $includePrompt))
            ->values()
            ->all();

        return [
            'mode' => 'ingestion-preview',
            'source' => 'mayor_person_ai',
            'city' => $city['key'],
            'city_label' => $city['label'],
            'date' => $date,
            'targets' => count($targets),
            'rows' => $rows,
            'would_call_ai_requests' => collect($rows)->where('would_call_ai', true)->count(),
            'would_upsert_rows' => collect($rows)->where('would_upsert', true)->count(),
            'api_call_skipped' => 'AI chat completions are intentionally skipped in planning mode',
            'writes' => [],
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        string $cityKey = 'taipei',
        ?string $person = null,
        ?string $date = null,
        int $limit = 10,
        int $aiCallLimit = 10,
        string $userToken = 'CLI',
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $date = $this->date($date, $now);
        $city = $this->city($cityKey);
        $targets = $this->targets($city, $person, $limit);

        if (! Schema::hasTable('urt_mayor_person_ai')) {
            throw new RuntimeException('urt_mayor_person_ai table is missing; run php artisan migrate --force first');
        }

        $aiCallLimit = max(0, $aiCallLimit);
        $aiCallsUsed = 0;
        $rows = [];

        foreach ($targets as $target) {
            $source = [];
            $prompt = '';
            $aiCallAttempted = false;
            $lock = null;
            try {
                $source = $this->source($city, $target['person'], $date);
                $prompt = $this->prompt($source);

                if (! $target['eligible']) {
                    $rows[] = $this->skippedRow($target, 'not_in_city_candidates', $source, $prompt);

                    continue;
                }

                if (! $this->hasSourceData($source)) {
                    $rows[] = $this->skippedRow($target, 'no_source_data', $source, $prompt);

                    continue;
                }

                if ($aiCallsUsed >= $aiCallLimit) {
                    $rows[] = $this->skippedRow(
                        $target,
                        'ai_call_guard_exhausted',
                        $source,
                        $prompt,
                        failed: true,
                    );

                    continue;
                }

                $lock = $this->businessKeyLock->acquire('urt_mayor_person_ai', [
                    'city_key' => $city['key'],
                    'person' => $target['person'],
                    'the_date' => $date,
                    'user_token' => $userToken,
                ]);

                if ($lock === null) {
                    $rows[] = $this->skippedRow(
                        $target,
                        'business_key_locked',
                        $source,
                        $prompt,
                        failed: true,
                    );

                    continue;
                }

                $aiCallsUsed++;
                $aiCallAttempted = true;
                $completion = $this->client->complete($prompt);
                $resultJson = $this->resultJson($completion['content']);
                $existingPk = DB::table('urt_mayor_person_ai')
                    ->where('city_key', $city['key'])
                    ->where('person', $target['person'])
                    ->where('the_date', $date)
                    ->where('user_token', $userToken)
                    ->whereNull('del_flag')
                    ->value('pk');
                $values = [
                    'mtime' => $now->format('Y-m-d H:i:s'),
                    'city_label' => $city['label'],
                    'ai_type' => $completion['model'],
                    'provider' => $completion['provider'],
                    'prompt_json' => json_encode(['version' => 1, 'prompt' => $prompt], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'source_json' => json_encode($source, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'result_json' => $resultJson,
                ];

                if ($existingPk === null) {
                    DB::table('urt_mayor_person_ai')->insert([
                        'ctime' => $now->format('Y-m-d H:i:s'),
                        'city_key' => $city['key'],
                        'city_label' => $city['label'],
                        'person' => $target['person'],
                        'the_date' => $date,
                        'user_token' => $userToken,
                        'del_flag' => null,
                    ] + $values);
                } else {
                    DB::table('urt_mayor_person_ai')
                        ->where('pk', $existingPk)
                        ->update($values);
                }

                $rows[] = [
                    'person' => $target['person'],
                    'eligible' => true,
                    'source_videos' => count($source['videos']),
                    'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                    'model' => $completion['model'],
                    'provider' => $completion['provider'],
                    'provider_failures' => $completion['provider_failures'],
                    'latency_ms' => $completion['latency_ms'],
                    'usage' => $completion['usage'],
                    'ai_call_attempted' => true,
                    'inserted' => $existingPk === null,
                    'updated' => $existingPk !== null,
                    'skipped' => false,
                    'failed' => false,
                    'skip_reason' => null,
                ];
            } catch (Throwable $exception) {
                $rows[] = $this->skippedRow(
                    $target,
                    $this->sanitizedFailure($exception),
                    $source,
                    $prompt,
                    $aiCallAttempted,
                    true,
                );
                Log::warning('Mayor person AI ingestion row failed.', [
                    'stage' => $aiCallAttempted ? 'completion_validation_or_write' : 'source',
                    'city' => $city['key'],
                    'date' => $date,
                    'person' => $target['person'],
                    'exception_class' => $exception::class,
                ]);
            } finally {
                $lock?->release();
            }
        }

        $failedRows = collect($rows)->where('failed', true)->count();

        return [
            'mode' => 'execute',
            'status' => $failedRows > 0 ? 'partial_failure' : 'success',
            'exit_code' => $failedRows > 0 ? 1 : 0,
            'failed_rows' => $failedRows,
            'source' => 'mayor_person_ai',
            'city' => $city['key'],
            'city_label' => $city['label'],
            'date' => $date,
            'targets' => count($targets),
            'rows' => $rows,
            'attempted' => count($rows),
            'inserted' => collect($rows)->where('inserted', true)->count(),
            'updated' => collect($rows)->where('updated', true)->count(),
            'skipped' => collect($rows)->where('skipped', true)->count(),
            'failed' => $failedRows,
            'ai_call_guard' => [
                'limit' => $aiCallLimit,
                'used' => $aiCallsUsed,
                'remaining' => max(0, $aiCallLimit - $aiCallsUsed),
            ],
            'write_targets' => ['urt_mayor_person_ai'],
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param  array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}  $city
     * @param  array{person: string, eligible: bool}  $target
     * @return array<string, mixed>
     */
    private function previewRow(array $city, array $target, string $date, bool $includePrompt): array
    {
        $source = $this->source($city, $target['person'], $date);
        $prompt = $this->prompt($source);
        $existingRows = $this->existingRows($city['key'], $target['person'], $date);
        $hasSourceData = $this->hasSourceData($source);
        $row = [
            'person' => $target['person'],
            'eligible' => $target['eligible'],
            'source_videos' => count($source['videos']),
            'selected_total' => $source['summary']['selected_total'] ?? 0,
            'existing_ai_rows' => $existingRows,
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'would_call_ai' => $target['eligible'] && $hasSourceData,
            'would_upsert' => $target['eligible'] && $hasSourceData,
            'skip_reason' => $target['eligible'] ? ($hasSourceData ? null : 'no_source_data') : 'not_in_city_candidates',
        ];

        if ($includePrompt) {
            $row['prompt'] = $prompt;
            $row['source'] = $source;
        }

        return $row;
    }

    /**
     * @param  array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}  $city
     * @return array<string, mixed>
     */
    private function source(array $city, string $person, string $date): array
    {
        $request = Request::create('/mayor/cities/'.$city['key'].'/people/'.$person.'/days/'.$date, 'GET', [
            'type' => 'tags_views',
        ]);
        $payload = $this->dailyReport->forPerson($request, $city['key'], $person, $date);

        return [
            'city' => [
                'key' => $city['key'],
                'label' => $city['label'],
            ],
            'person' => $person,
            'date' => $date,
            'type' => $payload['type'],
            'summary' => $payload['summary'],
            'daily_totals' => $payload['daily_totals'],
            'previous_totals' => $payload['previous_totals'],
            'tag_rows' => $payload['tag_rows'],
            'videos' => collect($payload['videos'])
                ->take(8)
                ->map(fn (array $video): array => [
                    'title' => $video['title'],
                    'channel' => $video['channel_title'],
                    'published_at' => $video['published_at'],
                    'view_count' => $video['view_count'],
                    'comment_count' => $video['comment_count'],
                    'video_id' => $video['video_id'],
                ])
                ->values()
                ->all(),
            'related_keywords' => $payload['related_keywords'],
        ];
    }

    /**
     * @param  array<string, mixed>  $source
     */
    private function prompt(array $source): string
    {
        $sourceJson = json_encode($source, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        return implode("\n", [
            '你是給台灣縣市首長或候選人幕僚看的每日 YouTube 輿情分析助理。',
            '請根據下方 JSON，用繁體中文產生「每日 Dashboard」分析。',
            '重點是這位人物今天發生什麼、哪些地方需要調整、今天可以做什麼。',
            '不要捏造 JSON 沒有的事件；如果資料不足，請明確說資料不足並給監測建議。',
            '只輸出 JSON，不要 Markdown，不要 code fence。JSON 格式：',
            '{"summary":"一段 80 字內摘要","what_happened":["3 到 6 條今天發生或媒體呈現的事"],"risks":[{"level":"low|medium|high","item":"風險項目","reason":"原因"}],"adjustments":["3 到 5 條訊息或策略調整"],"actions_today":["3 到 5 條今天可做的具體行動"],"follow_up_metrics":["2 到 4 條明天要追的指標"]}',
            '來源 JSON：',
            $sourceJson ?: '{}',
        ]);
    }

    /**
     * @param  array<string, mixed>  $source
     */
    private function hasSourceData(array $source): bool
    {
        return (float) ($source['summary']['selected_total'] ?? 0) !== 0.0
            || (float) ($source['daily_totals']['views'] ?? 0) !== 0.0
            || (float) ($source['daily_totals']['videos'] ?? 0) !== 0.0
            || ($source['videos'] ?? []) !== [];
    }

    /**
     * @return array{key: string, label: string, candidates: list<string>, factors: array<string, array<int, float>>, source: string}
     */
    private function city(string $cityKey): array
    {
        $cityKey = strtolower(trim($cityKey));

        if ($cityKey === '' || preg_match('/^[a-z0-9_]+$/', $cityKey) !== 1) {
            throw new InvalidArgumentException('--city contains unsupported characters');
        }

        $cities = $this->mayorReport->cities();

        if (! isset($cities[$cityKey])) {
            throw new InvalidArgumentException('--city must be one of: '.implode(', ', array_keys($cities)));
        }

        return $cities[$cityKey];
    }

    /**
     * @param  array{candidates: list<string>}  $city
     * @return list<array{person: string, eligible: bool}>
     */
    private function targets(array $city, ?string $person, int $limit): array
    {
        $limit = max(1, min(100, $limit));
        $requested = is_string($person) && trim($person) !== ''
            ? collect(explode(',', $person))->map(fn (string $name): string => trim($name))->filter()->values()->all()
            : $city['candidates'];

        return collect($requested)
            ->unique()
            ->take($limit)
            ->map(fn (string $name): array => [
                'person' => $name,
                'eligible' => in_array($name, $city['candidates'], true),
            ])
            ->values()
            ->all();
    }

    private function date(?string $date, CarbonImmutable $now): string
    {
        $date = AiCommandInputValidator::date($date, '--date');

        if ($date !== null) {
            return $date;
        }

        return $now->subDay()->toDateString();
    }

    private function existingRows(string $cityKey, string $person, string $date): int
    {
        if (! Schema::hasTable('urt_mayor_person_ai')) {
            return 0;
        }

        return DB::table('urt_mayor_person_ai')
            ->where('city_key', $cityKey)
            ->where('person', $person)
            ->where('the_date', $date)
            ->whereNull('del_flag')
            ->count();
    }

    /**
     * @param  array{person: string, eligible: bool}  $target
     * @param  array<string, mixed>  $source
     * @return array<string, mixed>
     */
    private function skippedRow(array $target, string $reason, array $source, string $prompt, bool $aiCallAttempted = false, bool $failed = false): array
    {
        return [
            'person' => $target['person'],
            'eligible' => $target['eligible'],
            'source_videos' => count($source['videos'] ?? []),
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
            'provider' => null,
            'provider_failures' => [],
            'usage' => null,
            'ai_call_attempted' => $aiCallAttempted,
            'inserted' => false,
            'updated' => false,
            'skipped' => true,
            'failed' => $failed,
            'skip_reason' => $reason,
        ];
    }

    private function resultJson(string $content): string
    {
        $validated = $this->jsonValidator->validateMayorPersonDashboard($content);

        if (! $validated['valid'] || ! is_string($validated['json'])) {
            throw new RuntimeException((string) ($validated['failure_reason'] ?? 'invalid_ai_payload'));
        }

        return $validated['json'];
    }

    private function sanitizedFailure(Throwable $exception): string
    {
        return SensitiveTextRedactor::exception($exception, 240);
    }
}
