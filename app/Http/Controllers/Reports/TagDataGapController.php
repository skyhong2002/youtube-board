<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\KeywordVideosReport;
use App\Services\Legacy\TagCloudReport;
use App\Services\Legacy\TagCommentsReport;
use App\Support\ReportLineage;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagDataGapController extends Controller
{
    public function comments(Request $request, TagCommentsReport $report, ReportLineage $lineage, ?int $tagId = null): View
    {
        return view('tags.comments', $report->forTagFilters($request, $tagId) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }

    public function cloud(Request $request, TagCloudReport $report, ReportLineage $lineage, ?int $tagId = null): View
    {
        return view('tags.cloud', $report->forTagFilters($request, $tagId) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }

    public function keywordCloud(Request $request, TagCloudReport $report, ReportLineage $lineage, string $keyword): View
    {
        return view('tags.cloud', $report->forKeyword($request, $keyword) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }

    public function keywordVideos(Request $request, KeywordVideosReport $report, ReportLineage $lineage, string $keyword): View
    {
        return view('tags.keyword-videos', $report->forKeyword($request, $keyword) + [
            'lineage' => $lineage->forRequest($request),
        ]);
    }
}
