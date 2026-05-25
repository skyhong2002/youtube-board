<?php

namespace App\Http\Controllers\LegacyApi;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LegacyAiApiReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiApiController extends Controller
{
    public function __construct(private readonly LegacyAiApiReport $report)
    {
    }

    public function aiDay(Request $request): JsonResponse
    {
        return $this->json($this->report->aiDay($request));
    }

    public function topic(Request $request): JsonResponse
    {
        return $this->json($this->report->topic($request));
    }

    public function event(Request $request): JsonResponse
    {
        return $this->json($this->report->event($request));
    }

    public function comment(Request $request): JsonResponse
    {
        return $this->json($this->report->comment($request));
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
