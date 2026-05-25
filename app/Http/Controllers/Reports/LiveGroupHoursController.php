<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveGroupHoursReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LiveGroupHoursController extends Controller
{
    public function __invoke(Request $request, LiveGroupHoursReport $report): View
    {
        return view('live.group-hours', $report->forRequest($request));
    }
}
