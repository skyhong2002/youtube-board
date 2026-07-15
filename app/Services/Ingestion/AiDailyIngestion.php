<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class AiDailyIngestion
{
    public const MAX_CHANNEL_VIDEO_LIMIT = 500;

    public function __construct(
        private readonly AiDailyPreview $preview,
        private readonly OpenCodeChatClient $client,
        private readonly AiJsonPayloadValidator $jsonValidator,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $date = null,
        ?string $condition = null,
        string $dataType = 'oneday',
        int $limit = 1000,
        int $channelLimit = 39,
        int $channelOffset = 0,
        int $channelBatchSize = 0,
        int $aiCallLimit = 45,
        int $channelVideoLimit = 120,
        string $userToken = 'CLI',
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $date = $this->date($date, $now);
        $dataType = $this->dataType($dataType);
        $condition = $condition === null
            ? null
            : AiCommandInputValidator::condition($condition, AiCommandInputValidator::DAILY_CONDITIONS);
        $channelLimit = max(0, $channelLimit);
        $channelOffset = max(0, $channelOffset);
        $channelBatchSize = max(0, $channelBatchSize);
        $aiCallLimit = max(0, $aiCallLimit);
        $requestedChannelVideoLimit = $channelVideoLimit;
        $channelVideoLimit = $channelVideoLimit <= 0
            ? self::MAX_CHANNEL_VIDEO_LIMIT
            : min(self::MAX_CHANNEL_VIDEO_LIMIT, $channelVideoLimit);
        $period = [
            'from' => $date.' 00:00:00',
            'to' => $date.' 23:59:59',
        ];
        $aiCallsUsed = 0;
        $channelRows = $this->refreshChannelAi(
            period: $period,
            now: $now,
            channelLimit: $channelLimit,
            channelOffset: $channelOffset,
            channelBatchSize: $channelBatchSize,
            channelVideoLimit: $channelVideoLimit,
            userToken: $userToken,
            aiCallsUsed: $aiCallsUsed,
            aiCallLimit: $aiCallLimit,
        );
        $dailyPlan = $this->preview->preview(
            date: $date,
            condition: $condition,
            dataType: $dataType,
            limit: $limit,
            now: $now,
            includePrompts: true,
        );
        $dailyRows = [];

        foreach ($dailyPlan['condition_rows'] as $row) {
            $prompt = (string) ($row['prompt'] ?? '');

            if ((int) $row['prompt_event_rows'] <= 0 || trim($prompt) === '') {
                $dailyRows[] = $this->skippedDailyRow($row, 'no_source_events');

                continue;
            }

            if ($aiCallsUsed >= $aiCallLimit) {
                $dailyRows[] = $this->skippedDailyRow(
                    $row,
                    'ai_call_guard_exhausted',
                    $prompt,
                    failed: true,
                );

                continue;
            }

            $attributes = [
                'date_from' => $period['from'],
                'date_to' => $period['to'],
                'data_type' => $dataType,
                'condition_type' => (string) $row['condition'],
                'user_token' => $userToken,
            ];
            $lock = $this->businessKeyLock->acquire('urt_ai_date', $attributes);

            if ($lock === null) {
                $dailyRows[] = $this->skippedDailyRow($row, 'business_key_locked', $prompt, failed: true);

                continue;
            }

            try {
                try {
                    $aiCallsUsed++;
                    $completion = $this->client->complete($prompt);
                } catch (Throwable $exception) {
                    $dailyRows[] = $this->skippedDailyRow($row, $this->sanitizedFailure($exception), $prompt, true);
                    $this->logFailure('daily_completion', [
                        'condition' => $row['condition'],
                        'date' => $date,
                    ], $exception);

                    continue;
                }

                $validated = $this->jsonValidator->validateEventList((string) $completion['content'], 'daily');

                if (! $validated['valid']) {
                    $dailyRows[] = $this->skippedDailyRow(
                        $row,
                        (string) $validated['failure_reason'],
                        $prompt,
                        true,
                    );
                    $this->logFailure('daily_validation', [
                        'condition' => $row['condition'],
                        'date' => $date,
                        'model' => $completion['model'],
                        'provider' => $completion['provider'],
                        'failure_reason' => $validated['failure_reason'],
                        'content_chars' => mb_strlen((string) $completion['content'], 'UTF-8'),
                    ]);

                    continue;
                }

                try {
                    $existingPk = DB::table('urt_ai_date')
                        ->where('date_from', $period['from'])
                        ->where('date_to', $period['to'])
                        ->where('data_type', $dataType)
                        ->where('condition_type', $row['condition'])
                        ->where('user_token', $userToken)
                        ->whereNull('del_flag')
                        ->orderByDesc('pk')
                        ->value('pk');
                    $values = [
                        'mtime' => $now->format('Y-m-d H:i:s'),
                        'ai_type' => $completion['model'],
                        'channel_id' => (string) ($row['channel_id_json'] ?? '{}'),
                        'result_json' => $validated['json'],
                    ];

                    if ($existingPk === null) {
                        DB::table('urt_ai_date')->insert([
                            'ctime' => $now->format('Y-m-d H:i:s'),
                            'date_from' => $period['from'],
                            'date_to' => $period['to'],
                            'ai_type' => $completion['model'],
                            'data_type' => $dataType,
                            'condition_type' => $row['condition'],
                            'user_token' => $userToken,
                            'del_flag' => null,
                        ] + $values);
                    } else {
                        DB::table('urt_ai_date')
                            ->where('pk', $existingPk)
                            ->update($values);
                    }
                } catch (Throwable $exception) {
                    $dailyRows[] = $this->skippedDailyRow($row, $this->sanitizedFailure($exception), $prompt, true);
                    $this->logFailure('daily_write', [
                        'condition' => $row['condition'],
                        'date' => $date,
                        'model' => $completion['model'],
                        'provider' => $completion['provider'],
                    ], $exception);

                    continue;
                }

                $dailyRows[] = [
                    'condition' => $row['condition'],
                    'prompt_event_rows' => $row['prompt_event_rows'],
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
            } finally {
                $lock->release();
            }
        }

        $channelFailed = $channelRows->where('failed', true)->count();
        $dailyFailed = collect($dailyRows)->where('failed', true)->count();
        $failedRows = $channelFailed + $dailyFailed;

        return [
            'mode' => 'execute',
            'status' => $failedRows > 0 ? 'partial_failure' : 'success',
            'exit_code' => $failedRows > 0 ? 1 : 0,
            'failed_rows' => $failedRows,
            'source' => 'legacy_make_ai_day',
            'date' => $date,
            'date_from' => $period['from'],
            'date_to' => $period['to'],
            'data_type' => $dataType,
            'conditions' => $dailyPlan['conditions'],
            'channel_ai' => [
                'limit' => $channelLimit,
                'offset' => $channelOffset,
                'batch_size' => $channelBatchSize,
                'batches' => (int) ($channelRows->max('batch') ?? 0),
                'video_limit' => $channelVideoLimit,
                'video_limit_requested' => $requestedChannelVideoLimit,
                'video_limit_clamped' => $requestedChannelVideoLimit !== $channelVideoLimit,
                'video_limit_max' => self::MAX_CHANNEL_VIDEO_LIMIT,
                'prompt_truncated_channels' => $channelRows->where('prompt_truncated', true)->count(),
                'prompt_omitted_video_rows' => $channelRows->sum(fn (array $row): int => max(0, (int) ($row['prompt_omitted_video_rows'] ?? 0))),
                'attempted' => $channelRows->count(),
                'inserted' => $channelRows->where('inserted', true)->count(),
                'updated' => $channelRows->where('updated', true)->count(),
                'skipped' => $channelRows->where('skipped', true)->count(),
                'failed' => $channelFailed,
                'rows' => $channelRows->values()->all(),
            ],
            'daily_ai' => [
                'attempted' => count($dailyRows),
                'inserted' => collect($dailyRows)->where('inserted', true)->count(),
                'updated' => collect($dailyRows)->where('updated', true)->count(),
                'skipped' => collect($dailyRows)->where('skipped', true)->count(),
                'failed' => $dailyFailed,
                'rows' => $dailyRows,
            ],
            'write_targets' => [
                'urt_channel_ai',
                'urt_ai_date',
            ],
            'ai_call_guard' => [
                'limit' => $aiCallLimit,
                'used' => $aiCallsUsed,
                'remaining' => max(0, $aiCallLimit - $aiCallsUsed),
            ],
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param  array{from: string, to: string}  $period
     * @return Collection<int, array<string, mixed>>
     */
    private function refreshChannelAi(
        array $period,
        CarbonImmutable $now,
        int $channelLimit,
        int $channelOffset,
        int $channelBatchSize,
        int $channelVideoLimit,
        string $userToken,
        int &$aiCallsUsed,
        int $aiCallLimit,
    ) {
        $dataType = substr($period['from'], 0, 10) === $now->toDateString() ? 'todate' : 'oneday';
        $rows = collect();

        $configuredUIds = AiDailyPreview::channelAiUids();
        $uIds = $channelOffset <= 0 && $channelLimit >= count($configuredUIds)
            ? $configuredUIds
            : $this->eligibleChannelUIds($period, $channelLimit, $channelOffset);
        $batchSize = $channelBatchSize > 0 ? $channelBatchSize : max(1, count($uIds));
        $batches = array_chunk($uIds, $batchSize);

        foreach ($batches as $batchIndex => $batchUIds) {
            foreach ($batchUIds as $uId) {
                $videoRows = DB::table('urt_video')
                    ->where('u_id', $uId)
                    ->where('publishedAt', '>=', $period['from'])
                    ->where('publishedAt', '<=', $period['to'])
                    ->count();

                if ($videoRows < 10) {
                    $rows->push([
                        'u_id' => $uId,
                        'batch' => $batchIndex + 1,
                        'video_rows' => $videoRows,
                        'prompt_video_rows' => 0,
                        'ai_call_attempted' => false,
                        'inserted' => false,
                        'updated' => false,
                        'skipped' => true,
                        'failed' => false,
                        'skip_reason' => 'fewer_than_10_videos',
                    ]);

                    continue;
                }

                if ($aiCallsUsed >= $aiCallLimit) {
                    $rows->push([
                        'u_id' => $uId,
                        'batch' => $batchIndex + 1,
                        'video_rows' => $videoRows,
                        'prompt_video_rows' => 0,
                        'ai_call_attempted' => false,
                        'inserted' => false,
                        'updated' => false,
                        'skipped' => true,
                        'failed' => true,
                        'skip_reason' => 'ai_call_guard_exhausted',
                    ]);

                    continue;
                }

                $videosQuery = DB::table('urt_video')
                    ->where('u_id', $uId)
                    ->where('publishedAt', '>=', $period['from'])
                    ->where('publishedAt', '<=', $period['to'])
                    ->orderByDesc('viewCount');
                $videos = $videosQuery->limit($channelVideoLimit)->get();
                $promptMeta = [
                    'prompt_truncated' => $videoRows > $videos->count(),
                    'prompt_omitted_video_rows' => max(0, $videoRows - $videos->count()),
                ];

                $prompt = $this->channelPrompt($videos);
                $attributes = [
                    'u_id' => $uId,
                    'date_from' => $period['from'],
                    'date_to' => $period['to'],
                    'data_type' => $dataType,
                    'user_token' => $userToken,
                ];
                $lock = $this->businessKeyLock->acquire('urt_channel_ai', $attributes);

                if ($lock === null) {
                    $rows->push([
                        'u_id' => $uId,
                        'batch' => $batchIndex + 1,
                        'video_rows' => $videoRows,
                        'prompt_video_rows' => $videos->count(),
                        ...$promptMeta,
                        'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                        'ai_call_attempted' => false,
                        'inserted' => false,
                        'updated' => false,
                        'skipped' => true,
                        'failed' => true,
                        'skip_reason' => 'business_key_locked',
                    ]);

                    continue;
                }

                try {
                    try {
                        $aiCallsUsed++;
                        $completion = $this->client->complete($prompt);
                    } catch (Throwable $exception) {
                        $rows->push([
                            'u_id' => $uId,
                            'batch' => $batchIndex + 1,
                            'video_rows' => $videoRows,
                            'prompt_video_rows' => $videos->count(),
                            ...$promptMeta,
                            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                            'ai_call_attempted' => true,
                            'inserted' => false,
                            'updated' => false,
                            'skipped' => true,
                            'failed' => true,
                            'skip_reason' => $this->sanitizedFailure($exception),
                        ]);
                        $this->logFailure('channel_completion', [
                            'u_id' => $uId,
                            'date_from' => $period['from'],
                            'date_to' => $period['to'],
                        ], $exception);

                        continue;
                    }

                    $validated = $this->jsonValidator->validateEventList((string) $completion['content'], 'channel');

                    if (! $validated['valid']) {
                        $rows->push([
                            'u_id' => $uId,
                            'batch' => $batchIndex + 1,
                            'video_rows' => $videoRows,
                            'prompt_video_rows' => $videos->count(),
                            ...$promptMeta,
                            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                            'model' => $completion['model'],
                            'provider' => $completion['provider'],
                            'provider_failures' => $completion['provider_failures'],
                            'latency_ms' => $completion['latency_ms'],
                            'usage' => $completion['usage'],
                            'ai_call_attempted' => true,
                            'inserted' => false,
                            'updated' => false,
                            'skipped' => true,
                            'failed' => true,
                            'skip_reason' => $validated['failure_reason'],
                        ]);
                        $this->logFailure('channel_validation', [
                            'u_id' => $uId,
                            'date_from' => $period['from'],
                            'date_to' => $period['to'],
                            'model' => $completion['model'],
                            'provider' => $completion['provider'],
                            'failure_reason' => $validated['failure_reason'],
                            'content_chars' => mb_strlen((string) $completion['content'], 'UTF-8'),
                        ]);

                        continue;
                    }

                    try {
                        $existingPk = DB::table('urt_channel_ai')
                            ->where($attributes)
                            ->whereNull('del_flag')
                            ->orderByDesc('pk')
                            ->value('pk');
                        $values = [
                            'mtime' => $now->format('Y-m-d H:i:s'),
                            'ai_type' => $completion['model'],
                            'result_json' => $validated['json'],
                        ];

                        if ($existingPk === null) {
                            DB::table('urt_channel_ai')->insert($attributes + $values + [
                                'ctime' => $now->format('Y-m-d H:i:s'),
                                'del_flag' => null,
                            ]);
                        } else {
                            DB::table('urt_channel_ai')
                                ->where('pk', $existingPk)
                                ->update($values);
                        }
                    } catch (Throwable $exception) {
                        $rows->push([
                            'u_id' => $uId,
                            'batch' => $batchIndex + 1,
                            'video_rows' => $videoRows,
                            'prompt_video_rows' => $videos->count(),
                            ...$promptMeta,
                            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                            'model' => $completion['model'],
                            'provider' => $completion['provider'],
                            'provider_failures' => $completion['provider_failures'],
                            'latency_ms' => $completion['latency_ms'],
                            'usage' => $completion['usage'],
                            'ai_call_attempted' => true,
                            'inserted' => false,
                            'updated' => false,
                            'skipped' => true,
                            'failed' => true,
                            'skip_reason' => $this->sanitizedFailure($exception),
                        ]);
                        $this->logFailure('channel_write', [
                            'u_id' => $uId,
                            'date_from' => $period['from'],
                            'date_to' => $period['to'],
                            'model' => $completion['model'],
                            'provider' => $completion['provider'],
                        ], $exception);

                        continue;
                    }

                    $rows->push([
                        'u_id' => $uId,
                        'batch' => $batchIndex + 1,
                        'video_rows' => $videoRows,
                        'prompt_video_rows' => $videos->count(),
                        ...$promptMeta,
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
                    ]);
                } finally {
                    $lock->release();
                }
            }
        }

        return $rows;
    }

    /**
     * A capped scheduler run should spend its AI calls on channels that can produce rows.
     * Full uncapped execution still walks the original legacy channel list and records skips.
     *
     * @param  array{from: string, to: string}  $period
     * @return list<int>
     */
    private function eligibleChannelUIds(array $period, int $channelLimit, int $channelOffset = 0): array
    {
        $limit = max(0, min(count(AiDailyPreview::channelAiUids()), $channelLimit));
        $offset = max(0, min(count(AiDailyPreview::channelAiUids()), $channelOffset));

        if ($limit === 0) {
            return [];
        }

        $videoCounts = DB::table('urt_video')
            ->whereIn('u_id', AiDailyPreview::channelAiUids())
            ->where('publishedAt', '>=', $period['from'])
            ->where('publishedAt', '<=', $period['to'])
            ->select('u_id', DB::raw('COUNT(*) as video_rows'))
            ->groupBy('u_id')
            ->pluck('video_rows', 'u_id')
            ->mapWithKeys(fn (mixed $count, mixed $uId): array => [(int) $uId => (int) $count])
            ->all();

        return collect(AiDailyPreview::channelAiUids())
            ->filter(fn (int $uId): bool => ($videoCounts[$uId] ?? 0) >= 10)
            ->slice($offset)
            ->take($limit)
            ->values()
            ->all();
    }

    private function channelPrompt(Collection $videos): string
    {
        $count = $videos->count();
        $min = 3 + (int) floor($count / 31);
        $max = 6 + (int) ceil($count / 29);
        $lines = [
            "請把下面的新聞列表，整理成 {$min} ~ {$max} 個重要事件，讓每個事件新聞數較多且觀看數均勻分布，列出描述，並列出每個事件的關鍵字與人物與地名，加上一個欄位判斷出這事件論述的角度是比較偏台灣或是中國出發，也加上一個欄位判斷出這觀點立場是比較偏國民黨或民進黨陣營思考，以及新聞的分類（類型：政治、地方、國際、財經、娛樂、體育、氣象、生活、兩岸、健康、科技、文化)，跟分出來的 videoId (最前面的序號) 列表，後用 JSON 列出元素包含：事件、描述、角度、陣營、分類，以及關鍵字、人物、地名、類型、videoId 這幾個 Array，請用繁體中文回應，且只要 JSON 就好：",
        ];

        foreach ($videos as $video) {
            $lines[] = sprintf('%s：%s (觀看:%d)', $video->videoId, $video->title, (int) ($video->viewCount ?? 0));
        }

        return implode("\n", $lines);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function skippedDailyRow(
        array $row,
        string $reason,
        ?string $prompt = null,
        bool $aiCallAttempted = false,
        ?bool $failed = null,
    ): array {
        return [
            'condition' => $row['condition'],
            'prompt_event_rows' => $row['prompt_event_rows'],
            'prompt_chars' => $prompt === null ? 0 : mb_strlen($prompt, 'UTF-8'),
            'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
            'provider' => null,
            'provider_failures' => [],
            'usage' => null,
            'ai_call_attempted' => $aiCallAttempted,
            'inserted' => false,
            'updated' => false,
            'skipped' => true,
            'failed' => $failed ?? $aiCallAttempted,
            'skip_reason' => $reason,
        ];
    }

    private function date(?string $date, CarbonInterface $now): string
    {
        $now = CarbonImmutable::instance($now->toDateTimeImmutable());
        $date = AiCommandInputValidator::date($date, '--date', ['today', 'yesterday']);

        if ($date === 'today') {
            return $now->toDateString();
        }

        if ($date === 'yesterday') {
            return $now->subDay()->toDateString();
        }

        if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $date;
        }

        return $now->subDay()->toDateString();
    }

    private function dataType(string $dataType): string
    {
        return AiCommandInputValidator::type($dataType, AiCommandInputValidator::DAILY_DATA_TYPES);
    }

    /**
     * @param  array<string, mixed>  $context
     */
    private function logFailure(string $stage, array $context, ?Throwable $exception = null): void
    {
        if ($exception !== null) {
            $context['exception_class'] = $exception::class;
        }

        Log::warning('AI daily ingestion item failed.', ['stage' => $stage] + $context);
    }

    private function sanitizedFailure(Throwable $exception): string
    {
        return SensitiveTextRedactor::exception($exception, 240);
    }
}
