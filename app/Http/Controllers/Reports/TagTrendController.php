<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagTrendReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagTrendController extends Controller
{
    public function index(Request $request, TagTrendReport $report): View
    {
        return view('tags.trends', $report->forTagFilters($request));
    }

    public function show(Request $request, int $tagId, TagTrendReport $report): View
    {
        return view('tags.trends', $report->forTagFilters($request, $tagId));
    }
}
