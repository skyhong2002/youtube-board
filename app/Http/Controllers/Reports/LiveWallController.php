<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\LiveWallReport;
use Illuminate\Http\Request;

class LiveWallController extends Controller
{
    public function __invoke(Request $request, string $variant, LiveWallReport $report)
    {
        return view('live.wall', $report->forVariant($request, $variant));
    }
}
