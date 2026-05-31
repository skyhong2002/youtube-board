<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveCurrentReport;
use App\Support\ReportLineage;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LiveCurrentController extends Controller
{
    public function __invoke(Request $request, LiveCurrentReport $report, ReportLineage $lineage): View
    {
        $liveReport = $report->forRequest($request);

        return view('live.current', [
            'filters' => $liveReport['filters'],
            'rows' => $liveReport['rows'],
            'dataAvailable' => $liveReport['available'],
            'generatedAt' => $liveReport['generated_at'],
            'lineage' => $lineage->forRequest($request),
        ]);
    }
}
