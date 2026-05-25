<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagLiveVideosReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class TagLiveVideosController extends Controller
{
    public function __invoke(Request $request, TagLiveVideosReport $report, int $tagId = 0): View
    {
        $liveReport = $report->forTag($request, $tagId);

        return view('tags.live-videos', [
            'filters' => $liveReport['filters'],
            'rows' => $liveReport['rows'],
            'tag' => $liveReport['tag'],
            'period' => $liveReport['period'],
            'dataAvailable' => $liveReport['available'],
            'generatedAt' => $liveReport['generated_at'],
            'title' => $liveReport['title'],
        ]);
    }
}
