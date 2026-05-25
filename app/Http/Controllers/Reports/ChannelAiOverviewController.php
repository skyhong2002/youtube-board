<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelAiOverviewReport;
use Illuminate\Contracts\View\View;

class ChannelAiOverviewController extends Controller
{
    public function __invoke(int $u_id, ChannelAiOverviewReport $report): View
    {
        return view('channels.ai-overview', $report->forChannel($u_id));
    }
}
