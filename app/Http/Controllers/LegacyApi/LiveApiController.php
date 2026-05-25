<?php

namespace App\Http\Controllers\LegacyApi;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LegacyLiveApiReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class LiveApiController extends Controller
{
    public function __construct(private readonly LegacyLiveApiReport $report)
    {
    }

    public function liveDay(Request $request): JsonResponse
    {
        return response()->json($this->report->liveDay($request), 200, [], JSON_UNESCAPED_UNICODE);
    }

    public function liveDate(Request $request): JsonResponse
    {
        return response()->json($this->report->liveDate($request), 200, [], JSON_UNESCAPED_UNICODE);
    }

    public function liveHour(Request $request): JsonResponse
    {
        return response()->json($this->report->liveHour($request), 200, [], JSON_UNESCAPED_UNICODE);
    }

    public function liveTagDate(Request $request): JsonResponse
    {
        return response()->json($this->report->liveTagDate($request), 200, [], JSON_UNESCAPED_UNICODE);
    }

    public function liveDateList(Request $request): JsonResponse
    {
        return response()->json($this->report->liveDateList($request), 200, [], JSON_UNESCAPED_UNICODE);
    }

    public function liveTvbs(Request $request): JsonResponse
    {
        return response()->json($this->report->liveTvbs($request), 200, [], JSON_UNESCAPED_UNICODE);
    }

    public function videoLive(Request $request): Response
    {
        return response($this->report->videoLiveHtml($request), 200)
            ->header('Content-Type', 'text/html; charset=UTF-8');
    }

    public function csvLiveLine(Request $request): Response
    {
        $videoId = trim((string) $request->query('videoId', 'quwqlazU-c8')) ?: 'quwqlazU-c8';

        return response($this->report->liveLineCsv($request), 200)
            ->header('Content-Type', 'text/csv; charset=UTF-8')
            ->header('Content-Disposition', 'attachment;filename='.$videoId.'.csv');
    }
}
