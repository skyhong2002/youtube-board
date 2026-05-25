<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelPromptReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class ChannelPromptController extends Controller
{
    public function __invoke(Request $request, int $u_id, ChannelPromptReport $report): View
    {
        return view('channels.prompt', $report->forChannel($request, $u_id));
    }
}
