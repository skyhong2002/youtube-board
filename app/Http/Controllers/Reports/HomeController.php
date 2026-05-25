<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\HomeTagIndexReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class HomeController extends Controller
{
    public function __invoke(Request $request, HomeTagIndexReport $report): View
    {
        $homeReport = $report->forRequest($request);

        return view('home', [
            'filters' => $homeReport['filters'],
            'rows' => $homeReport['rows'],
            'summary' => $homeReport['summary'],
            'dataAvailable' => $homeReport['available'],
            'generatedAt' => $homeReport['generated_at'],
            'sort' => $homeReport['sort'],
        ]);
    }
}
