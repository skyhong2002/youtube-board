<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\HomeTagIndexReport;
use App\Services\Legacy\KeywordListReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class HomeController extends Controller
{
    public function __invoke(Request $request, HomeTagIndexReport $report, KeywordListReport $keywordReport): View
    {
        if ($request->routeIs('home')) {
            $categoryReport = $report->forRequest($request->duplicate([
                'sort' => 'total',
                'limit' => 8,
                'min' => 10,
            ]));
            $keywords = $keywordReport->forRequest($request->duplicate([
                'sort' => 'weight',
                'limit' => 8,
            ]));

            return view('home-dashboard', [
                'categoryRows' => $categoryReport['rows'],
                'categorySummary' => $categoryReport['summary'],
                'categoriesAvailable' => $categoryReport['available'],
                'categoryGeneratedAt' => $categoryReport['generated_at'],
                'keywordRows' => $keywords['rows'],
                'keywordsAvailable' => $keywords['available'],
                'keywordGeneratedAt' => $keywords['generated_at'],
                'cachedMetricsAvailable' => $keywords['cached_metrics_available'],
            ]);
        }

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
