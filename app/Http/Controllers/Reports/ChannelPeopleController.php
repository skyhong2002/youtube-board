<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\ChannelPeopleReport;
use Illuminate\Http\Request;

class ChannelPeopleController extends Controller
{
    public function __invoke(Request $request, int $u_id, ChannelPeopleReport $report)
    {
        return view('channels.people', $report->forChannel($request, $u_id));
    }
}
