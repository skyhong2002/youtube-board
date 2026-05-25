<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelVideosReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class ChannelVideosController extends Controller
{
    public function __invoke(Request $request, ChannelVideosReport $report, int $u_id): View
    {
        $videoReport = $report->forChannel($request, $u_id);

        return view('channels.videos', [
            'filters' => $videoReport['filters'],
            'rows' => $videoReport['rows'],
            'channel' => $videoReport['channel'],
            'uId' => $u_id,
            'dataAvailable' => $videoReport['available'],
            'generatedAt' => $videoReport['generated_at'],
            'title' => $videoReport['title'],
            'sortColumn' => $videoReport['sort_column'],
        ]);
    }
}
