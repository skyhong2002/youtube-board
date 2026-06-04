<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class AiHourlyIngestion
{
    public function __construct(
        private readonly AiHourlyPreview $preview,
        private readonly OpenCodeChatClient $client,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(?string $condition = null, int $hour = 1, int $period = 1, int $limit = 20, string $userToken = 'cli'): array
    {
        $payload = $this->preview->preview(
            condition: $condition,
            hour: $hour,
            period: $period,
            limit: $limit,
        );

        if ((int) $payload['prompt_video_rows'] <= 0) {
            return [
                'mode' => 'execute',
                'source' => $payload['source'],
                'date_from' => $payload['date_from'],
                'date_to' => $payload['date_to'],
                'condition_type' => $payload['condition_type'],
                'prompt_video_rows' => $payload['prompt_video_rows'],
                'prompt_chars' => $payload['prompt_chars'],
                'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
                'provider' => null,
                'provider_failures' => [],
                'usage' => null,
                'write_targets' => [],
                'upserted' => false,
                'inserted' => false,
                'updated' => false,
                'skipped' => true,
                'skip_reason' => 'no_source_videos',
                'secrets' => 'not_printed',
            ];
        }

        $completion = $this->client->complete((string) $payload['prompt']);
        $now = CarbonImmutable::now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei')))
            ->format('Y-m-d H:i:s');
        $attributes = [
            'date_from' => $payload['date_from'],
            'date_to' => $payload['date_to'],
            'condition_type' => $payload['condition_type'],
            'ai_type' => $completion['model'],
            'data_type' => $payload['data_type'],
            'user_token' => $userToken,
        ];
        $values = [
            'mtime' => $now,
            'del_flag' => null,
            'result_json' => $completion['content'],
        ];

        $existingPk = DB::table('urt_ai_hour')
            ->where($attributes)
            ->value('pk');

        if ($existingPk === null) {
            DB::table('urt_ai_hour')->insert($attributes + $values + [
                'ctime' => $now,
            ]);
        } else {
            DB::table('urt_ai_hour')
                ->where('pk', $existingPk)
                ->update($values);
        }

        return [
            'mode' => 'execute',
            'source' => $payload['source'],
            'date_from' => $payload['date_from'],
            'date_to' => $payload['date_to'],
            'condition_type' => $payload['condition_type'],
            'prompt_video_rows' => $payload['prompt_video_rows'],
            'prompt_chars' => $payload['prompt_chars'],
            'model' => $completion['model'],
            'provider' => $completion['provider'],
            'provider_failures' => $completion['provider_failures'],
            'usage' => $completion['usage'],
            'write_targets' => [
                'urt_ai_hour.ctime',
                'urt_ai_hour.mtime',
                'urt_ai_hour.date_from',
                'urt_ai_hour.date_to',
                'urt_ai_hour.condition_type',
                'urt_ai_hour.ai_type',
                'urt_ai_hour.data_type',
                'urt_ai_hour.user_token',
                'urt_ai_hour.del_flag',
                'urt_ai_hour.result_json',
            ],
            'upserted' => true,
            'inserted' => $existingPk === null,
            'updated' => $existingPk !== null,
            'skipped' => false,
            'skip_reason' => null,
            'secrets' => 'not_printed',
        ];
    }
}
