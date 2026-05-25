<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveDayReport;
use Illuminate\Http\Request;

class LiveDayController extends Controller
{
    public function __invoke(Request $request, LiveDayReport $report, ?string $date = null)
    {
        $data = $report->forRequest($request, $date);

        return view('live.day', [
            'rows' => $data['rows'],
            'generatedAt' => $data['generated_at'],
            'filters' => $data['filters'],
            'period' => $data['period'],
            'dataAvailable' => $data['available'],
            'pageTitle' => '單日直播排行',
            'pageMode' => 'day',
        ]);
    }
}
