<?php

namespace App\Services\Integrations;

use App\Support\SensitiveTextRedactor;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class YoutubeDataApiQuotaUsage
{
    private const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read';

    private const TOKEN_URI = 'https://oauth2.googleapis.com/token';

    private const YOUTUBE_SERVICE = 'youtube.googleapis.com';

    /**
     * @return array<string, mixed>
     */
    public function snapshot(): array
    {
        $projectId = $this->projectId();
        $dailyLimit = $this->dailyLimit();

        try {
            $credentials = $this->serviceAccountCredentials();
        } catch (\Throwable $exception) {
            return [
                'ok' => false,
                'configured' => true,
                'source' => 'Cloud Monitoring serviceruntime quota/rate/net_usage',
                'daily_limit' => $dailyLimit,
                'error' => $this->safeError($exception->getMessage()),
            ];
        }

        if ($projectId === '' || $credentials === null) {
            return [
                'ok' => null,
                'configured' => false,
                'source' => 'Cloud Monitoring serviceruntime quota/rate/net_usage',
                'daily_limit' => $dailyLimit,
                'error' => 'Google Cloud Monitoring quota credentials are not configured.',
                'missing' => array_values(array_filter([
                    $projectId === '' ? 'GOOGLE_CLOUD_PROJECT_ID' : null,
                    $credentials === null ? 'GOOGLE_CLOUD_MONITORING_SERVICE_ACCOUNT_JSON_BASE64' : null,
                ])),
            ];
        }

        try {
            $token = $this->accessToken($credentials);
            $window = $this->quotaDayWindow();
            $usage = $this->rateQuotaUsage($projectId, $token, $window['start_utc'], $window['end_utc']);
            $used = (int) round($usage['used_units']);
            $percent = $dailyLimit > 0 ? ($used / $dailyLimit) * 100 : 0.0;

            return [
                'ok' => true,
                'configured' => true,
                'source' => 'Cloud Monitoring serviceruntime quota/rate/net_usage',
                'used_units' => $used,
                'daily_limit' => $dailyLimit,
                'remaining_units' => max(0, $dailyLimit - $used),
                'percent_used' => round($percent, 1),
                'warning_percent' => $this->warningPercent(),
                'window_start' => $window['start_local'],
                'window_end' => $window['end_local'],
                'window_timezone' => 'America/Los_Angeles',
                'checked_at' => now((string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei')))->format('Y-m-d H:i:s'),
                'last_sample_at' => $usage['last_sample_at'],
                'top_methods' => $usage['top_methods'],
                'series_count' => $usage['series_count'],
            ];
        } catch (\Throwable $exception) {
            return [
                'ok' => false,
                'configured' => true,
                'source' => 'Cloud Monitoring serviceruntime quota/rate/net_usage',
                'daily_limit' => $dailyLimit,
                'error' => $this->safeError($exception->getMessage()),
            ];
        }
    }

    public function isConfigured(): bool
    {
        return $this->projectId() !== '' && $this->hasServiceAccountConfiguration();
    }

    private function projectId(): string
    {
        $projectId = config('services.google_cloud.project_id');

        return is_string($projectId) ? trim($projectId) : '';
    }

    private function dailyLimit(): int
    {
        return max(1, (int) config('services.youtube.quota.daily_limit', 10000));
    }

    private function warningPercent(): float
    {
        $warningPercent = (float) config('services.youtube.quota.warning_percent', 80);

        return max(1.0, min(99.0, $warningPercent));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function serviceAccountCredentials(): ?array
    {
        $json = config('services.google_cloud.monitoring_service_account_json');
        $base64 = config('services.google_cloud.monitoring_service_account_json_base64');
        $path = config('services.google_cloud.monitoring_service_account_path');

        if (is_string($base64) && trim($base64) !== '') {
            $decoded = base64_decode(trim($base64), true);

            if ($decoded === false) {
                throw new RuntimeException('GOOGLE_CLOUD_MONITORING_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64.');
            }

            return $this->decodeCredentials($decoded);
        }

        if (is_string($json) && trim($json) !== '') {
            return $this->decodeCredentials($json);
        }

        if (is_string($path) && trim($path) !== '') {
            $path = trim($path);

            if (! is_readable($path)) {
                throw new RuntimeException('Google Cloud Monitoring service account path is not readable.');
            }

            $contents = file_get_contents($path);

            if ($contents === false) {
                throw new RuntimeException('Google Cloud Monitoring service account file could not be read.');
            }

            return $this->decodeCredentials($contents);
        }

        return null;
    }

    private function hasServiceAccountConfiguration(): bool
    {
        foreach ([
            config('services.google_cloud.monitoring_service_account_json'),
            config('services.google_cloud.monitoring_service_account_json_base64'),
            config('services.google_cloud.monitoring_service_account_path'),
        ] as $value) {
            if (is_string($value) && trim($value) !== '') {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeCredentials(string $json): array
    {
        $credentials = json_decode($json, true);

        if (! is_array($credentials)) {
            throw new RuntimeException('Google Cloud Monitoring service account JSON is invalid.');
        }

        foreach (['client_email', 'private_key'] as $required) {
            if (! isset($credentials[$required]) || ! is_string($credentials[$required]) || trim($credentials[$required]) === '') {
                throw new RuntimeException("Google Cloud Monitoring service account JSON is missing {$required}.");
            }
        }

        if (! isset($credentials['token_uri']) || ! is_string($credentials['token_uri']) || trim($credentials['token_uri']) === '') {
            $credentials['token_uri'] = self::TOKEN_URI;
        }

        return $credentials;
    }

    /**
     * @param  array<string, mixed>  $credentials
     */
    private function accessToken(array $credentials): string
    {
        $clientEmail = (string) $credentials['client_email'];
        $cacheKey = 'google_cloud_monitoring_token.'.sha1($clientEmail.'|'.$this->projectId());
        $cached = Cache::get($cacheKey);

        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $now = time();
        $assertion = $this->signedJwt([
            'alg' => 'RS256',
            'typ' => 'JWT',
        ], [
            'iss' => $clientEmail,
            'scope' => self::MONITORING_SCOPE,
            'aud' => (string) $credentials['token_uri'],
            'iat' => $now,
            'exp' => $now + 3600,
        ], (string) $credentials['private_key']);

        $response = Http::asForm()
            ->timeout(10)
            ->post((string) $credentials['token_uri'], [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $assertion,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException('Google OAuth token request failed with HTTP '.$response->status().'.');
        }

        $token = $response->json('access_token');

        if (! is_string($token) || $token === '') {
            throw new RuntimeException('Google OAuth token response did not include an access token.');
        }

        $expiresIn = max(60, (int) $response->json('expires_in', 3600) - 300);
        Cache::put($cacheKey, $token, now()->addSeconds($expiresIn));

        return $token;
    }

    /**
     * @param  array<string, mixed>  $header
     * @param  array<string, mixed>  $claims
     */
    private function signedJwt(array $header, array $claims, string $privateKey): string
    {
        $unsigned = $this->base64Url(json_encode($header, JSON_THROW_ON_ERROR))
            .'.'
            .$this->base64Url(json_encode($claims, JSON_THROW_ON_ERROR));

        $signature = '';

        if (! openssl_sign($unsigned, $signature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Google Cloud Monitoring service account private key could not sign JWT.');
        }

        return $unsigned.'.'.$this->base64Url($signature);
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    /**
     * @return array{start_utc: string, end_utc: string, start_local: string, end_local: string}
     */
    private function quotaDayWindow(): array
    {
        $end = Carbon::now('America/Los_Angeles');
        $start = $end->copy()->startOfDay();

        return [
            'start_utc' => $start->copy()->utc()->toRfc3339String(),
            'end_utc' => $end->copy()->utc()->toRfc3339String(),
            'start_local' => $start->format('Y-m-d H:i:s T'),
            'end_local' => $end->format('Y-m-d H:i:s T'),
        ];
    }

    /**
     * @return array{used_units: float, last_sample_at: string, top_methods: list<array{method: string, quota_metric: string, units: int}>, series_count: int}
     */
    private function rateQuotaUsage(string $projectId, string $token, string $startUtc, string $endUtc): array
    {
        $url = 'https://monitoring.googleapis.com/v3/projects/'.rawurlencode($projectId).'/timeSeries';
        $pageToken = null;
        $usedUnits = 0.0;
        $seriesCount = 0;
        $lastSampleAt = null;
        $methodBreakdown = [];

        do {
            $query = [
                'filter' => 'metric.type="serviceruntime.googleapis.com/quota/rate/net_usage" resource.type="consumer_quota" resource.labels.service="'.self::YOUTUBE_SERVICE.'"',
                'interval.startTime' => $startUtc,
                'interval.endTime' => $endUtc,
                'view' => 'FULL',
                'pageSize' => 10000,
            ];

            if (is_string($pageToken) && $pageToken !== '') {
                $query['pageToken'] = $pageToken;
            }

            $response = Http::withToken($token)
                ->timeout(10)
                ->get($url, $query);

            if (! $response->successful()) {
                throw new RuntimeException('Cloud Monitoring quota request failed with HTTP '.$response->status().'.');
            }

            $payload = $response->json();
            $timeSeries = is_array($payload['timeSeries'] ?? null) ? $payload['timeSeries'] : [];
            $seriesCount += count($timeSeries);

            foreach ($timeSeries as $series) {
                if (! is_array($series)) {
                    continue;
                }

                $labels = is_array($series['metric']['labels'] ?? null) ? $series['metric']['labels'] : [];
                $method = isset($labels['method']) && is_string($labels['method']) && $labels['method'] !== ''
                    ? $labels['method']
                    : 'unknown method';
                $quotaMetric = isset($labels['quota_metric']) && is_string($labels['quota_metric']) && $labels['quota_metric'] !== ''
                    ? $labels['quota_metric']
                    : 'unknown quota metric';
                $breakdownKey = $method.'|'.$quotaMetric;

                foreach (is_array($series['points'] ?? null) ? $series['points'] : [] as $point) {
                    if (! is_array($point)) {
                        continue;
                    }

                    $value = $this->pointValue($point);
                    $usedUnits += $value;
                    $methodBreakdown[$breakdownKey] ??= [
                        'method' => $method,
                        'quota_metric' => $quotaMetric,
                        'units' => 0.0,
                    ];
                    $methodBreakdown[$breakdownKey]['units'] += $value;

                    $pointEnd = $point['interval']['endTime'] ?? null;

                    if (is_string($pointEnd) && ($lastSampleAt === null || strcmp($pointEnd, $lastSampleAt) > 0)) {
                        $lastSampleAt = $pointEnd;
                    }
                }
            }

            $pageToken = isset($payload['nextPageToken']) && is_string($payload['nextPageToken'])
                ? $payload['nextPageToken']
                : null;
        } while (is_string($pageToken) && $pageToken !== '');

        $topMethods = array_values($methodBreakdown);
        usort($topMethods, fn (array $a, array $b): int => $b['units'] <=> $a['units']);

        return [
            'used_units' => $usedUnits,
            'last_sample_at' => $lastSampleAt ?? 'no samples in current quota day',
            'top_methods' => array_map(
                fn (array $row): array => [
                    'method' => (string) $row['method'],
                    'quota_metric' => (string) $row['quota_metric'],
                    'units' => (int) round((float) $row['units']),
                ],
                array_slice($topMethods, 0, 6),
            ),
            'series_count' => $seriesCount,
        ];
    }

    /**
     * @param  array<string, mixed>  $point
     */
    private function pointValue(array $point): float
    {
        $value = $point['value']['int64Value'] ?? $point['value']['doubleValue'] ?? 0;

        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }

        if (is_string($value) && is_numeric($value)) {
            return (float) $value;
        }

        return 0.0;
    }

    private function safeError(string $message): string
    {
        return SensitiveTextRedactor::redact($message, 180);
    }
}
