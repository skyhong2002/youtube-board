<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

class AiDailyIngestion
{
    public function __construct(
        private readonly AiDailyPreview $preview,
        private readonly OpenCodeChatClient $client,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $date = null,
        ?string $condition = null,
        string $dataType = 'oneday',
        int $limit = 1000,
        int $channelLimit = 39,
        string $userToken = 'CLI',
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $date = $this->date($date, $now);
        $dataType = $this->dataType($dataType);
        $period = [
            'from' => $date.' 00:00:00',
            'to' => $date.' 23:59:59',
        ];
        $channelRows = $this->refreshChannelAi($period, $now, $channelLimit, $userToken);
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

            $completion = $this->client->complete($prompt);
            $resultJson = $this->stripJsonFence($completion['content']);
            $existingPk = DB::table('urt_ai_date')
                ->where('date_from', $period['from'])
                ->where('date_to', $period['to'])
                ->where('data_type', $dataType)
                ->where('condition_type', $row['condition'])
                ->where('ai_type', $completion['model'])
                ->where('user_token', $userToken)
                ->whereNull('del_flag')
                ->value('pk');
            $values = [
                'mtime' => $now->format('Y-m-d H:i:s'),
                'channel_id' => (string) ($row['channel_id_json'] ?? '{}'),
                'result_json' => $resultJson,
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

            $dailyRows[] = [
                'condition' => $row['condition'],
                'prompt_event_rows' => $row['prompt_event_rows'],
                'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                'model' => $completion['model'],
                'usage' => $completion['usage'],
                'inserted' => $existingPk === null,
                'updated' => $existingPk !== null,
                'skipped' => false,
                'skip_reason' => null,
            ];
        }

        return [
            'mode' => 'execute',
            'source' => 'legacy_make_ai_day',
            'date' => $date,
            'date_from' => $period['from'],
            'date_to' => $period['to'],
            'data_type' => $dataType,
            'conditions' => $dailyPlan['conditions'],
            'channel_ai' => [
                'attempted' => $channelRows->count(),
                'inserted' => $channelRows->where('inserted', true)->count(),
                'updated' => $channelRows->where('updated', true)->count(),
                'skipped' => $channelRows->where('skipped', true)->count(),
                'rows' => $channelRows->values()->all(),
            ],
            'daily_ai' => [
                'attempted' => count($dailyRows),
                'inserted' => collect($dailyRows)->where('inserted', true)->count(),
                'updated' => collect($dailyRows)->where('updated', true)->count(),
                'skipped' => collect($dailyRows)->where('skipped', true)->count(),
                'rows' => $dailyRows,
            ],
            'write_targets' => [
                'urt_channel_ai',
                'urt_ai_date',
            ],
            'secrets' => 'not_printed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param  array{from: string, to: string}  $period
     * @return \Illuminate\Support\Collection<int, array<string, mixed>>
     */
    private function refreshChannelAi(array $period, CarbonImmutable $now, int $channelLimit, string $userToken)
    {
        $dataType = substr($period['from'], 0, 10) === $now->toDateString() ? 'todate' : 'oneday';
        $rows = collect();

        foreach (array_slice(AiDailyPreview::channelAiUids(), 0, max(0, min(39, $channelLimit))) as $uId) {
            $videos = DB::table('urt_video')
                ->where('u_id', $uId)
                ->where('publishedAt', '>=', $period['from'])
                ->where('publishedAt', '<=', $period['to'])
                ->orderByDesc('viewCount')
                ->get();

            if ($videos->count() < 10) {
                $rows->push([
                    'u_id' => $uId,
                    'video_rows' => $videos->count(),
                    'inserted' => false,
                    'updated' => false,
                    'skipped' => true,
                    'skip_reason' => 'fewer_than_10_videos',
                ]);
                continue;
            }

            $prompt = $this->channelPrompt($videos);
            $completion = $this->client->complete($prompt);
            $resultJson = $this->stripJsonFence($completion['content']);
            $attributes = [
                'u_id' => $uId,
                'date_from' => $period['from'],
                'date_to' => $period['to'],
                'ai_type' => $completion['model'],
                'data_type' => $dataType,
                'user_token' => $userToken,
            ];
            $existingPk = DB::table('urt_channel_ai')
                ->where($attributes)
                ->whereNull('del_flag')
                ->value('pk');
            $values = [
                'mtime' => $now->format('Y-m-d H:i:s'),
                'result_json' => $resultJson,
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

            $rows->push([
                'u_id' => $uId,
                'video_rows' => $videos->count(),
                'prompt_chars' => mb_strlen($prompt, 'UTF-8'),
                'model' => $completion['model'],
                'usage' => $completion['usage'],
                'inserted' => $existingPk === null,
                'updated' => $existingPk !== null,
                'skipped' => false,
                'skip_reason' => null,
            ]);
        }

        return $rows;
    }

    private function channelPrompt(\Illuminate\Support\Collection $videos): string
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
    private function skippedDailyRow(array $row, string $reason): array
    {
        return [
            'condition' => $row['condition'],
            'prompt_event_rows' => $row['prompt_event_rows'],
            'prompt_chars' => 0,
            'model' => (string) config('services.opencode_go.model', 'qwen3.6-plus'),
            'usage' => null,
            'inserted' => false,
            'updated' => false,
            'skipped' => true,
            'skip_reason' => $reason,
        ];
    }

    private function date(?string $date, CarbonInterface $now): string
    {
        if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return $date;
        }

        return CarbonImmutable::instance($now->toDateTimeImmutable())->subDay()->toDateString();
    }

    private function dataType(string $dataType): string
    {
        return in_array($dataType, ['oneday', 'todate', 'week'], true) ? $dataType : 'oneday';
    }

    private function stripJsonFence(string $content): string
    {
        $content = trim($content);
        $content = preg_replace('/^```json\s*/i', '', $content) ?? $content;
        $content = preg_replace('/^```\s*/', '', $content) ?? $content;
        $content = preg_replace('/\s*```$/', '', $content) ?? $content;

        return trim($content);
    }
}
