<?php

namespace App\Http\Controllers\LegacyApi;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LegacyChannelReportApiReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ChannelReportApiController extends Controller
{
    public function __construct(private readonly LegacyChannelReportApiReport $report)
    {
    }

    public function channelLog(Request $request): JsonResponse
    {
        return $this->json($this->report->channelLog($request));
    }

    public function channelPrediction(Request $request): JsonResponse
    {
        return $this->json($this->report->channelPrediction($request));
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
