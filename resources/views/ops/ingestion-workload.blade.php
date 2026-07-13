@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $description }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1440px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 26px 0 10px; font-size: 18px; }
            .nav, .summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .summary span, .badge { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .badge.planned { border-color: #f7d58b; background: var(--warn-bg); color: var(--warn); }
            .badge.active, .badge.ready, .badge.allowed { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); }
            .badge.blocked, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.disabled { border-color: #d0d5dd; background: #f2f4f7; color: #344054; }
            .meta { color: var(--muted); white-space: nowrap; }
            .panel { min-width: 0; border: 1px solid var(--line); background: var(--surface); padding: 14px; margin-bottom: 14px; }
            .status-grid { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.4fr); gap: 14px; margin-bottom: 14px; }
            .status-grid h2 { margin-top: 0; }
            .status-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
            .reason-list { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1180px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
            .compact { max-width: 280px; }
            .muted { color: var(--muted); }
            .detail-link { display: inline-flex; margin-top: 3px; font-size: 12px; }
            .writes { display: flex; flex-wrap: wrap; gap: 4px; }
            .writes span { display: inline-flex; padding: 2px 6px; border-radius: 5px; background: #f2f4f7; color: #344054; font-size: 12px; }
            @media (max-width: 900px) { .status-grid { grid-template-columns: 1fr; } }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php($scheduledWriteScope = $summary['scheduled_write_scope'] ?? 'allowlist')
<div class="nav" aria-label="Ingestion workload navigation">
                <a href="{{ route('ops.ingestion') }}">全部排程</a>
                <a href="{{ route('ops.ingestion.data-capture') }}">外部資料擷取</a>
                <a href="{{ route('ops.ingestion.report-processing') }}">內部報表處理</a>
            </div>

            <section class="status-grid" aria-label="Workload status">
                <div class="panel">
                    <h2>{{ $workloadSummary['label'] }}</h2>
                    <div class="status-line">
                        <span>{{ number_format($workloadSummary['total']) }} jobs</span>
                        <span>{{ number_format($workloadSummary['active']) }} active</span>
                        <span>{{ number_format($workloadSummary['command_ready']) }} command-ready</span>
                    </div>
                    <div class="status-line">
                        <span>{{ number_format($workloadSummary['scheduled_execute']) }} 排程可執行</span>
                        <span>{{ number_format($workloadSummary['scheduled_preview']) }} 排程預覽 / request 渲染</span>
                        <span>{{ number_format($workloadSummary['request_only']) }} 使用者請求才執行</span>
                    </div>
                    <p class="muted">{{ $description }}</p>
                </div>

                <div class="panel">
                    <h2>Runtime Gates</h2>
                    <div class="status-line">
                        <span class="badge {{ $summary['scheduler_enabled'] ? 'active' : 'disabled' }}">
                            {{ $summary['scheduler_enabled'] ? 'scheduler enabled' : 'scheduler disabled' }}
                        </span>
                        <span class="badge {{ $summary['local_polling_enabled'] ? 'active' : 'disabled' }}">
                            {{ $summary['local_polling_enabled'] ? 'local polling enabled' : 'local polling disabled' }}
                        </span>
                        <span>{{ number_format($workloadSummary['scheduled_allowed']) }} scheduled allowed</span>
                        <span>{{ number_format($workloadSummary['scheduled_blocked']) }} scheduled blocked</span>
                    </div>
                    <div class="status-line">
                        <span class="badge {{ $externalSchedulerActivity['active'] ? 'active' : 'disabled' }}">
                            {{ $externalSchedulerActivity['active'] ? 'external scheduler active' : 'external scheduler not observed' }}
                        </span>
                        <span>window {{ $externalSchedulerActivity['window_minutes'] }} minutes</span>
                    </div>
                    @if ($externalSchedulerActivity['latest'])
                        @php($externalSummary = $externalSchedulerActivity['summary'])
                        <p class="muted">
                            latest={{ $externalSchedulerActivity['latest_created_at'] ?? '-' }}
                            executed={{ $externalSummary['executed'] ?? 0 }}
                            failed={{ $externalSummary['failed'] ?? 0 }}
                        </p>
                    @else
                        <ul class="reason-list">
                            @foreach ($externalSchedulerActivity['not_observed_reasons'] as $reason)
                                <li>{{ $reason }}</li>
                            @endforeach
                        </ul>
                    @endif
                </div>
            </section>

            <div class="summary" aria-label="Global ingestion summary">
                <span>global {{ number_format($summary['total']) }} jobs</span>
                @if ($scheduledWriteScope === 'all')
                    <span>all scheduled writes enabled</span>
                @elseif ($scheduledWriteScope === 'off')
                    <span>scheduled writes off</span>
                @else
                    <span>allowlist {{ count($summary['scheduled_write_allowlist']) }}</span>
                @endif
                <span>timezone {{ config('ingestion.timezone') }}</span>
                <span>dry-run <code>php artisan ingestion:run</code></span>
            </div>

            @foreach ($groups as $group => $jobs)
                <h2>{{ $group }}</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Priority</th>
                                <th>Status</th>
                                <th>Trigger</th>
                                <th>Modern command</th>
                                <th>Scheduled status</th>
                                <th>Legacy command</th>
                                <th>Schedule</th>
                                <th>Dependency</th>
                                <th>Writes</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($jobs as $job)
                                <tr>
                                    <td>{{ $job['priority'] }}</td>
                                    <td>
                                        <span class="badge {{ $job['status'] }}">{{ $job['status'] }}</span>
                                        <span class="badge {{ $job['command_exists'] ? 'ready' : 'missing' }}">{{ $job['command_exists'] ? 'ready' : 'missing' }}</span>
                                    </td>
                                    <td>{{ $job['trigger_label'] }}</td>
                                    <td class="compact">
                                        <code>{{ $job['modern_command'] }}</code>
                                        <div class="muted">{{ $job['key'] }}</div>
                                        <a class="detail-link" href="{{ route('ops.ingestion.show', ['jobKey' => $job['key']]) }}">detail / next runs</a>
                                    </td>
                                    <td>
                                        @if (! empty($job['scheduled_execute_command']))
                                            <span class="badge {{ $job['scheduled_write']['allowed'] ? 'allowed' : 'blocked' }}">{{ $job['scheduled_write']['allowed'] ? 'allowed' : 'blocked' }}</span>
                                            <div class="muted"><code>{{ $job['scheduled_execute_command'] }}</code></div>
                                            @unless ($job['scheduled_write']['allowed'])
                                                <div class="muted">{{ $job['scheduled_write']['blocks'][0] ?? 'blocked by scheduled polling gates' }}</div>
                                            @endunless
                                        @elseif ($job['execution']['can_execute_when_due'])
                                            <span class="badge ready">preview ready</span>
                                        @else
                                            <span class="badge disabled">request gated</span>
                                        @endif
                                    </td>
                                    <td class="compact"><code>{{ $job['legacy_command'] }}</code></td>
                                    <td>
                                        <code>{{ $job['schedule'] }}</code>
                                        <div class="muted">{{ $job['cadence'] }}</div>
                                    </td>
                                    <td>{{ $job['external_dependency'] }}</td>
                                    <td>
                                        <div class="writes">
                                            @foreach ($job['writes'] as $table)
                                                <span>{{ \App\Support\InlineCodeFormatter::render($table) }}</span>
                                            @endforeach
                                        </div>
                                    </td>
                                    <td class="compact">{{ \App\Support\InlineCodeFormatter::render($job['notes']) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endforeach
@endsection
