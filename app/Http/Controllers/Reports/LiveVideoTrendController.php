<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveVideoTrendReport;
use Illuminate\Http\Request;

class LiveVideoTrendController extends Controller
{
    public function __invoke(Request $request, LiveVideoTrendReport $report, string $videoId)
    {
        $data = $report->forVideo($request, $videoId);

        return view('live.video-trend', [
            'video' => $data['video'],
            'hourly' => $data['hourly'],
            'daily' => $data['daily'],
            'generatedAt' => $data['generated_at'],
            'dataAvailable' => $data['available'],
            'limit' => $data['limit'],
            'videoId' => $videoId,
        ]);
    }
}
