<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveChannelsReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LiveChannelsController extends Controller
{
    public function __invoke(Request $request, LiveChannelsReport $report): View
    {
        $channelReport = $report->forRequest($request);

        return view('live.channels', [
            'title' => $channelReport['title'],
            'rows' => $channelReport['rows'],
            'generatedAt' => $channelReport['generated_at'],
            'filters' => $channelReport['filters'],
            'period' => $channelReport['period'],
            'dataAvailable' => $channelReport['available'],
        ]);
    }
}
