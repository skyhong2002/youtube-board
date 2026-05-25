<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\KeywordGroupTrendReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class KeywordGroupTrendController extends Controller
{
    public function __invoke(Request $request, KeywordGroupTrendReport $report): View
    {
        return view('keywords.group-trends', $report->forRequest($request));
    }
}
