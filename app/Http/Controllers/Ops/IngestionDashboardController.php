<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use App\Services\Ingestion\IngestionHealthCheck;
use App\Services\Ingestion\IngestionJobRegistry;
use App\Services\Ingestion\IngestionRunHistory;
use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\YoutubeQuotaBudgetLedger;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Throwable;

class IngestionDashboardController extends Controller
{
    private const WORKLOADS = [
        'data-capture' => [
            'key' => 'data_capture',
            'title' => '外部資料擷取狀態',
            'description' => '追蹤會跟 YouTube Data API、comment API、tag.analysis.tw 等外部來源要資料，或支援資料擷取管線的排程工作。',
        ],
        'report-processing' => [
            'key' => 'report_processing',
            'title' => '內部報表處理狀態',
            'description' => '追蹤用本機資料重建 dashboard cache、靜態報表替代頁、AI 摘要與其他 report builder 的排程或 request-driven 工作。',
        ],
    ];

    public function __invoke(Request $request, IngestionJobRegistry $registry, IngestionRunHistory $history, IngestionHealthCheck $health, YoutubeQuotaBudgetLedger $quotaLedger): View
    {
        return view('ops.ingestion', [
            'groups' => $registry->grouped(),
            'summary' => $registry->summary(),
            'workloadSummaries' => [
                'data_capture' => $registry->workloadSummary('data_capture'),
                'report_processing' => $registry->workloadSummary('report_processing'),
            ],
            'recentRuns' => $history->latest(30),
            'externalSchedulerActivity' => $history->externalSchedulerActivity(),
            'youtubeQuotaDailyEstimate' => $history->youtubeQuotaDailyEstimate(),
            'youtubeQuotaBudgetLedger' => $quotaLedger->state(
                max(0, (int) config('ingestion.youtube_daily_quota_budget', 9000)),
            ),
            'health' => $health->check($request->query('date') ? (string) $request->query('date') : null),
            'prefillJob' => trim((string) $request->query('job', '')),
            'webExecuteAllowed' => $this->webExecuteAllowed(),
        ]);
    }

    public function dataCapture(IngestionJobRegistry $registry, IngestionRunHistory $history): View
    {
        return $this->workloadView('data-capture', $registry, $history);
    }

    public function reportProcessing(IngestionJobRegistry $registry, IngestionRunHistory $history): View
    {
        return $this->workloadView('report-processing', $registry, $history);
    }

    public function show(Request $request, IngestionJobRegistry $registry, string $jobKey): View
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $invalidAt = null;

        try {
            $at = $request->query('at') !== null
                ? CarbonImmutable::parse((string) $request->query('at'), $timezone)
                : CarbonImmutable::now($timezone);
        } catch (Throwable) {
            $invalidAt = (string) $request->query('at');
            $at = CarbonImmutable::now($timezone);
        }

        $detail = $registry->describe($jobKey, $at);

        abort_if($detail === null, 404);

        return view('ops.ingestion-job', [
            'detail' => $detail,
            'summary' => $registry->summary(),
            'invalidAt' => $invalidAt,
        ]);
    }

    public function runShow(IngestionRunHistory $history, string $runId): View
    {
        $record = $history->find($runId);

        abort_if($record === null, 404);

        return view('ops.ingestion-run', [
            'record' => $record,
        ]);
    }

    public function run(Request $request, IngestionSchedulerRunner $runner, IngestionRunHistory $history): RedirectResponse
    {
        $validated = $request->validate([
            'mode' => ['nullable', 'in:dry-run,execute'],
            'job' => ['nullable', 'string', 'max:120'],
            'at' => ['nullable', 'string', 'max:120'],
            'all' => ['nullable', 'boolean'],
        ]);

        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $invalidAt = null;

        try {
            $at = isset($validated['at']) && trim((string) $validated['at']) !== ''
                ? CarbonImmutable::parse((string) $validated['at'], $timezone)
                : CarbonImmutable::now($timezone);
        } catch (Throwable) {
            $invalidAt = (string) ($validated['at'] ?? '');
            $at = CarbonImmutable::now($timezone);
        }

        $execute = ($validated['mode'] ?? 'dry-run') === 'execute';

        abort_if($execute && ! $this->webExecuteAllowed(), 403, 'Web execute mode is restricted to local development.');

        $originalSchedulerEnabled = (bool) config('ingestion.scheduler_enabled', false);

        if ($execute) {
            config()->set('ingestion.scheduler_enabled', true);
        }

        $result = $runner->run(
            at: $at,
            execute: $execute,
            jobKey: isset($validated['job']) && trim((string) $validated['job']) !== '' ? trim((string) $validated['job']) : null,
            showAll: $request->boolean('all'),
        );

        config()->set('ingestion.scheduler_enabled', $originalSchedulerEnabled);

        $record = $history->record($result, [
            'mode' => $execute ? 'execute' : 'dry-run',
            'job' => isset($validated['job']) && trim((string) $validated['job']) !== '' ? trim((string) $validated['job']) : null,
            'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
            'show_all' => $request->boolean('all'),
            'scheduler_enabled_temporarily' => $execute,
            'original_scheduler_enabled' => $originalSchedulerEnabled,
            'invalid_at' => $invalidAt,
        ]);

        return redirect()
            ->route('ops.ingestion')
            ->with('ingestion_run_id', $record['id'])
            ->with('ingestion_run_summary', $result['summary'])
            ->with('ingestion_run_invalid_at', $invalidAt);
    }

    private function workloadView(string $slug, IngestionJobRegistry $registry, IngestionRunHistory $history): View
    {
        $workload = self::WORKLOADS[$slug];
        $groups = $registry->groupedForWorkload($workload['key'])
            ->map(fn ($jobs) => $jobs->map(fn (array $job): array => $job + [
                'execution' => $registry->executionProfile($job),
                'scheduled_write' => $registry->scheduledWriteProfile($job),
            ]));

        return view('ops.ingestion-workload', [
            'slug' => $slug,
            'workload' => $workload['key'],
            'title' => $workload['title'],
            'description' => $workload['description'],
            'groups' => $groups,
            'summary' => $registry->summary(),
            'workloadSummary' => $registry->workloadSummary($workload['key']),
            'externalSchedulerActivity' => $history->externalSchedulerActivity(),
        ]);
    }

    private function webExecuteAllowed(): bool
    {
        return in_array((string) config('app.env'), ['local', 'testing'], true);
    }
}
