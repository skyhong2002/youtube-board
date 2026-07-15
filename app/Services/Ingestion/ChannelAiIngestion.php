<?php

namespace App\Services\Ingestion;

use App\Support\AiChannelContract;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

class ChannelAiIngestion
{
    public function __construct(
        private readonly OpenCodeChatClient $client,
        private readonly AiJsonPayloadValidator $validator,
        private readonly AiBusinessKeyLock $businessKeyLock,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function preview(
        int $uId,
        string $from,
        ?string $to = null,
        string $dataType = 'auto',
        int $limit = 120,
        bool $includePrompt = false,
    ): array {
        $period = $this->period($from, $to);
        $dataType = $this->dataType($dataType, $period);
        $limit = max(1, min(500, $limit));

        if (! Schema::hasTable('urt_channel') || ! Schema::hasTable('urt_video') || ! Schema::hasTable('urt_channel_ai')) {
            throw new RuntimeException('required tables are missing: urt_channel, urt_video, urt_channel_ai');
        }

        $channel = DB::table('urt_channel')->where('u_id', $uId)->first();

        if ($channel === null) {
            throw new RuntimeException('channel not found for u_id='.$uId);
        }

        $videoQuery = DB::table('urt_video')
            ->where('u_id', $uId)
            ->where('publishedAt', '>=', $period['from'])
            ->where('publishedAt', '<=', $period['to'])
            ->orderByRaw('coalesce(viewCount, 0) desc');
        $sourceRows = (clone $videoQuery)->count();
        $videos = $videoQuery->limit($limit)->get();
        $bounds = AiChannelContract::boundsForVideoCount($videos->count());
        $prompt = $videos->isEmpty() ? '' : $this->prompt($videos, $bounds);

        return [
            'mode' => 'preview',
            'source' => 'legacy_channel_ai_manual',
            'u_id' => $uId,
            'channel_title' => (string) ($channel->title ?? 'Unknown channel'),
            'date_from' => $period['from'],
            'date_to' => $period['to'],
            'data_type' => $dataType,
            'source_video_rows' => $sourceRows,
            'prompt_video_rows' => $videos->count(),
            'prompt_bounds' => $bounds,
            'video_limit' => $limit,
            'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
            'prompt' => $includePrompt ? $prompt : null,
            'would_call_ai' => $prompt !== '',
            'would_write' => $prompt !== '' ? ['urt_channel_ai'] : [],
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        int $uId,
        string $from,
        ?string $to = null,
        string $dataType = 'auto',
        int $limit = 120,
        string $userToken = 'CLI',
    ): array {
        $preview = $this->preview($uId, $from, $to, $dataType, $limit, true);
        $prompt = (string) ($preview['prompt'] ?? '');
        unset($preview['prompt']);

        if ($prompt === '') {
            return $this->logged($preview + [
                'mode' => 'execute',
                'ai_call_attempted' => false,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'skip_reason' => 'no_source_videos',
                'write_targets' => [],
            ]);
        }

        $attributes = [
            'u_id' => $uId,
            'date_from' => (string) $preview['date_from'],
            'date_to' => (string) $preview['date_to'],
            'data_type' => (string) $preview['data_type'],
            'user_token' => $userToken,
        ];
        $lock = $this->businessKeyLock->acquire('urt_channel_ai', $attributes);

        if ($lock === null) {
            return $this->logged($preview + [
                'mode' => 'execute',
                'status' => 'failed',
                'exit_code' => 1,
                'failed_rows' => 1,
                'ai_call_attempted' => false,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'failed' => true,
                'skip_reason' => 'business_key_locked',
                'write_targets' => [],
            ]);
        }

        try {
            $bounds = is_array($preview['prompt_bounds'] ?? null)
                ? $preview['prompt_bounds']
                : AiChannelContract::boundsForVideoCount((int) ($preview['prompt_video_rows'] ?? 0));
            $providerValidation = null;
            $providerValidationAttempts = 0;

            try {
                $completion = $this->client->completeValidated(
                    $prompt,
                    function (string $content) use (&$providerValidation, &$providerValidationAttempts, $bounds): array {
                        $providerValidationAttempts++;
                        $providerValidation = null;

                        return $providerValidation = $this->validator->validateEventList(
                            $content,
                            'channel',
                            expectedMinItems: $bounds['min'],
                            expectedMaxItems: $bounds['max'],
                        );
                    },
                );
            } catch (Throwable $exception) {
                $validationReason = $this->exclusiveValidationFailureReason(
                    $providerValidation,
                    $providerValidationAttempts,
                    $exception,
                );

                if ($validationReason !== null) {
                    throw new RuntimeException(
                        $validationReason,
                        previous: $exception,
                    );
                }

                throw $exception;
            }

            $resultJson = $completion['validation']['json'] ?? null;

            if (! is_string($resultJson)) {
                throw new RuntimeException('invalid_ai_payload');
            }
            $existingPk = DB::table('urt_channel_ai')
                ->where($attributes)
                ->whereNull('del_flag')
                ->orderByDesc('pk')
                ->value('pk');
            $now = CarbonImmutable::now((string) config('ingestion.timezone', 'Asia/Taipei'))
                ->format('Y-m-d H:i:s');
            $values = [
                'mtime' => $now,
                'ai_type' => $completion['model'],
                'result_json' => $resultJson,
            ];

            if ($existingPk === null) {
                DB::table('urt_channel_ai')->insert($attributes + $values + [
                    'ctime' => $now,
                    'del_flag' => null,
                ]);
            } else {
                DB::table('urt_channel_ai')->where('pk', $existingPk)->update($values);
            }

            return $this->logged($preview + [
                'mode' => 'execute',
                'ai_call_attempted' => true,
                'model' => $completion['model'],
                'provider' => $completion['provider'],
                'provider_failures' => $completion['provider_failures'],
                'latency_ms' => $completion['latency_ms'],
                'usage' => $completion['usage'],
                'inserted' => $existingPk === null,
                'updated' => $existingPk !== null,
                'skipped' => false,
                'failed' => false,
                'skip_reason' => null,
                'write_targets' => ['urt_channel_ai'],
            ]);
        } catch (Throwable $exception) {
            Log::warning('Channel AI generation failed.', [
                'mode' => 'execute',
                'u_id' => $uId,
                'date_from' => $preview['date_from'],
                'date_to' => $preview['date_to'],
                'reason' => 'channel_ai_generation_failed',
                'exception' => $exception::class,
            ]);

            throw $exception;
        } finally {
            try {
                $lock->release();
            } catch (Throwable) {
                // An expired lock must not hide the completed AI result.
            }
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function logged(array $payload): array
    {
        Log::info('Channel AI generation completed.', [
            'mode' => $payload['mode'] ?? 'execute',
            'u_id' => $payload['u_id'] ?? null,
            'date_from' => $payload['date_from'] ?? null,
            'date_to' => $payload['date_to'] ?? null,
            'source_video_rows' => $payload['source_video_rows'] ?? 0,
            'inserted' => (bool) ($payload['inserted'] ?? false),
            'updated' => (bool) ($payload['updated'] ?? false),
            'skipped' => (bool) ($payload['skipped'] ?? false),
            'skip_reason' => $payload['skip_reason'] ?? null,
        ]);

        return $payload;
    }

    /**
     * @return array{from: string, to: string}
     */
    private function period(string $from, ?string $to): array
    {
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
            throw new InvalidArgumentException('--from must use YYYY-MM-DD');
        }

        $to = $to === null || trim($to) === '' ? $from : trim($to);

        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
            throw new InvalidArgumentException('--to must use YYYY-MM-DD');
        }

        try {
            $fromDate = CarbonImmutable::createFromFormat('!Y-m-d', $from);
            $toDate = CarbonImmutable::createFromFormat('!Y-m-d', $to);
        } catch (Throwable) {
            throw new InvalidArgumentException('--from and --to must be valid calendar dates');
        }

        if ($fromDate === false || $toDate === false || $fromDate->format('Y-m-d') !== $from || $toDate->format('Y-m-d') !== $to) {
            throw new InvalidArgumentException('--from and --to must be valid calendar dates');
        }

        if ($fromDate->greaterThan($toDate)) {
            throw new InvalidArgumentException('--from must not be after --to');
        }

        return [
            'from' => $from.' 00:00:00',
            'to' => $to.' 23:59:59',
        ];
    }

    /**
     * @param  array{from: string, to: string}  $period
     */
    private function dataType(string $dataType, array $period): string
    {
        $dataType = strtolower(trim($dataType));

        if ($dataType === 'auto') {
            $today = CarbonImmutable::now((string) config('ingestion.timezone', 'Asia/Taipei'))->toDateString();

            return substr($period['to'], 0, 10) === $today ? 'todate' : 'oneday';
        }

        if (! in_array($dataType, ['oneday', 'todate'], true)) {
            throw new InvalidArgumentException('--type must be auto, oneday, or todate');
        }

        return $dataType;
    }

    /**
     * @param  array{min: int, max: int}  $bounds
     */
    private function prompt(Collection $videos, array $bounds): string
    {
        $lines = [
            "請把下面的新聞列表整理成 {$bounds['min']} ~ {$bounds['max']} 個重要事件，列出事件、描述、角度、陣營、分類、關鍵字、人物、地名、類型與 videoId 陣列。請用繁體中文，只回應 JSON：",
        ];

        foreach ($videos as $video) {
            $lines[] = sprintf(
                '%s：%s (觀看:%d)',
                (string) $video->videoId,
                (string) ($video->title ?? ''),
                (int) ($video->viewCount ?? 0),
            );
        }

        return implode("\n", $lines);
    }

    /**
     * @param  array<string, mixed>|null  $validation
     */
    private function exclusiveValidationFailureReason(
        ?array $validation,
        int $validationAttempts,
        Throwable $exception,
    ): ?string {
        if (! is_array($validation) || ($validation['valid'] ?? false) || $validationAttempts <= 0) {
            return null;
        }

        if (preg_match('/failed after (\d+) provider\(s\):/', $exception->getMessage(), $matches) !== 1) {
            return null;
        }

        if ((int) $matches[1] !== $validationAttempts) {
            return null;
        }

        return (string) ($validation['failure_reason'] ?? 'invalid_ai_payload');
    }
}
