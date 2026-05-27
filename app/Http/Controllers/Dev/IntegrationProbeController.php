<?php

namespace App\Http\Controllers\Dev;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class IntegrationProbeController extends Controller
{
    public function youtube(): JsonResponse
    {
        [$payload, $status] = $this->youtubePayload();

        return response()->json($payload, $status);
    }

    public function youtubePage(): Response
    {
        [$payload] = $this->youtubePayload();

        return response()->view('dev.youtube-check', [
            'payload' => $payload,
            'checks' => $this->integrationChecks($payload),
        ]);
    }

    /**
     * @return array{0: array<string, mixed>, 1: int}
     */
    private function youtubePayload(): array
    {
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || $apiKey === '') {
            return [[
                'ok' => false,
                'service' => 'youtube_data_api_v3',
                'error' => 'YOUTUBE_API_KEY is not configured.',
            ], 500];
        }

        $response = Http::timeout(10)->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'snippet,statistics',
            'id' => 'dQw4w9WgXcQ',
            'key' => $apiKey,
        ]);

        if (! $response->ok()) {
            return [[
                'ok' => false,
                'service' => 'youtube_data_api_v3',
                'http_status' => $response->status(),
                'error' => $response->json('error.message') ?? 'YouTube API request failed.',
            ], 502];
        }

        $item = $response->json('items.0');

        return [[
            'ok' => true,
            'service' => 'youtube_data_api_v3',
            'http_status' => $response->status(),
            'video' => [
                'id' => $item['id'] ?? null,
                'title' => $item['snippet']['title'] ?? null,
                'channel_title' => $item['snippet']['channelTitle'] ?? null,
                'published_at' => $item['snippet']['publishedAt'] ?? null,
                'view_count_available' => isset($item['statistics']['viewCount']),
            ],
        ], 200];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function integrationChecks(array $youtubePayload): array
    {
        return [
            $this->youtubeCheck($youtubePayload),
            $this->aiProviderCheck(),
            $this->dokployDeployCheck(),
            $this->tagAnalysisCheck(),
            $this->databaseCheck(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function youtubeCheck(array $payload): array
    {
        $ok = (bool) ($payload['ok'] ?? false);
        $missingKey = ($payload['error'] ?? null) === 'YOUTUBE_API_KEY is not configured.';

        return [
            'name' => 'YouTube Data API v3',
            'description' => '影片、直播、頻道統計與留言擷取使用的 Google API。',
            'state' => $ok ? 'ok' : ($missingKey ? 'missing' : 'failed'),
            'status' => $ok ? 'OK' : ($missingKey ? '未設定' : 'Failed'),
            'details' => array_values(array_filter([
                ['label' => '檢查方式', 'value' => 'live probe: videos.list(snippet,statistics)'],
                ['label' => 'HTTP 狀態', 'value' => (string) ($payload['http_status'] ?? 'n/a')],
                ['label' => '測試影片 ID', 'value' => (string) data_get($payload, 'video.id', 'n/a')],
                ['label' => '標題', 'value' => (string) data_get($payload, 'video.title', 'n/a')],
                ['label' => '頻道', 'value' => (string) data_get($payload, 'video.channel_title', 'n/a')],
                ['label' => 'viewCount 欄位', 'value' => data_get($payload, 'video.view_count_available') ? 'available' : 'missing'],
                ! $ok ? ['label' => '錯誤', 'value' => (string) ($payload['error'] ?? 'Unknown error')] : null,
            ])),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function aiProviderCheck(): array
    {
        $apiKey = config('services.opencode_go.api_key');
        $baseUrl = config('services.opencode_go.base_url');
        $model = config('services.opencode_go.model');
        $fallbackApiKey = config('services.opencode_go.fallback_api_key');

        $configured = is_string($apiKey) && trim($apiKey) !== '';
        $fallbackConfigured = is_string($fallbackApiKey) && trim($fallbackApiKey) !== '';

        return [
            'name' => 'OpenAI 相容 AI API',
            'description' => 'AI 每日、每小時與頻道摘要產生使用的 chat/messages 相容端點。',
            'state' => $configured || $fallbackConfigured ? 'configured' : 'missing',
            'status' => $configured || $fallbackConfigured ? '已設定' : '未設定',
            'details' => [
                ['label' => '檢查方式', 'value' => '設定檢查；不主動呼叫模型，避免產生成本。'],
                ['label' => 'Base URL', 'value' => is_string($baseUrl) && $baseUrl !== '' ? $baseUrl : 'n/a'],
                ['label' => 'Model', 'value' => is_string($model) && $model !== '' ? $model : 'n/a'],
                ['label' => 'Primary key', 'value' => $configured ? 'configured' : 'missing'],
                ['label' => 'Fallback key', 'value' => $fallbackConfigured ? 'configured' : 'not configured'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function dokployDeployCheck(): array
    {
        $webhookUrl = config('services.dokploy.deploy_webhook_url');
        $relaySecret = config('services.dokploy.deploy_relay_secret');
        $webhookConfigured = is_string($webhookUrl) && trim($webhookUrl) !== '';
        $secretConfigured = is_string($relaySecret) && trim($relaySecret) !== '';

        return [
            'name' => 'Dokploy deploy relay',
            'description' => 'main branch push 後觸發 Dokploy 重新部署的受簽章保護 relay。',
            'state' => $webhookConfigured && $secretConfigured ? 'configured' : 'missing',
            'status' => $webhookConfigured && $secretConfigured ? '已設定' : '未設定',
            'details' => [
                ['label' => '檢查方式', 'value' => '設定檢查；不呼叫 webhook，避免觸發部署。'],
                ['label' => 'Webhook URL', 'value' => $webhookConfigured ? 'configured' : 'missing'],
                ['label' => 'Relay secret', 'value' => $secretConfigured ? 'configured' : 'missing'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function tagAnalysisCheck(): array
    {
        return [
            'name' => 'tag.analysis.tw APIs',
            'description' => '關鍵字與群組資料同步 execute mode 會使用的 legacy 外部端點。',
            'state' => 'not_checked',
            'status' => '未執行',
            'details' => [
                ['label' => '檢查方式', 'value' => '端點列示；不主動呼叫外部 legacy API。'],
                ['label' => 'Keyword endpoint', 'value' => 'https://tag.analysis.tw/api/tag_json.php'],
                ['label' => 'Group endpoint', 'value' => 'https://tag.analysis.tw/api/group.php'],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function databaseCheck(): array
    {
        try {
            DB::select('select 1');

            return [
                'name' => 'Local database',
                'description' => '報表、cache fallback 與 ingestion preview 使用的本機資料庫連線。',
                'state' => 'ok',
                'status' => 'OK',
                'details' => [
                    ['label' => '檢查方式', 'value' => 'read-only: select 1'],
                    ['label' => 'Connection', 'value' => (string) config('database.default')],
                    ['label' => 'Database', 'value' => (string) config('database.connections.'.config('database.default').'.database')],
                ],
            ];
        } catch (\Throwable $exception) {
            return [
                'name' => 'Local database',
                'description' => '報表、cache fallback 與 ingestion preview 使用的本機資料庫連線。',
                'state' => 'failed',
                'status' => 'Failed',
                'details' => [
                    ['label' => '檢查方式', 'value' => 'read-only: select 1'],
                    ['label' => 'Connection', 'value' => (string) config('database.default')],
                    ['label' => '錯誤', 'value' => $exception->getMessage()],
                ],
            ];
        }
    }
}
