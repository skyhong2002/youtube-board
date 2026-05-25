<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiHourlyReport;
use Illuminate\Http\Request;

class AiHourlyController extends Controller
{
    public function __invoke(Request $request, AiHourlyReport $report)
    {
        return view('ai.hours', $report->forRequest($request));
    }
}
