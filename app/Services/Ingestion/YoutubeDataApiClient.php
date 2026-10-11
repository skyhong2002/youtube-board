<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Throwable;

class YoutubeDataApiClient
{
    public function __construct(
        private readonly IngestionTelemetry $telemetry,
        private readonly YoutubeApiCredentials $credentials,
        private readonly YoutubeQuotaReservationContext $quotaContext,
        private readonly YoutubeQuotaBudgetLedger $quotaLedger,
    ) {}

    /**
     * Which of the requested channel ids exist on YouTube right now. Uses
     * part=id so statistics validation cannot hide an existing channel, which
     * matters when deciding whether a channel may be retired.
     *
     * @param  list<string>  $channelIds
     * @return list<string>
     */
    public function channelPresence(array $channelIds): array
    {
        $channelIds = collect($channelIds)
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->take(50)
            ->values()
            ->all();

        if ($channelIds === []) {
            return [];
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/channels', [
            'part' => 'id',
            'id' => implode(',', $channelIds),
            'maxResults' => 50,
        ], 15, 'YouTube channels.list request failed.');

        $this->throwIfFailed($response, 'YouTube channels.list request failed.');

        return collect($response->json('items', []))
            ->map(fn (mixed $item): string => is_array($item) && is_string($item['id'] ?? null) ? trim($item['id']) : '')
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $channelIds
     * @return array<string, array{viewCount: int, subscriberCount: int|null, hiddenSubscriberCount: bool, videoCount: int}>
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
            'maxResults' => 50,
        ], 15, 'YouTube channels.list request failed.');

        $this->throwIfFailed($response, 'YouTube channels.list request failed.');

        return collect($response->json('items', []))
            ->mapWithKeys(function (mixed $item): array {
                if (! is_array($item)) {
                    return [];
                }

                $id = isset($item['id']) && is_string($item['id']) ? trim($item['id']) : '';
                $statistics = $item['statistics'] ?? null;

                if ($id === '' || ! is_array($statistics)) {
                    return [];
                }

                $viewCount = $this->unsignedInteger($statistics['viewCount'] ?? null);
                $videoCount = $this->unsignedInteger($statistics['videoCount'] ?? null);
                $hiddenSubscriberCount = $statistics['hiddenSubscriberCount'] ?? false;

                if ($viewCount === null || $videoCount === null || ! is_bool($hiddenSubscriberCount)) {
                    return [];
                }

                $subscriberCount = array_key_exists('subscriberCount', $statistics)
                    ? $this->unsignedInteger($statistics['subscriberCount'])
                    : null;

                if ($subscriberCount === null && ! $hiddenSubscriberCount) {
                    return [];
                }

                return [
                    $id => [
                        'viewCount' => $viewCount,
                        'subscriberCount' => $subscriberCount,
                        'hiddenSubscriberCount' => $hiddenSubscriberCount,
                        'videoCount' => $videoCount,
                    ],
                ];
            })
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

        $rawItems = $response->json('items');

        if (! is_array($rawItems) || ! array_is_list($rawItems)) {
            throw new RuntimeException('YouTube playlistItems.list response items are not a list.');
        }

        $items = collect($rawItems)
            ->map(function (mixed $item): array {
                if (! is_array($item)) {
                    throw new RuntimeException('YouTube playlistItems.list returned a malformed item.');
                }

                $itemId = isset($item['id']) && is_string($item['id']) ? trim($item['id']) : '';
                $snippet = $item['snippet'] ?? [];

                if (! is_array($snippet)) {
                    throw new RuntimeException('YouTube playlistItems.list returned a malformed item snippet.');
                }

                $thumbnails = is_array($snippet['thumbnails'] ?? null) ? $snippet['thumbnails'] : [];
                $thumbnail = collect(['default', 'medium', 'high'])
                    ->map(fn (string $size): mixed => is_array($thumbnails[$size] ?? null)
                        ? ($thumbnails[$size]['url'] ?? null)
                        : null)
                    ->first(fn (mixed $url): bool => is_string($url) && trim($url) !== '');
                $videoId = trim((string) ($snippet['resourceId']['videoId'] ?? ''));
                $publishedAt = isset($snippet['publishedAt']) ? trim((string) $snippet['publishedAt']) : '';
                $channelId = isset($snippet['channelId']) && is_string($snippet['channelId']) ? trim($snippet['channelId']) : '';
                $title = isset($snippet['title']) && is_string($snippet['title']) ? trim($snippet['title']) : '';
                $channelTitle = isset($snippet['channelTitle']) && is_string($snippet['channelTitle']) ? trim($snippet['channelTitle']) : '';
                $snippetPlaylistId = isset($snippet['playlistId']) && is_string($snippet['playlistId']) ? trim($snippet['playlistId']) : '';
                $position = $this->unsignedInteger($snippet['position'] ?? null);
                $liveBroadcastContent = 'none';

                if (array_key_exists('liveBroadcastContent', $snippet)) {
                    $liveBroadcastContent = is_string($snippet['liveBroadcastContent'])
                        ? trim($snippet['liveBroadcastContent'])
                        : '';
                }

                if (
                    $itemId === ''
                    || $videoId === ''
                    || ! $this->isRfc3339DateTime($publishedAt)
                    || $channelId === ''
                    || $title === ''
                    || $channelTitle === ''
                    || $snippetPlaylistId === ''
                    || ! array_key_exists('description', $snippet)
                    || ! is_string($snippet['description'])
                    || ! is_string($thumbnail)
                    || $position === null
                    || ! in_array($liveBroadcastContent, ['live', 'none', 'upcoming'], true)
                ) {
                    throw new RuntimeException('YouTube playlistItems.list returned an item with incomplete metadata.');
                }

                return [
                    'id' => $itemId,
                    'publishedAt' => $publishedAt,
                    'channelId' => $channelId,
                    'title' => $title,
                    'description' => $snippet['description'],
                    'thumbnails' => $thumbnail,
                    'channelTitle' => $channelTitle,
                    'playlistId' => $snippetPlaylistId,
                    'position' => $position,
                    'videoId' => $videoId,
                    'liveBroadcastContent' => $liveBroadcastContent,
                ];
            })
            ->values()
            ->all();
        $nextPageToken = $response->json('nextPageToken');

        if ($nextPageToken !== null && ! is_string($nextPageToken)) {
            throw new RuntimeException('YouTube playlistItems.list returned an invalid nextPageToken.');
        }

        return [
            'items' => $items,
            'nextPageToken' => is_string($nextPageToken) && trim($nextPageToken) !== '' ? $nextPageToken : null,
        ];
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array{viewCount: int, likeCount: int|null, dislikeCount: int, favoriteCount: int|null, commentCount: int|null}>
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
            ->mapWithKeys(function (mixed $item): array {
                if (! is_array($item)) {
                    return [];
                }

                $id = isset($item['id']) && is_string($item['id']) ? trim($item['id']) : '';
                $statistics = $item['statistics'] ?? null;

                if ($id === '' || ! is_array($statistics)) {
                    return [];
                }

                $viewCount = $this->unsignedInteger($statistics['viewCount'] ?? null);

                if ($viewCount === null) {
                    return [];
                }

                $counts = ['viewCount' => $viewCount];

                foreach (['likeCount', 'favoriteCount', 'commentCount'] as $key) {
                    if (! array_key_exists($key, $statistics)) {
                        $counts[$key] = null;

                        continue;
                    }

                    $counts[$key] = $this->unsignedInteger($statistics[$key]);

                    if ($counts[$key] === null) {
                        return [];
                    }
                }

                $dislikeCount = array_key_exists('dislikeCount', $statistics)
                    ? $this->unsignedInteger($statistics['dislikeCount'])
                    : 0;

                if ($dislikeCount === null) {
                    return [];
                }

                $counts['dislikeCount'] = $dislikeCount;

                return [
                    $id => $counts,
                ];
            })
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

        // An id absent from this map (including a response item without any
        // usable live detail) identifies a video that is not a live stream or
        // no longer exists. A present id mapped to null carries live keys with
        // malformed values, so callers keep that row due instead of retiring
        // it like a deleted video.
        return collect($response->json('items', []))
            ->mapWithKeys(function (mixed $item): array {
                if (! is_array($item)) {
                    return [];
                }

                $id = isset($item['id']) && is_string($item['id']) ? trim($item['id']) : '';

                if ($id === '') {
                    return [];
                }

                $details = $item['liveStreamingDetails'] ?? null;

                if (! is_array($details)) {
                    return [];
                }

                $hasUsableKey = false;

                foreach (['actualStartTime', 'actualEndTime', 'scheduledStartTime', 'concurrentViewers', 'activeLiveChatId'] as $key) {
                    if (array_key_exists($key, $details)) {
                        $hasUsableKey = true;
                        break;
                    }
                }

                if (! $hasUsableKey) {
                    return [];
                }

                if (array_key_exists('concurrentViewers', $details)) {
                    if ($this->unsignedInteger($details['concurrentViewers']) === null) {
                        return [$id => null];
                    }
                }

                foreach (['actualStartTime', 'actualEndTime', 'scheduledStartTime'] as $key) {
                    if (array_key_exists($key, $details) && ! $this->isRfc3339DateTime($details[$key])) {
                        return [$id => null];
                    }
                }

                if (
                    array_key_exists('activeLiveChatId', $details)
                    && (! is_string($details['activeLiveChatId']) || trim($details['activeLiveChatId']) === '')
                ) {
                    return [$id => null];
                }

                return [$id => $details];
            })
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

    /**
     * @return array{items: list<array<string, mixed>>, nextPageToken: string|null}
     */
    public function comments(string $parentId, ?string $pageToken = null, int $maxResults = 100): array
    {
        $parentId = trim($parentId);

        if ($parentId === '') {
            return ['items' => [], 'nextPageToken' => null];
        }

        $query = [
            'part' => 'id,snippet',
            'maxResults' => max(1, min(100, $maxResults)),
            'parentId' => $parentId,
        ];

        if (is_string($pageToken) && trim($pageToken) !== '') {
            $query['pageToken'] = trim($pageToken);
        }

        $response = $this->get('https://www.googleapis.com/youtube/v3/comments', $query, 20, 'YouTube comments.list request failed.');
        $this->throwIfFailed($response, 'YouTube comments.list request failed.');

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

    private function unsignedInteger(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value >= 0 ? $value : null;
        }

        if (! is_string($value) || preg_match('/^\d+$/D', $value) !== 1) {
            return null;
        }

        $integer = filter_var($value, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 0],
        ]);

        return $integer === false ? null : $integer;
    }

    private function isRfc3339DateTime(mixed $value): bool
    {
        if (
            ! is_string($value)
            || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/D', $value) !== 1
        ) {
            return false;
        }

        try {
            new \DateTimeImmutable($value);
            $errors = \DateTimeImmutable::getLastErrors();

            return $errors === false
                || ((int) ($errors['warning_count'] ?? 0) === 0
                    && (int) ($errors['error_count'] ?? 0) === 0);
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * @param  array<string, mixed>  $query
     */
    private function get(string $url, array $query, int $timeout, string $fallbackMessage): Response
    {
        $responses = [];
        $keyPoolFailureReason = null;
        $dailyQuotaExhaustedKeys = 0;
        $method = $this->method($url, $query);
        $attempt = 0;
        $transientRetries = max(0, min(3, (int) config('services.youtube.transient_retries', 1)));
        $retryDelayMs = max(0, min(5000, (int) config('services.youtube.retry_delay_ms', 250)));

        foreach ($this->apiKeys() as $apiKey) {
            for ($transientAttempt = 0; $transientAttempt <= $transientRetries; $transientAttempt++) {
                $this->quotaContext->assertRequestWithinQuotaWindow($timeout);
                $attempt++;
                $started = hrtime(true);

                try {
                    $response = Http::timeout($timeout)->get($url, $query + ['key' => $apiKey]);
                } catch (Throwable $exception) {
                    $retryTransient = $transientAttempt < $transientRetries;
                    $this->telemetry->recordYoutubeRequest($this->requestTelemetry(
                        url: $url,
                        query: $query,
                        method: $method,
                        attempt: $attempt,
                        latencyMs: $this->elapsedMs($started),
                        ok: false,
                        status: null,
                        quotaRetry: false,
                        apiKeyFallback: false,
                        transientRetry: $retryTransient,
                        error: $this->sanitizedError($exception->getMessage()),
                    ));

                    if ($retryTransient) {
                        $this->retryDelay($retryDelayMs);

                        continue;
                    }

                    throw new RuntimeException(
                        $fallbackMessage.' '.$this->sanitizedError($exception->getMessage()),
                    );
                }

                $responses[] = $response;
                $quotaRetry = $this->isQuotaOrRateLimitFailure($response);
                $apiKeyFallback = $quotaRetry || $this->isAuthenticationFailure($response);
                $transientRetry = ! $apiKeyFallback
                    && $this->isTransientFailure($response)
                    && $transientAttempt < $transientRetries;

                $this->telemetry->recordYoutubeRequest($this->requestTelemetry(
                    url: $url,
                    query: $query,
                    method: $method,
                    attempt: $attempt,
                    latencyMs: $this->elapsedMs($started),
                    ok: $response->ok(),
                    status: $response->status(),
                    quotaRetry: $quotaRetry,
                    apiKeyFallback: $apiKeyFallback,
                    transientRetry: $transientRetry,
                    error: $response->ok() ? null : $this->responseError($response, $fallbackMessage),
                ));

                if ($response->ok()) {
                    return $response;
                }

                if ($apiKeyFallback) {
                    $dailyQuotaExhaustedKeys += $this->isDailyQuotaExhausted($response) ? 1 : 0;
                    $keyPoolFailureReason = $quotaRetry
                        ? YoutubeApiKeyPoolExhaustedException::QUOTA_FAILURE
                        : YoutubeApiKeyPoolExhaustedException::AUTHENTICATION_FAILURE;
                    break;
                }

                if ($transientRetry) {
                    $this->retryDelay($retryDelayMs);

                    continue;
                }

                return $response;
            }
        }

        if ($keyPoolFailureReason !== null) {
            if ($dailyQuotaExhaustedKeys === count($this->apiKeys())) {
                $this->quotaLedger->markGoogleExhausted();
            }

            throw new YoutubeApiKeyPoolExhaustedException($keyPoolFailureReason);
        }

        return $responses[array_key_last($responses)] ?? throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
    }

    private function throwIfFailed(Response $response, string $fallbackMessage): void
    {
        if ($response->ok()) {
            return;
        }

        $message = $this->sanitizedError((string) ($response->json('error.message') ?? $fallbackMessage));

        throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
    }

    /**
     * @return list<string>
     */
    private function apiKeys(): array
    {
        $keys = $this->credentials->keys();

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
            || str_contains(strtolower($reason), 'dailylimit')
            || str_contains(strtolower($message), 'quota')
            || str_contains(strtolower($message), 'rate')
            || str_contains(strtolower($message), 'daily limit');
    }

    /**
     * Daily project quota, as opposed to per-minute rate limits that clear on their own.
     */
    private function isDailyQuotaExhausted(Response $response): bool
    {
        if ($response->status() !== 403) {
            return false;
        }

        $reason = (string) ($response->json('error.errors.0.reason') ?? '');

        return in_array($reason, ['quotaExceeded', 'dailyLimitExceeded'], true);
    }

    private function isTransientFailure(Response $response): bool
    {
        return in_array($response->status(), [500, 502, 503, 504], true);
    }

    private function isAuthenticationFailure(Response $response): bool
    {
        if ($response->status() === 401) {
            return true;
        }

        if (! in_array($response->status(), [400, 403], true)) {
            return false;
        }

        $reason = preg_replace(
            '/[^a-z0-9]+/',
            '',
            strtolower((string) ($response->json('error.errors.0.reason') ?? '')),
        ) ?? '';
        $message = strtolower((string) ($response->json('error.message') ?? ''));

        return collect([
            'keyinvalid',
            'keyexpired',
            'keynotfound',
            'keyrevoked',
            'accessnotconfigured',
            'iprefererblocked',
            'autherror',
        ])->contains(fn (string $needle): bool => str_contains($reason, $needle))
            || collect([
                'api key not valid',
                'invalid api key',
                'api key expired',
                'api key has expired',
                'api key not found',
                'api key was revoked',
                'api key has been revoked',
                'authentication credential',
                'access not configured',
            ])->contains(fn (string $needle): bool => str_contains($message, $needle));
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
        bool $apiKeyFallback,
        bool $transientRetry,
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
            'api_key_fallback' => $apiKeyFallback,
            'transient_retry' => $transientRetry,
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
            str_ends_with($path, '/comments') => 'comments.list',
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

    private function retryDelay(int $milliseconds): void
    {
        if ($milliseconds > 0) {
            usleep($milliseconds * 1000);
        }
    }

    private function responseError(Response $response, string $fallbackMessage): string
    {
        $message = $response->json('error.message') ?? $fallbackMessage;

        return $this->sanitizedError((string) $message);
    }

    private function sanitizedError(string $message): string
    {
        return SensitiveTextRedactor::redact($message, 240);
    }
}
