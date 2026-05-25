<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\KeywordLiveTrendReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class KeywordLiveTrendController extends Controller
{
    public function __invoke(Request $request, KeywordLiveTrendReport $report): View
    {
        return view('keywords.live-trends', $report->forRequest($request));
    }
}
