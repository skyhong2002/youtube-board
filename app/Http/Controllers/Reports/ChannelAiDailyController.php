<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelAiDailyReport;
use Illuminate\Http\Request;

class ChannelAiDailyController extends Controller
{
    public function __invoke(Request $request, int $u_id, ChannelAiDailyReport $report)
    {
        return view('channels.ai-days', $report->forChannel($request, $u_id));
    }
}
