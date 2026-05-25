<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveHoursReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LiveHoursController extends Controller
{
    public function __invoke(Request $request, LiveHoursReport $report): View
    {
        $hoursReport = $report->forRequest($request);

        return view('live.hours', [
            'title' => $hoursReport['title'],
            'rows' => $hoursReport['rows'],
            'totals' => $hoursReport['totals'],
            'dates' => $hoursReport['dates'],
            'generatedAt' => $hoursReport['generated_at'],
            'filters' => $hoursReport['filters'],
            'period' => $hoursReport['period'],
            'dataAvailable' => $hoursReport['available'],
        ]);
    }
}
