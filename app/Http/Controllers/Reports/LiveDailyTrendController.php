<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveDailyTrendReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LiveDailyTrendController extends Controller
{
    public function __invoke(Request $request, LiveDailyTrendReport $report): View
    {
        $trendReport = $report->forRequest($request);

        return view('live.daily-trend', [
            'filters' => $trendReport['filters'],
            'rows' => $trendReport['rows'],
            'series' => $trendReport['series'],
            'dates' => $trendReport['dates'],
            'groups' => $trendReport['groups'],
            'types' => $trendReport['types'],
            'period' => $trendReport['period'],
            'dataAvailable' => $trendReport['available'],
            'generatedAt' => $trendReport['generated_at'],
            'title' => $trendReport['title'],
        ]);
    }
}
