<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveTagReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LiveTagController extends Controller
{
    public function __invoke(Request $request, LiveTagReport $report): View
    {
        return view('live.tags', $report->forRequest($request));
    }
}
