<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\GroupMetricReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class GroupMetricController extends Controller
{
    public function ranking(Request $request, GroupMetricReport $report): View
    {
        return view('groups.ranking', $report->ranking($request));
    }

    public function trends(Request $request, GroupMetricReport $report): View
    {
        return view('groups.trends', $report->trend($request));
    }
}
