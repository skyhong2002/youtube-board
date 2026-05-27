<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class IntegrationCheckController extends Controller
{
    public function index(): Response
    {
        return $this->renderPage($this->youtubeConfigPayload(), 'config-only · external services and dependencies');
    }

    public function devCheck(): Response|RedirectResponse
    {
        if (! app()->environment(['local', 'testing'])) {
            return redirect()->to(secure_url('/ops/integrations'), 308);
        }

        [$payload] = $this->youtubeLivePayload();

        return $this->renderPage($payload, 'live probe · external services and dependencies');
    }

    public function youtube(): JsonResponse
    {
        [$payload, $status] = $this->youtubeLivePayload();

        return response()->json($payload, $status);
    }

    private function renderPage(array $youtubePayload, string $meta): Response
    {
        return response()->view('ops.integrations', [
            'checks' => $this->integrationChecks($youtubePayload),
            'meta' => $meta,
            'liveProbe' => ($youtubePayload['probe_mode'] ?? null) === 'live',
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function youtubeConfigPayload(): array
    {
        $apiKey = config('services.youtube.api_key');
        $configured = is_string($apiKey) && trim($apiKey) !== '';

        return [
            'ok' => $configured,
            'service' => 'youtube_data_api_v3',
            'probe_mode' => 'config',
            'configured' => $configured,
            'error' => $configured ? null : 'YOUTUBE_API_KEY is not configured.',
        ];
    }

    /**
     * @return array{0: array<string, mixed>, 1: int}
     */
    private function youtubeLivePayload(): array
    {
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || $apiKey === '') {
            return [[
                'ok' => false,
                'service' => 'youtube_data_api_v3',
                'probe_mode' => 'live',
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
                'probe_mode' => 'live',
                'http_status' => $response->status(),
                'error' => $response->json('error.message') ?? 'YouTube API request failed.',
            ], 502];
        }

        $item = $response->json('items.0');

        return [[
            'ok' => true,
            'service' => 'youtube_data_api_v3',
            'probe_mode' => 'live',
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
        if (($payload['probe_mode'] ?? null) === 'config') {
            $configured = (bool) ($payload['configured'] ?? false);

            return [
                'name' => 'YouTube Data API v3',
                'description' => '影片、直播、頻道統計與留言擷取使用的 Google API。',
                'state' => $configured ? 'configured' : 'missing',
                'status' => $configured ? 'configured' : 'missing',
                'details' => [
                    ['label' => 'Check', 'value' => 'config only; no external request'],
                    ['label' => 'API key', 'value' => $configured ? 'configured' : 'missing'],
                    ['label' => 'Live probe', 'value' => 'local/testing only'],
                ],
            ];
        }

        $ok = (bool) ($payload['ok'] ?? false);
        $missingKey = ($payload['error'] ?? null) === 'YOUTUBE_API_KEY is not configured.';

        return [
            'name' => 'YouTube Data API v3',
            'description' => '影片、直播、頻道統計與留言擷取使用的 Google API。',
            'state' => $ok ? 'ok' : ($missingKey ? 'missing' : 'failed'),
            'status' => $ok ? 'OK' : ($missingKey ? 'missing' : 'failed'),
            'details' => array_values(array_filter([
                ['label' => 'Check', 'value' => 'live probe: videos.list(snippet,statistics)'],
                ['label' => 'HTTP status', 'value' => (string) ($payload['http_status'] ?? 'n/a')],
                ['label' => 'Test video ID', 'value' => (string) data_get($payload, 'video.id', 'n/a')],
                ['label' => 'Title', 'value' => (string) data_get($payload, 'video.title', 'n/a')],
                ['label' => 'Channel', 'value' => (string) data_get($payload, 'video.channel_title', 'n/a')],
                ['label' => 'viewCount field', 'value' => data_get($payload, 'video.view_count_available') ? 'available' : 'missing'],
                ! $ok ? ['label' => 'Error', 'value' => (string) ($payload['error'] ?? 'Unknown error')] : null,
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
            'name' => 'OpenAI-compatible AI API',
            'description' => 'AI 每日、每小時與頻道摘要產生使用的 chat/messages 相容端點。',
            'state' => $configured || $fallbackConfigured ? 'configured' : 'missing',
            'status' => $configured || $fallbackConfigured ? 'configured' : 'missing',
            'details' => [
                ['label' => 'Check', 'value' => 'config only; no model request'],
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
            'status' => $webhookConfigured && $secretConfigured ? 'configured' : 'missing',
            'details' => [
                ['label' => 'Check', 'value' => 'config only; no webhook request'],
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
            'status' => 'not checked',
            'details' => [
                ['label' => 'Check', 'value' => 'endpoint inventory only; no external request'],
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
                'name' => 'Database',
                'description' => '報表、cache fallback 與 ingestion preview 使用的資料庫連線。',
                'state' => 'ok',
                'status' => 'OK',
                'details' => [
                    ['label' => 'Check', 'value' => 'read-only: select 1'],
                    ['label' => 'Connection', 'value' => (string) config('database.default')],
                    ['label' => 'Database', 'value' => (string) config('database.connections.'.config('database.default').'.database')],
                ],
            ];
        } catch (\Throwable $exception) {
            return [
                'name' => 'Database',
                'description' => '報表、cache fallback 與 ingestion preview 使用的資料庫連線。',
                'state' => 'failed',
                'status' => 'failed',
                'details' => [
                    ['label' => 'Check', 'value' => 'read-only: select 1'],
                    ['label' => 'Connection', 'value' => (string) config('database.default')],
                    ['label' => 'Error', 'value' => $exception->getMessage()],
                ],
            ];
        }
    }
}
