<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use App\Services\Ingestion\IngestionJobRegistry;
use App\Services\Ingestion\IngestionRunHistory;
use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Throwable;

class IngestionDashboardController extends Controller
{
    public function __invoke(Request $request, IngestionJobRegistry $registry, IngestionRunHistory $history): View
    {
        return view('ops.ingestion', [
            'groups' => $registry->grouped(),
            'summary' => $registry->summary(),
            'recentRuns' => $history->latest(30),
            'externalSchedulerActivity' => $history->externalSchedulerActivity(),
            'prefillJob' => trim((string) $request->query('job', '')),
        ]);
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
}
