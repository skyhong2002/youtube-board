<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\KeywordVideosReport;
use App\Services\Legacy\TagCloudReport;
use App\Services\Legacy\TagCommentsReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagDataGapController extends Controller
{
    public function comments(Request $request, TagCommentsReport $report, ?int $tagId = null): View
    {
        return view('tags.comments', $report->forTagFilters($request, $tagId));
    }

    public function cloud(Request $request, TagCloudReport $report, ?int $tagId = null): View
    {
        return view('tags.cloud', $report->forTagFilters($request, $tagId));
    }

    public function keywordCloud(Request $request, TagCloudReport $report, string $keyword): View
    {
        return view('tags.cloud', $report->forKeyword($request, $keyword));
    }

    public function keywordVideos(Request $request, KeywordVideosReport $report, string $keyword): View
    {
        return view('tags.keyword-videos', $report->forKeyword($request, $keyword));
    }
}
