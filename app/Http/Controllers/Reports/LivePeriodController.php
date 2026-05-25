<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveDayReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LivePeriodController extends Controller
{
    public function __invoke(Request $request, LiveDayReport $report): View
    {
        $data = $report->forRequest($request);

        return view('live.day', [
            'rows' => $data['rows'],
            'generatedAt' => $data['generated_at'],
            'filters' => $data['filters'],
            'period' => $data['period'],
            'dataAvailable' => $data['available'],
            'pageTitle' => '期間直播排行',
            'pageMode' => 'period',
        ]);
    }
}
