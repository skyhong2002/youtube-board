<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\GroupDirectoryReport;
use Illuminate\Contracts\View\View;

class GroupDirectoryController extends Controller
{
    public function index(GroupDirectoryReport $report): View
    {
        return view('groups.index', $report->index());
    }

    public function show(GroupDirectoryReport $report, string $groupName): View
    {
        return view('groups.show', $report->show($groupName));
    }
}
