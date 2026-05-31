<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiDailyReport;
use App\Support\ReportLineage;
use Illuminate\Http\Request;

class AiDailyController extends Controller
{
    public function __invoke(Request $request, AiDailyReport $report, ReportLineage $lineage)
    {
        return view('ai.days', $report->forRequest($request) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }
}
