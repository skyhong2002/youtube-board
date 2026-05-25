<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AiEventReport;
use Illuminate\Http\Request;

class AiEventController extends Controller
{
    public function __invoke(Request $request, int $id, AiEventReport $report)
    {
        return view('ai.event', $report->forRequest($request, $id));
    }

    public function people(Request $request, int $id, AiEventReport $report)
    {
        return view('ai.event-people', $report->forRequest($request, $id, 'people'));
    }

    public function wall(Request $request, int $id, AiEventReport $report)
    {
        return view('ai.event-wall', $report->forRequest($request, $id, 'wall'));
    }
}
