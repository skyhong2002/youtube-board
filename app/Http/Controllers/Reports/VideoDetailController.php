<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\VideoDetailReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class VideoDetailController extends Controller
{
    public function show(Request $request, string $videoId, VideoDetailReport $report): View
    {
        return view('videos.show', $report->forVideo($request, $videoId));
    }

    public function analytics(Request $request, string $videoId, VideoDetailReport $report): View
    {
        return view('videos.analytics', $report->forVideo($request, $videoId));
    }
}
