<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\TagChannelRankingReport;
use Illuminate\Http\Request;

class TagChannelRankingController extends Controller
{
    public function __invoke(Request $request, TagChannelRankingReport $report, int $tagId)
    {
        $data = $report->forTag($request, $tagId);

        return view('tags.channels', [
            'rows' => $data['rows'],
            'tag' => $data['tag'],
            'filters' => $data['filters'],
            'generatedAt' => $data['generated_at'],
            'sortColumn' => $data['sort_column'],
            'dataAvailable' => $data['available'],
        ]);
    }
}
