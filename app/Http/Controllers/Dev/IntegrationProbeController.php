<?php

namespace App\Http\Controllers\Dev;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
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
        [$payload, $status] = $this->youtubePayload();

        return response()->view('dev.youtube-check', [
            'payload' => $payload,
        ], $status);
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
}
