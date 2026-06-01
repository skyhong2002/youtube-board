<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use App\Services\Ingestion\IngestionRunHistory;
use App\Services\Integrations\YoutubeDataApiQuotaUsage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class IntegrationCheckController extends Controller
{
    public function index(IngestionRunHistory $history): Response
    {
        $youtubePayload = $this->youtubeConfigPayload();
        $youtubePayload['quota'] = $this->cachedYoutubeQuotaPayload();
        $youtubePayload['local_quota_estimate'] = $history->youtubeQuotaDailyEstimate();

        return $this->renderPage(
            $youtubePayload,
            $this->cachedTagAnalysisLivePayload(),
            'config-only + public endpoint health checks',
        );
    }

    public function devCheck(IngestionRunHistory $history): Response|RedirectResponse
    {
        if (! app()->environment(['local', 'testing'])) {
            return redirect()->to(secure_url('/ops/integrations'), 308);
        }

        [$payload] = $this->youtubeLivePayload();
        $payload['quota'] = $this->cachedYoutubeQuotaPayload();
        $payload['local_quota_estimate'] = $history->youtubeQuotaDailyEstimate();

        return $this->renderPage(
            $payload,
            $this->cachedTagAnalysisLivePayload(),
            'live probe · external services and dependencies',
        );
    }

    public function youtube(IngestionRunHistory $history): JsonResponse
    {
        [$payload, $status] = $this->youtubeLivePayload();
        $payload['quota'] = $this->cachedYoutubeQuotaPayload();
        $payload['local_quota_estimate'] = $history->youtubeQuotaDailyEstimate();

        return response()->json($payload, $status);
    }

    private function renderPage(array $youtubePayload, array $tagAnalysisPayload, string $meta): Response
    {
        return response()->view('ops.integrations', [
            'checks' => $this->integrationChecks($youtubePayload, $tagAnalysisPayload),
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
    private function integrationChecks(array $youtubePayload, array $tagAnalysisPayload): array
    {
        return [
            $this->youtubeCheck($youtubePayload),
            $this->aiProviderCheck(),
            $this->dokployDeployCheck(),
            $this->tagAnalysisCheck($tagAnalysisPayload),
            $this->databaseCheck(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function youtubeCheck(array $payload): array
    {
        $quotaDetails = $this->youtubeQuotaDetails(is_array($payload['quota'] ?? null) ? $payload['quota'] : null);
        $quotaState = $this->youtubeQuotaState(is_array($payload['quota'] ?? null) ? $payload['quota'] : null);
        $localQuotaDetails = $this->youtubeLocalQuotaDetails(is_array($payload['local_quota_estimate'] ?? null) ? $payload['local_quota_estimate'] : null);

        if (($payload['probe_mode'] ?? null) === 'config') {
            $configured = (bool) ($payload['configured'] ?? false);

            return [
                'name' => 'YouTube Data API v3',
                'description' => '影片、直播、頻道統計與留言擷取使用的 Google API。',
                'state' => $quotaState ?: ($configured ? 'configured' : 'missing'),
                'status' => $quotaState === 'failed' ? 'quota failed' : ($quotaState === 'not_checked' ? 'quota warning' : ($configured ? 'configured' : 'missing')),
                'details' => array_merge([
                    ['label' => 'Check', 'value' => 'config only; no external request'],
                    ['label' => 'API key', 'value' => $configured ? 'configured' : 'missing'],
                    ['label' => 'Live probe', 'value' => 'local/testing only'],
                ], $localQuotaDetails, $quotaDetails),
            ];
        }

        $ok = (bool) ($payload['ok'] ?? false);
        $missingKey = ($payload['error'] ?? null) === 'YOUTUBE_API_KEY is not configured.';
        $state = $ok ? 'ok' : ($missingKey ? 'missing' : 'failed');

        if ($quotaState === 'failed') {
            $state = 'failed';
        }

        return [
            'name' => 'YouTube Data API v3',
            'description' => '影片、直播、頻道統計與留言擷取使用的 Google API。',
            'state' => $state,
            'status' => $quotaState === 'failed' ? 'quota failed' : ($quotaState === 'not_checked' ? 'quota warning' : ($ok ? 'OK' : ($missingKey ? 'missing' : 'failed'))),
            'details' => array_merge(array_values(array_filter([
                ['label' => 'Check', 'value' => 'live probe: videos.list(snippet,statistics)'],
                ['label' => 'HTTP status', 'value' => (string) ($payload['http_status'] ?? 'n/a')],
                ['label' => 'Test video ID', 'value' => (string) data_get($payload, 'video.id', 'n/a')],
                ['label' => 'Title', 'value' => (string) data_get($payload, 'video.title', 'n/a')],
                ['label' => 'Channel', 'value' => (string) data_get($payload, 'video.channel_title', 'n/a')],
                ['label' => 'viewCount field', 'value' => data_get($payload, 'video.view_count_available') ? 'available' : 'missing'],
                ! $ok ? ['label' => 'Error', 'value' => (string) ($payload['error'] ?? 'Unknown error')] : null,
            ])), $localQuotaDetails, $quotaDetails),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function cachedYoutubeQuotaPayload(): array
    {
        $quota = app(YoutubeDataApiQuotaUsage::class);

        if (! $quota->isConfigured()) {
            return $quota->snapshot();
        }

        $cacheKey = 'ops.integrations.youtube_quota_payload';
        $cached = Cache::get($cacheKey);

        if (is_array($cached)) {
            return $cached;
        }

        $snapshot = $quota->snapshot();

        Cache::put(
            $cacheKey,
            $snapshot,
            now()->addMinutes(($snapshot['ok'] ?? false) === true ? 5 : 1),
        );

        return $snapshot;
    }

    /**
     * @return list<array{label: string, value: string}>
     */
    private function youtubeQuotaDetails(?array $quota): array
    {
        if ($quota === null) {
            return [
                ['label' => 'Quota usage', 'value' => 'not checked'],
            ];
        }

        if (($quota['configured'] ?? false) !== true) {
            return [
                ['label' => 'Quota usage', 'value' => 'not configured; requires Google Cloud Monitoring read credentials'],
                ['label' => 'Quota source', 'value' => (string) ($quota['source'] ?? 'n/a')],
                ['label' => 'Daily quota limit', 'value' => number_format((int) ($quota['daily_limit'] ?? 10000)).' units'],
            ];
        }

        if (($quota['ok'] ?? false) !== true) {
            return [
                ['label' => 'Quota usage', 'value' => 'failed to read from Google Cloud Monitoring'],
                ['label' => 'Quota source', 'value' => (string) ($quota['source'] ?? 'n/a')],
                ['label' => 'Error', 'value' => (string) ($quota['error'] ?? 'Unknown quota monitor error')],
            ];
        }

        $used = (int) ($quota['used_units'] ?? 0);
        $limit = (int) ($quota['daily_limit'] ?? 10000);
        $percent = number_format((float) ($quota['percent_used'] ?? 0), 1);
        $remaining = (int) ($quota['remaining_units'] ?? max(0, $limit - $used));
        $topMethods = collect(is_array($quota['top_methods'] ?? null) ? $quota['top_methods'] : [])
            ->map(fn (array $row): string => sprintf(
                '%s=%s',
                (string) ($row['method'] ?? 'unknown method'),
                number_format((int) ($row['units'] ?? 0)),
            ))
            ->implode('; ');

        return array_values(array_filter([
            ['label' => 'Quota usage', 'value' => sprintf('%s / %s units (%s%%)', number_format($used), number_format($limit), $percent)],
            ['label' => 'Quota remaining', 'value' => number_format($remaining).' units'],
            ['label' => 'Quota window', 'value' => sprintf('%s -> %s', (string) ($quota['window_start'] ?? 'n/a'), (string) ($quota['window_end'] ?? 'n/a'))],
            ['label' => 'Last quota sample', 'value' => (string) ($quota['last_sample_at'] ?? 'n/a')],
            ['label' => 'Quota source', 'value' => (string) ($quota['source'] ?? 'n/a')],
            $topMethods !== '' ? ['label' => 'Top quota methods', 'value' => $topMethods] : null,
        ]));
    }

    /**
     * @return list<array{label: string, value: string}>
     */
    private function youtubeLocalQuotaDetails(?array $quota): array
    {
        if ($quota === null) {
            return [
                ['label' => 'Local quota estimate', 'value' => 'not checked'],
            ];
        }

        $used = (int) ($quota['estimated_units'] ?? 0);
        $limit = (int) ($quota['daily_limit'] ?? 10000);
        $percent = number_format((float) ($quota['percent_used'] ?? 0), 1);
        $remaining = (int) ($quota['remaining_units'] ?? max(0, $limit - $used));
        $topJobs = collect(is_array($quota['job_breakdown'] ?? null) ? $quota['job_breakdown'] : [])
            ->take(5)
            ->map(fn (array $row): string => sprintf(
                '%s=%s',
                (string) ($row['job'] ?? 'unknown'),
                number_format((int) ($row['units'] ?? 0)),
            ))
            ->implode('; ');

        return array_values(array_filter([
            ['label' => 'Local quota estimate', 'value' => sprintf('%s / %s units (%s%%)', number_format($used), number_format($limit), $percent)],
            ['label' => 'Local quota remaining', 'value' => number_format($remaining).' units'],
            ['label' => 'Local quota window', 'value' => sprintf('%s -> %s', (string) ($quota['window_start'] ?? 'n/a'), (string) ($quota['window_end'] ?? 'n/a'))],
            ['label' => 'Local quota records', 'value' => number_format((int) ($quota['record_count'] ?? 0)).' execute run records'],
            $topJobs !== '' ? ['label' => 'Local top quota jobs', 'value' => $topJobs] : null,
        ]));
    }

    private function youtubeQuotaState(?array $quota): ?string
    {
        if ($quota === null || ($quota['configured'] ?? false) !== true) {
            return null;
        }

        if (($quota['ok'] ?? false) !== true) {
            return 'failed';
        }

        $percentUsed = (float) ($quota['percent_used'] ?? 0);
        $warningPercent = (float) ($quota['warning_percent'] ?? 80);

        return $percentUsed >= $warningPercent ? 'not_checked' : null;
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
    private function cachedTagAnalysisLivePayload(): array
    {
        $cacheKey = 'ops.integrations.tag_analysis_live_payload';
        $cached = Cache::get($cacheKey);

        if (is_array($cached)) {
            return $cached;
        }

        $payload = $this->tagAnalysisLivePayload();

        Cache::put(
            $cacheKey,
            $payload,
            now()->addMinutes((bool) ($payload['ok'] ?? false) ? 10 : 1),
        );

        return $payload;
    }

    /**
     * @return array<string, mixed>
     */
    private function tagAnalysisLivePayload(): array
    {
        $keyword = $this->probeTagAnalysisEndpoint(
            'keyword',
            'https://tag.analysis.tw/api/tag_json.php',
            ['hours' => 2],
        );
        $group = $this->probeTagAnalysisEndpoint(
            'group',
            'https://tag.analysis.tw/api/group.php',
            ['hours' => 22],
        );

        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));

        return [
            'ok' => (bool) ($keyword['ok'] ?? false) && (bool) ($group['ok'] ?? false),
            'service' => 'shin_wen_yi_shu_tag_analysis',
            'probe_mode' => 'live',
            'checked_at' => now($timezone)->format('Y-m-d H:i:s'),
            'keyword' => $keyword,
            'group' => $group,
        ];
    }

    /**
     * @param  array<string, int>  $query
     * @return array<string, mixed>
     */
    private function probeTagAnalysisEndpoint(string $kind, string $endpoint, array $query): array
    {
        try {
            $response = Http::timeout(10)
                ->retry(1, 250)
                ->get($endpoint, $query);
        } catch (\Throwable $exception) {
            return [
                'ok' => false,
                'endpoint' => $endpoint,
                'http_status' => 'n/a',
                'rows' => 0,
                'shape' => 'request failed',
                'error' => $exception->getMessage(),
            ];
        }

        $payload = $response->json();

        if ($kind === 'keyword') {
            $validShape = is_array($payload) && array_is_list($payload);
            $rows = $validShape ? count($payload) : 0;
        } else {
            $validShape = is_array($payload)
                && array_key_exists('result', $payload)
                && ($payload['result'] === null || is_array($payload['result']));
            $rows = $validShape && is_array($payload['result']) ? count($payload['result']) : 0;
        }

        return [
            'ok' => $response->successful() && $validShape,
            'endpoint' => $endpoint,
            'http_status' => $response->status(),
            'rows' => $rows,
            'shape' => $validShape ? 'valid JSON shape' : 'unexpected JSON shape',
            'error' => $response->successful() && $validShape ? null : 'Unexpected response from tag.analysis.tw.',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function tagAnalysisCheck(array $payload): array
    {
        $ok = (bool) ($payload['ok'] ?? false);
        $keyword = is_array($payload['keyword'] ?? null) ? $payload['keyword'] : [];
        $group = is_array($payload['group'] ?? null) ? $payload['group'] : [];

        return [
            'name' => '新文易數 tag.analysis.tw APIs',
            'description' => '關鍵字與群組資料同步 execute mode 會使用的新文易數公開 API。',
            'state' => $ok ? 'ok' : 'failed',
            'status' => $ok ? 'OK' : 'failed',
            'details' => array_values(array_filter([
                ['label' => 'Check', 'value' => 'cached public endpoint probe; health-check GET; no local writes'],
                ['label' => 'Checked at', 'value' => (string) ($payload['checked_at'] ?? 'n/a')],
                ['label' => 'Keyword endpoint', 'value' => $this->formatTagAnalysisEndpointStatus($keyword)],
                ['label' => 'Group endpoint', 'value' => $this->formatTagAnalysisEndpointStatus($group)],
                ! $ok ? ['label' => 'Error', 'value' => (string) (($keyword['error'] ?? null) ?: ($group['error'] ?? 'Unknown error'))] : null,
            ])),
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function formatTagAnalysisEndpointStatus(array $payload): string
    {
        return sprintf(
            '%s · HTTP %s · rows=%d · %s',
            (string) ($payload['endpoint'] ?? 'n/a'),
            (string) ($payload['http_status'] ?? 'n/a'),
            (int) ($payload['rows'] ?? 0),
            (string) ($payload['shape'] ?? 'unknown shape'),
        );
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
                    ['label' => 'Check', 'value' => 'database ping: select 1'],
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
                    ['label' => 'Check', 'value' => 'database ping: select 1'],
                    ['label' => 'Connection', 'value' => (string) config('database.default')],
                    ['label' => 'Error', 'value' => $exception->getMessage()],
                ],
            ];
        }
    }
}
