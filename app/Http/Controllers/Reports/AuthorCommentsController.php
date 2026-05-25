<?php

namespace App\Http\Controllers\Reports;

use App\Http\Controllers\Controller;
use App\Services\Legacy\AuthorCommentsReport;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class AuthorCommentsController extends Controller
{
    public function __invoke(Request $request, string $authorKey, AuthorCommentsReport $report): View
    {
        return view('comments.author', $report->forAuthor($request, $authorKey));
    }
}
