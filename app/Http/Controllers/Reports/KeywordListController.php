<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\KeywordListReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class KeywordListController extends Controller
{
    public function __invoke(Request $request, KeywordListReport $report): View
    {
        $keywordReport = $report->forRequest($request);

        return view('keywords.index', [
            'filters' => $keywordReport['filters'],
            'rows' => $keywordReport['rows'],
            'dataAvailable' => $keywordReport['available'],
            'generatedAt' => $keywordReport['generated_at'],
            'sort' => $keywordReport['sort'],
            'cachedMetricsAvailable' => $keywordReport['cached_metrics_available'],
        ]);
    }
}
