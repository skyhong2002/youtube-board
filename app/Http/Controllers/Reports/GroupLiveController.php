<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\GroupLiveReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class GroupLiveController extends Controller
{
    public function __invoke(Request $request, GroupLiveReport $report): View
    {
        return view('groups.live', $report->forRequest($request));
    }
}
