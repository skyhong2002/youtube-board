<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveContinuousReport;
use Illuminate\Http\Request;

class LiveContinuousController extends Controller
{
    public function __invoke(Request $request, LiveContinuousReport $report)
    {
        $data = $report->forRequest($request);

        return view('live.continuous', [
            'rows' => $data['rows'],
            'generatedAt' => $data['generated_at'],
            'filters' => $data['filters'],
            'period' => $data['period'],
            'dataAvailable' => $data['available'],
        ]);
    }
}
