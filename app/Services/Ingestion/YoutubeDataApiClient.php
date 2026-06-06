<?php

namespace App\Services\Ingestion;

use Illuminate\Support\Facades\Http;
use Illuminate\Http\Client\Response;
use RuntimeException;
use Throwable;

class YoutubeDataApiClient
{
    public function __construct(private readonly IngestionTelemetry $telemetry)
    {
    }

    /**
     * @param  list<string>  $channelIds
     * @return array<string, array{viewCount: int, subscriberCount: int, hiddenSubscriberCount: bool, videoCount: int}>
     */
    public function channelStatistics(array $channelIds): array
    {
        $channelIds = collect($channelIds)
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($channelIds === []) {
            return [];
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/channels', [
            'part' => 'statistics',
            'id' => implode(',', $channelIds),
        ], 15, 'YouTube channels.list request failed.');

        $this->throwIfFailed($response, 'YouTube channels.list request failed.');

        return collect($response->json('items', []))
            ->mapWithKeys(function (array $item): array {
                $statistics = $item['statistics'] ?? [];

                return [
                    (string) ($item['id'] ?? '') => [
                        'viewCount' => (int) ($statistics['viewCount'] ?? 0),
                        'subscriberCount' => (int) ($statistics['subscriberCount'] ?? 0),
                        'hiddenSubscriberCount' => (bool) ($statistics['hiddenSubscriberCount'] ?? false),
                        'videoCount' => (int) ($statistics['videoCount'] ?? 0),
                    ],
                ];
            })
            ->filter(fn (array $statistics, string $id): bool => $id !== '')
            ->all();
    }

    /**
     * @return list<array{
     *     id: string,
     *     publishedAt: string|null,
     *     channelId: string,
     *     title: string,
     *     description: string,
     *     thumbnails: string,
     *     channelTitle: string,
     *     playlistId: string,
     *     position: int,
     *     videoId: string,
     *     liveBroadcastContent: string
     * }>
     */
    public function playlistItems(string $playlistId, int $maxResults = 50): array
    {
        return $this->playlistItemsPage($playlistId, null, $maxResults)['items'];
    }

    /**
     * @return array{items: list<array{
     *     id: string,
     *     publishedAt: string|null,
     *     channelId: string,
     *     title: string,
     *     description: string,
     *     thumbnails: string,
     *     channelTitle: string,
     *     playlistId: string,
     *     position: int,
     *     videoId: string,
     *     liveBroadcastContent: string
     * }>, nextPageToken: string|null}
     */
    public function playlistItemsPage(string $playlistId, ?string $pageToken = null, int $maxResults = 50): array
    {
        $playlistId = trim($playlistId);

        if ($playlistId === '') {
            return ['items' => [], 'nextPageToken' => null];
        }

        $query = [
            'part' => 'snippet',
            'maxResults' => max(1, min(50, $maxResults)),
            'playlistId' => $playlistId,
        ];

        if (is_string($pageToken) && trim($pageToken) !== '') {
            $query['pageToken'] = trim($pageToken);
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/playlistItems', [
            ...$query,
        ], 15, 'YouTube playlistItems.list request failed.');

        $this->throwIfFailed($response, 'YouTube playlistItems.list request failed.');

        return [
            'items' => collect($response->json('items', []))
                ->map(function (array $item): array {
                    $snippet = $item['snippet'] ?? [];
                    $thumbnail = $snippet['thumbnails']['default']['url']
                        ?? $snippet['thumbnails']['medium']['url']
                        ?? $snippet['thumbnails']['high']['url']
                        ?? '';

                    return [
                        'id' => (string) ($item['id'] ?? ''),
                        'publishedAt' => isset($snippet['publishedAt']) ? (string) $snippet['publishedAt'] : null,
                        'channelId' => (string) ($snippet['channelId'] ?? ''),
                        'title' => (string) ($snippet['title'] ?? ''),
                        'description' => (string) ($snippet['description'] ?? ''),
                        'thumbnails' => (string) $thumbnail,
                        'channelTitle' => (string) ($snippet['channelTitle'] ?? ''),
                        'playlistId' => (string) ($snippet['playlistId'] ?? ''),
                        'position' => (int) ($snippet['position'] ?? 0),
                        'videoId' => (string) ($snippet['resourceId']['videoId'] ?? ''),
                        'liveBroadcastContent' => (string) ($snippet['liveBroadcastContent'] ?? ''),
                    ];
                })
                ->filter(fn (array $item): bool => $item['videoId'] !== '' && $item['publishedAt'] !== null)
                ->values()
                ->all(),
            'nextPageToken' => is_string($response->json('nextPageToken')) ? $response->json('nextPageToken') : null,
        ];
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array{viewCount: int, likeCount: int, dislikeCount: int, favoriteCount: int, commentCount: int}>
     */
    public function videoStatistics(array $videoIds): array
    {
        $videoIds = collect($videoIds)
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->take(50)
            ->values()
            ->all();

        if ($videoIds === []) {
            return [];
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'statistics',
            'id' => implode(',', $videoIds),
            'maxResults' => 50,
        ], 15, 'YouTube videos.list request failed.');

        $this->throwIfFailed($response, 'YouTube videos.list request failed.');

        return collect($response->json('items', []))
            ->mapWithKeys(function (array $item): array {
                $statistics = $item['statistics'] ?? [];

                return [
                    (string) ($item['id'] ?? '') => [
                        'viewCount' => (int) ($statistics['viewCount'] ?? 0),
                        'likeCount' => (int) ($statistics['likeCount'] ?? 0),
                        'dislikeCount' => (int) ($statistics['dislikeCount'] ?? 0),
                        'favoriteCount' => (int) ($statistics['favoriteCount'] ?? 0),
                        'commentCount' => (int) ($statistics['commentCount'] ?? 0),
                    ],
                ];
            })
            ->filter(fn (array $statistics, string $id): bool => $id !== '')
            ->all();
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array{duration: string|null, durationSeconds: int|null, caption: string|null}>
     */
    public function videoContentDetails(array $videoIds): array
    {
        $videoIds = collect($videoIds)
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->take(50)
            ->values()
            ->all();

        if ($videoIds === []) {
            return [];
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'contentDetails',
            'id' => implode(',', $videoIds),
            'maxResults' => 50,
        ], 15, 'YouTube videos.list request failed.');

        $this->throwIfFailed($response, 'YouTube videos.list request failed.');

        return collect($response->json('items', []))
            ->mapWithKeys(function (array $item): array {
                $details = $item['contentDetails'] ?? [];
                $duration = isset($details['duration']) ? (string) $details['duration'] : null;

                return [
                    (string) ($item['id'] ?? '') => [
                        'duration' => $duration,
                        'durationSeconds' => $duration !== null ? $this->iso8601DurationToSeconds($duration) : null,
                        'caption' => isset($details['caption']) ? (string) $details['caption'] : null,
                    ],
                ];
            })
            ->filter(fn (array $details, string $id): bool => $id !== '')
            ->all();
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array<string, mixed>>
     */
    public function videoLiveStreamingDetails(array $videoIds): array
    {
        $videoIds = collect($videoIds)
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->take(50)
            ->values()
            ->all();

        if ($videoIds === []) {
            return [];
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'liveStreamingDetails',
            'id' => implode(',', $videoIds),
            'maxResults' => 50,
        ], 15, 'YouTube videos.list request failed.');

        $this->throwIfFailed($response, 'YouTube videos.list request failed.');

        return collect($response->json('items', []))
            ->mapWithKeys(function (array $item): array {
                $details = $item['liveStreamingDetails'] ?? [];

                return [(string) ($item['id'] ?? '') => is_array($details) ? $details : []];
            })
            ->filter(fn (array $details, string $id): bool => $id !== '')
            ->all();
    }

    /**
     * @return array{items: list<array<string, mixed>>, nextPageToken: string|null}
     */
    public function commentThreads(string $videoId, ?string $pageToken = null, int $maxResults = 100): array
    {
        $videoId = trim($videoId);

        if ($videoId === '') {
            return ['items' => [], 'nextPageToken' => null];
        }

        $query = [
            'part' => 'id,replies,snippet',
            'maxResults' => max(1, min(100, $maxResults)),
            'videoId' => $videoId,
        ];

        if (is_string($pageToken) && trim($pageToken) !== '') {
            $query['pageToken'] = trim($pageToken);
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/commentThreads', $query, 20, 'YouTube commentThreads.list request failed.');

        $this->throwIfFailed($response, 'YouTube commentThreads.list request failed.');

        return [
            'items' => collect($response->json('items', []))
                ->filter(fn (mixed $item): bool => is_array($item))
                ->values()
                ->all(),
            'nextPageToken' => is_string($response->json('nextPageToken')) ? $response->json('nextPageToken') : null,
        ];
    }

    private function iso8601DurationToSeconds(string $duration): int
    {
        if (! preg_match('/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/', $duration, $matches)) {
            throw new RuntimeException('Unsupported ISO 8601 duration returned by YouTube.');
        }

        return ((int) ($matches[1] ?? 0) * 7 * 86400)
            + ((int) ($matches[2] ?? 0) * 86400)
            + ((int) ($matches[3] ?? 0) * 3600)
            + ((int) ($matches[4] ?? 0) * 60)
            + (int) ($matches[5] ?? 0);
    }

    /**
     * @param  array<string, mixed>  $query
     */
    private function get(string $url, array $query, int $timeout, string $fallbackMessage): Response
    {
        $responses = [];
        $method = $this->method($url, $query);
        $attempt = 0;

        foreach ($this->apiKeys() as $apiKey) {
            $attempt++;
            $started = hrtime(true);

            try {
                $response = Http::timeout($timeout)->get($url, $query + ['key' => $apiKey]);
            } catch (Throwable $exception) {
                $this->telemetry->recordYoutubeRequest($this->requestTelemetry(
                    url: $url,
                    query: $query,
                    method: $method,
                    attempt: $attempt,
                    latencyMs: $this->elapsedMs($started),
                    ok: false,
                    status: null,
                    quotaRetry: false,
                    error: $this->sanitizedError($exception->getMessage()),
                ));

                throw $exception;
            }

            $responses[] = $response;
            $quotaRetry = $this->isQuotaOrRateLimitFailure($response);

            $this->telemetry->recordYoutubeRequest($this->requestTelemetry(
                url: $url,
                query: $query,
                method: $method,
                attempt: $attempt,
                latencyMs: $this->elapsedMs($started),
                ok: $response->ok(),
                status: $response->status(),
                quotaRetry: $quotaRetry,
                error: $response->ok() ? null : $this->responseError($response, $fallbackMessage),
            ));

            if ($response->ok() || ! $quotaRetry) {
                return $response;
            }
        }

        return $responses[array_key_last($responses)] ?? throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
    }

    private function throwIfFailed(Response $response, string $fallbackMessage): void
    {
        if ($response->ok()) {
            return;
        }

        $message = $response->json('error.message') ?? $fallbackMessage;

        throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
    }

    /**
     * @return list<string>
     */
    private function apiKeys(): array
    {
        $keys = collect([
            config('services.youtube.api_key'),
            ...explode(',', (string) config('services.youtube.api_keys', '')),
        ])
            ->map(fn (mixed $key): string => trim((string) $key))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($keys === []) {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

        return $keys;
    }

    private function isQuotaOrRateLimitFailure(Response $response): bool
    {
        if (! in_array($response->status(), [403, 429], true)) {
            return false;
        }

        $reason = (string) ($response->json('error.errors.0.reason') ?? '');
        $message = (string) ($response->json('error.message') ?? '');

        return str_contains(strtolower($reason), 'quota')
            || str_contains(strtolower($reason), 'rate')
            || str_contains(strtolower($message), 'quota')
            || str_contains(strtolower($message), 'rate');
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>
     */
    private function requestTelemetry(
        string $url,
        array $query,
        string $method,
        int $attempt,
        int $latencyMs,
        bool $ok,
        ?int $status,
        bool $quotaRetry,
        ?string $error,
    ): array {
        return [
            'api' => 'youtube_data_api_v3',
            'method' => $method,
            'path' => (string) parse_url($url, PHP_URL_PATH),
            'part' => is_string($query['part'] ?? null) ? $query['part'] : null,
            'resource_count' => $this->resourceCount($query),
            'max_results' => isset($query['maxResults']) ? (int) $query['maxResults'] : null,
            'page_token_present' => isset($query['pageToken']),
            'api_key_attempt' => $attempt,
            'estimated_quota_units' => 1,
            'latency_ms' => $latencyMs,
            'status' => $status,
            'ok' => $ok,
            'quota_or_rate_limit_retry' => $quotaRetry,
            'error' => $error,
            'secrets' => 'not_printed',
        ];
    }

    /**
     * @param  array<string, mixed>  $query
     */
    private function method(string $url, array $query): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);

        return match (true) {
            str_ends_with($path, '/channels') => 'channels.list',
            str_ends_with($path, '/playlistItems') => 'playlistItems.list',
            str_ends_with($path, '/commentThreads') => 'commentThreads.list',
            str_ends_with($path, '/videos') => 'videos.list'.(isset($query['part']) ? '('.$query['part'].')' : ''),
            default => 'youtube_data_api',
        };
    }

    /**
     * @param  array<string, mixed>  $query
     */
    private function resourceCount(array $query): int
    {
        if (is_string($query['id'] ?? null)) {
            return collect(explode(',', $query['id']))
                ->map(fn (string $id): string => trim($id))
                ->filter()
                ->count();
        }

        if (is_string($query['videoId'] ?? null) || is_string($query['playlistId'] ?? null)) {
            return 1;
        }

        return 0;
    }

    private function elapsedMs(int $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }

    private function responseError(Response $response, string $fallbackMessage): string
    {
        $message = $response->json('error.message') ?? $fallbackMessage;

        return $this->sanitizedError((string) $message);
    }

    private function sanitizedError(string $message): string
    {
        return mb_strimwidth(
            preg_replace('/(api[_-]?key|password|secret|token|authorization)[^,\s]*/i', '$1=<redacted>', $message) ?? $message,
            0,
            240,
            '...',
            'UTF-8',
        );
    }
}
