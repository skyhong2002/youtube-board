<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\MayorReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class MayorReportController extends Controller
{
    public function index(Request $request, MayorReport $report): View
    {
        return view('mayor.show', $report->report($request, 'taipei'));
    }

    public function show(Request $request, MayorReport $report, string $city): View
    {
        return view('mayor.show', $report->report($request, $city));
    }
}
