@php
    $job = $detail['job'];
    $execution = $detail['execution'];
    $scheduledWrite = $detail['scheduled_write'];
    $atForCommand = preg_replace('/ [^ ]+$/', '', $detail['at']);
@endphp
@extends('layouts.report')

@section('title')
{{ $job['key'] }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; overflow-wrap: anywhere; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            dl { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 0; margin: 0; border: 1px solid var(--line); background: var(--surface); }
            dt, dd { margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--line); }
            dt { color: #344054; background: #eef2f6; font-weight: 700; }
            dd { min-width: 0; }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
            ul { margin: 0; padding-left: 18px; }
            li + li { margin-top: 4px; }
            .nav, .badges, .commands { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
            .badge { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .badge.planned { border-color: #f7d58b; background: var(--warn-bg); color: var(--warn); }
            .badge.active, .badge.ready, .badge.safe { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); }
            .badge.blocked, .badge.missing, .badge.risky { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.disabled { border-color: #d0d5dd; background: #f2f4f7; color: #344054; }
            .panel { border: 1px solid var(--line); background: var(--surface); padding: 14px; margin-bottom: 14px; }
            .muted { color: var(--muted); }
            .warning { border-color: #f7d58b; background: var(--warn-bg); color: var(--warn); }
            .writes { display: flex; flex-wrap: wrap; gap: 4px; }
            .writes span { display: inline-flex; padding: 2px 6px; border-radius: 5px; background: #f2f4f7; color: #344054; font-size: 12px; }
            .commands code { display: block; width: 100%; padding: 10px 12px; border: 1px solid var(--line); background: #111827; color: #f9fafb; }
            .schedule-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } dl { grid-template-columns: 1fr; } dt { border-bottom: 0; } }
</style>
@endpush

@section('content')
<div class="badges">
                    <span class="badge {{ $summary['scheduler_enabled'] ? 'active' : 'disabled' }}">{{ $summary['scheduler_enabled'] ? 'scheduler enabled' : 'scheduler disabled' }}</span>
                    <span class="badge {{ $summary['local_polling_enabled'] ? 'active' : 'disabled' }}">{{ $summary['local_polling_enabled'] ? 'local polling enabled' : 'local polling disabled' }}</span>
                    <span class="badge {{ $job['status'] }}">{{ $job['status'] }}</span>
                    <span class="badge {{ $job['command_exists'] ? 'ready' : 'missing' }}">{{ $job['command_exists'] ? 'command ready' : 'command missing' }}</span>
                    <span class="badge {{ $execution['read_only'] ? 'safe' : 'risky' }}">{{ $execution['risk_label'] }}</span>
                    <span class="badge {{ $detail['is_due_now'] ? 'active' : 'disabled' }}">{{ $detail['is_due_now'] ? 'due now' : 'not due now' }}</span>
                </div>

@if ($invalidAt !== null)
                <div class="panel warning">Invalid <code>at</code> value ignored: <code>{{ $invalidAt }}</code></div>
            @endif

            <dl>
                <dt>Modern command</dt>
                <dd><code>{{ $job['modern_command'] }}</code></dd>
                <dt>Legacy command</dt>
                <dd><code>{{ $job['legacy_command'] }}</code></dd>
                <dt>Schedule</dt>
                <dd><code>{{ $job['schedule'] }}</code><div class="muted">{{ $job['cadence'] }}</div></dd>
                <dt>Evaluation time</dt>
                <dd>{{ $detail['at'] }}</dd>
                <dt>External dependency</dt>
                <dd>{{ $job['external_dependency'] }}</dd>
                <dt>Write targets</dt>
                <dd>
                    <div class="writes">
                        @foreach ($job['writes'] as $table)
                            <span>{{ \App\Support\InlineCodeFormatter::render($table) }}</span>
                        @endforeach
                    </div>
                </dd>
                <dt>Notes</dt>
                <dd>{{ \App\Support\InlineCodeFormatter::render($job['notes']) }}</dd>
            </dl>

            <h2>Execution Guardrail</h2>
            <div class="panel">
                @if ($execution['can_execute_when_due'])
                    <p>此 job 是 read-only、active、command-ready，且 cron expression 到期時允許執行。Scheduler execution 仍需要 <code>INGESTION_SCHEDULER_ENABLED=true</code>。</p>
                @else
                    <p>此 job 目前不會執行；下面保留 guardrail 原始原因，方便對照 CLI/output。</p>
                    <ul>
                        @foreach ($execution['blocks'] as $block)
                            <li>{{ $block }}</li>
                        @endforeach
                    </ul>
                @endif
            </div>

            @if (! empty($job['scheduled_execute_command']))
                <h2>Scheduled Local Polling</h2>
                <div class="panel">
                    @if ($scheduledWrite['allowed'])
                        <p>此 job 已 allowlisted，可以由 scheduler-enabled local polling 執行。當 <code>ingestion:run --execute</code> 評估為 due 時，scheduler 會使用下方 capped command。</p>
                    @else
                        <p>Scheduler-enabled local polling is blocked for this job until every explicit gate is satisfied.</p>
                        <ul>
                            @foreach ($scheduledWrite['blocks'] as $block)
                                <li>{{ $block }}</li>
                            @endforeach
                        </ul>
                    @endif
                    <p><code>{{ $job['scheduled_execute_command'] }}</code></p>
                </div>
            @endif

            <h2>Safe Commands</h2>
            <div class="commands">
                <code>php artisan ingestion:run --job={{ $job['key'] }} --at="{{ $atForCommand }}"</code>
                <code>INGESTION_SCHEDULER_ENABLED=true php artisan ingestion:run --execute --job={{ $job['key'] }}</code>
                @if (! empty($job['scheduled_execute_command']))
                    <code>INGESTION_SCHEDULER_ENABLED=true INGESTION_LOCAL_POLLING_ENABLED=true INGESTION_SCHEDULED_WRITE_ALLOWLIST={{ $job['key'] }} php artisan ingestion:run --execute --job={{ $job['key'] }}</code>
                @endif
            </div>

            <h2>Next Runs</h2>
            <div class="schedule-grid">
                @foreach ($detail['schedule_previews'] as $preview)
                    <section class="panel">
                        <h3><code>{{ $preview['expression'] }}</code></h3>
                        @if ($preview['valid'])
                            <ul>
                                @foreach ($preview['next_runs'] as $run)
                                    <li>{{ $run }}</li>
                                @endforeach
                            </ul>
                        @else
                            <p class="muted">Invalid cron expression: {{ $preview['error'] ?? 'unknown error' }}</p>
                        @endif
                    </section>
                @endforeach
            </div>
@endsection
