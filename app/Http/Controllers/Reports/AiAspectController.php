<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiAspectReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class AiAspectController extends Controller
{
    public function __invoke(Request $request, AiAspectReport $report): View
    {
        return view('ai.aspects', $report->forRequest($request));
    }
}
