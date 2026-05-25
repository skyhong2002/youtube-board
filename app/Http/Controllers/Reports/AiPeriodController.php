<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiPeriodReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class AiPeriodController extends Controller
{
    public function __invoke(Request $request, AiPeriodReport $report): View
    {
        return view('ai.periods', $report->forRequest($request));
    }
}
