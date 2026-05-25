<?php

namespace App\Http\Controllers\LegacyApi;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LegacyCloudGroupApiReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CloudGroupApiController extends Controller
{
    public function __construct(private readonly LegacyCloudGroupApiReport $report)
    {
    }

    public function channelCloud(Request $request): JsonResponse
    {
        return $this->json($this->report->channelCloud($request));
    }

    public function cloudTagDate(Request $request): JsonResponse
    {
        return $this->json($this->report->cloudTagDate($request));
    }

    public function cloudTagDateNoApi(Request $request): JsonResponse
    {
        return $this->json($this->report->cloudTagDate($request, noApi: true));
    }

    public function groupView(Request $request): JsonResponse
    {
        return $this->json($this->report->groupView($request));
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
