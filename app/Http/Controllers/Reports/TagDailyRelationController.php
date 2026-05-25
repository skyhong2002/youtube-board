<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagDailyRelationReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagDailyRelationController extends Controller
{
    public function tagFilters(Request $request, TagDailyRelationReport $report, ?int $tagId = null): View
    {
        return view('tags.days', $report->forTagFilters($request, $tagId));
    }

    public function keyword(Request $request, TagDailyRelationReport $report, string $keyword): View
    {
        return view('tags.days', $report->forKeyword($request, $keyword));
    }
}
