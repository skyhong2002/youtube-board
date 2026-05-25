<?php

namespace App\Http\Controllers\LegacyApi;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LegacyTagChannelApiReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TagChannelApiController extends Controller
{
    public function __construct(private readonly LegacyTagChannelApiReport $report)
    {
    }

    public function tagsList(): JsonResponse
    {
        return $this->json($this->report->tagsList());
    }

    public function tagMap(): JsonResponse
    {
        return $this->json($this->report->tagMap());
    }

    public function tagsIndex(Request $request): JsonResponse
    {
        return $this->json($this->report->tagsIndex($request));
    }

    public function tagsAll(): JsonResponse
    {
        return $this->json($this->report->tagsAll());
    }

    public function videoTags(Request $request): JsonResponse
    {
        return $this->json($this->report->videoTags($request));
    }

    public function videoTagsTitle(Request $request): JsonResponse
    {
        return $this->json($this->report->videoTags($request, titleOnly: true));
    }

    public function channelsList(Request $request): JsonResponse
    {
        return $this->json($this->report->channelsList($request));
    }

    public function channelVideos(Request $request): JsonResponse
    {
        return $this->json($this->report->channelVideos($request));
    }

    public function channelsVideos(Request $request): JsonResponse
    {
        return $this->json($this->report->channelsVideos($request));
    }

    public function tagLog(Request $request): JsonResponse
    {
        return $this->json($this->report->tagLog($request));
    }

    public function tagCloud(Request $request): JsonResponse
    {
        return $this->json($this->report->tagCloud($request));
    }

    public function tagRelationDate(Request $request): JsonResponse
    {
        return $this->json($this->report->tagRelationDate($request));
    }

    public function tagMonth(Request $request): JsonResponse
    {
        return $this->json($this->report->tagMonth($request));
    }

    public function tagPeriod(Request $request): JsonResponse
    {
        return $this->json($this->report->tagPeriod($request));
    }

    public function tagTagsDays(Request $request): JsonResponse
    {
        return $this->json($this->report->tagTagsDays($request));
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function json(array $payload): JsonResponse
    {
        return response()
            ->json($payload, 200, [], JSON_UNESCAPED_UNICODE)
            ->header('Access-Control-Allow-Origin', '*')
            ->header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
            ->header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    }
}
