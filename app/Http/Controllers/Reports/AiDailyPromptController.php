<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiDailyPromptReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class AiDailyPromptController extends Controller
{
    public function __invoke(Request $request, AiDailyPromptReport $report): View
    {
        return view('ai.day-prompt', $report->forRequest($request));
    }
}
