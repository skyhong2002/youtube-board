<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiDailyReport;
use Illuminate\Http\Request;

class AiDailyController extends Controller
{
    public function __invoke(Request $request, AiDailyReport $report)
    {
        return view('ai.days', $report->forRequest($request));
    }
}
