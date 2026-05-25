<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelCloudReport;
use App\Services\Legacy\ChannelCommentsReport;
use App\Services\Legacy\ChannelTrendsReport;
use Illuminate\Http\Request;

class ChannelDataGapController extends Controller
{
    public function comments(Request $request, int $u_id, ChannelCommentsReport $report)
    {
        return view('channels.comments', $report->forChannel($request, $u_id));
    }

    public function cloud(Request $request, int $u_id, ChannelCloudReport $report)
    {
        return view('channels.cloud', $report->forChannel($request, $u_id));
    }

    public function trends(Request $request, int $u_id, ChannelTrendsReport $report)
    {
        return view('channels.trends', $report->forChannel($request, $u_id));
    }
}
