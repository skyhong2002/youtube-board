<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagComparisonReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagComparisonController extends Controller
{
    public function __invoke(Request $request, TagComparisonReport $report): View
    {
        return view('tags.compare', $report->forRequest($request));
    }
}
