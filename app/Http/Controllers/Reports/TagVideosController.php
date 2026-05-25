<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagVideosReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagVideosController extends Controller
{
    public function __invoke(Request $request, TagVideosReport $report, int $tagId = 0): View
    {
        $videoReport = $report->forTag($request, $tagId);

        return view('tags.videos', [
            'filters' => $videoReport['filters'],
            'rows' => $videoReport['rows'],
            'tag' => $videoReport['tag'],
            'dataAvailable' => $videoReport['available'],
            'generatedAt' => $videoReport['generated_at'],
            'title' => $videoReport['title'],
            'sortColumn' => $videoReport['sort_column'],
        ]);
    }
}
