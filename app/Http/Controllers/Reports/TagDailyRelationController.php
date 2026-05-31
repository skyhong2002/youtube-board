<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagDailyRelationReport;
use App\Support\ReportLineage;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagDailyRelationController extends Controller
{
    public function tagFilters(Request $request, TagDailyRelationReport $report, ReportLineage $lineage, ?int $tagId = null): View
    {
        return view('tags.days', $report->forTagFilters($request, $tagId) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }

    public function keyword(Request $request, TagDailyRelationReport $report, ReportLineage $lineage, string $keyword): View
    {
        return view('tags.days', $report->forKeyword($request, $keyword) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }
}
