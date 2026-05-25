<?php

namespace App\Services\Ingestion;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class YoutubeDataApiClient
{
    /**
     * @param  list<string>  $channelIds
     * @return array<string, array{viewCount: int, subscriberCount: int, hiddenSubscriberCount: bool, videoCount: int}>
     */
    public function channelStatistics(array $channelIds): array
    {
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

        $channelIds = collect($channelIds)
            ->map(fn (string $id): string => trim($id))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($channelIds === []) {
            return [];
        }

        $response = Http::timeout(15)->get('https://www.googleapis.com/youtube/v3/channels', [
            'part' => 'statistics',
            'id' => implode(',', $channelIds),
            'key' => $apiKey,
        ]);

        if (! $response->ok()) {
            $message = $response->json('error.message') ?? 'YouTube channels.list request failed.';

            throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
        }

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
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

        $playlistId = trim($playlistId);

        if ($playlistId === '') {
            return [];
        }

        $response = Http::timeout(15)->get('https://www.googleapis.com/youtube/v3/playlistItems', [
            'part' => 'snippet',
            'maxResults' => max(1, min(50, $maxResults)),
            'playlistId' => $playlistId,
            'key' => $apiKey,
        ]);

        if (! $response->ok()) {
            $message = $response->json('error.message') ?? 'YouTube playlistItems.list request failed.';

            throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
        }

        return collect($response->json('items', []))
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
            ->all();
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array{viewCount: int, likeCount: int, dislikeCount: int, favoriteCount: int, commentCount: int}>
     */
    public function videoStatistics(array $videoIds): array
    {
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

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

        $response = Http::timeout(15)->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'statistics',
            'id' => implode(',', $videoIds),
            'maxResults' => 50,
            'key' => $apiKey,
        ]);

        if (! $response->ok()) {
            $message = $response->json('error.message') ?? 'YouTube videos.list request failed.';

            throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
        }

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
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

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

        $response = Http::timeout(15)->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'contentDetails',
            'id' => implode(',', $videoIds),
            'maxResults' => 50,
            'key' => $apiKey,
        ]);

        if (! $response->ok()) {
            $message = $response->json('error.message') ?? 'YouTube videos.list request failed.';

            throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
        }

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
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

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

        $response = Http::timeout(15)->get('https://www.googleapis.com/youtube/v3/videos', [
            'part' => 'liveStreamingDetails',
            'id' => implode(',', $videoIds),
            'maxResults' => 50,
            'key' => $apiKey,
        ]);

        if (! $response->ok()) {
            $message = $response->json('error.message') ?? 'YouTube videos.list request failed.';

            throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
        }

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
        $apiKey = config('services.youtube.api_key');

        if (! is_string($apiKey) || trim($apiKey) === '') {
            throw new RuntimeException('YOUTUBE_API_KEY is not configured.');
        }

        $videoId = trim($videoId);

        if ($videoId === '') {
            return ['items' => [], 'nextPageToken' => null];
        }

        $query = [
            'part' => 'id,replies,snippet',
            'maxResults' => max(1, min(100, $maxResults)),
            'videoId' => $videoId,
            'key' => $apiKey,
        ];

        if (is_string($pageToken) && trim($pageToken) !== '') {
            $query['pageToken'] = trim($pageToken);
        }

        $response = Http::timeout(20)->get('https://www.googleapis.com/youtube/v3/commentThreads', $query);

        if (! $response->ok()) {
            $message = $response->json('error.message') ?? 'YouTube commentThreads.list request failed.';

            throw new RuntimeException('YouTube API error '.$response->status().': '.$message);
        }

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
}
