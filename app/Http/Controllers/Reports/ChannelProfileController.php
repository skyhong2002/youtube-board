<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelProfileReport;

class ChannelProfileController extends Controller
{
    public function __invoke(ChannelProfileReport $report, int $u_id)
    {
        $data = $report->forChannel($u_id);

        return view('channels.show', [
            'channel' => $data['channel'],
            'count' => $data['count'],
            'tags' => $data['tags'],
            'ai' => $data['ai'],
            'trendAvailable' => $data['trend_available'],
            'generatedAt' => $data['generated_at'],
            'dataAvailable' => $data['available'],
            'uId' => $u_id,
        ]);
    }
}
