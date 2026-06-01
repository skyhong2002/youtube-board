@php
    $requestMeta = $record['request'] ?? [];
    $result = $record['result'] ?? [];
    $summary = $result['summary'] ?? [];
    $jobs = $result['jobs'] ?? [];
    $quotaEstimate = $result['youtube_quota_estimate'] ?? [];
@endphp
@extends('layouts.report')

@section('title')
{{ $record['id'] ?? '擷取執行紀錄' }}
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
            .nav, .summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
            .badge { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .badge.active, .badge.executed { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); }
            .badge.failed { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.skipped, .badge.dry-run { border-color: #f7d58b; background: var(--warn-bg); color: var(--warn); }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
            dl { display: grid; grid-template-columns: minmax(150px, 220px) 1fr; gap: 0; margin: 0; border: 1px solid var(--line); background: var(--surface); }
            dt, dd { margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--line); }
            dt { color: #344054; background: #eef2f6; font-weight: 700; }
            dd { min-width: 0; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 900px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .muted { color: var(--muted); }
            .right { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } dl { grid-template-columns: 1fr; } dt { border-bottom: 0; } }
</style>
@endpush

@section('content')
<div class="summary">
                    <span class="badge {{ ($result['mode'] ?? '') === 'execute' ? 'active' : 'dry-run' }}">{{ $result['mode'] ?? '-' }}</span>
                    <span class="badge {{ ($summary['failed'] ?? 0) > 0 ? 'failed' : 'executed' }}">failed={{ number_format((int) ($summary['failed'] ?? 0)) }}</span>
                </div>

<dl>
                <dt>Created</dt>
                <dd>{{ $record['created_at'] ?? '-' }}</dd>
                <dt>Evaluation time</dt>
                <dd>{{ $result['at'] ?? ($requestMeta['at'] ?? '-') }}</dd>
                <dt>Scheduler</dt>
                <dd>{{ ($result['scheduler_enabled'] ?? false) ? 'enabled for this run' : 'disabled' }}</dd>
                <dt>Request mode</dt>
                <dd>{{ $requestMeta['mode'] ?? '-' }}</dd>
                <dt>Requested job</dt>
                <dd><code>{{ $requestMeta['job'] ?? 'all due jobs' }}</code></dd>
                <dt>Local file</dt>
                <dd><code>{{ $record['path'] ?? '-' }}</code></dd>
            </dl>

            <h2>Summary</h2>
            <div class="summary" aria-label="Run summary">
                <span class="badge">evaluated={{ number_format((int) ($summary['evaluated'] ?? 0)) }}</span>
                <span class="badge">due={{ number_format((int) ($summary['due'] ?? 0)) }}</span>
                <span class="badge executed">executed={{ number_format((int) ($summary['executed'] ?? 0)) }}</span>
                <span class="badge skipped">skipped={{ number_format((int) ($summary['skipped'] ?? 0)) }}</span>
                <span class="badge {{ ($summary['failed'] ?? 0) > 0 ? 'failed' : '' }}">failed={{ number_format((int) ($summary['failed'] ?? 0)) }}</span>
                <span class="badge">yt quota≈{{ number_format((int) ($quotaEstimate['estimated_units'] ?? 0)) }} units</span>
            </div>

            <h2>Jobs</h2>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Job</th>
                            <th>Status</th>
                            <th>Due</th>
                            <th>Action</th>
                            <th>Command</th>
                            <th>Schedule</th>
                            <th>Effective</th>
                            <th class="right">YT Units</th>
                            <th>Output / Error</th>
                            <th class="right">Exit</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($jobs as $job)
                            <tr>
                                <td>
                                    @if (isset($job['key']))
                                        <a href="{{ route('ops.ingestion.show', ['jobKey' => $job['key']]) }}"><code>{{ $job['key'] }}</code></a>
                                    @else
                                        <code>-</code>
                                    @endif
                                </td>
                                <td>{{ $job['status'] ?? '-' }}</td>
                                <td>{{ ($job['due'] ?? false) ? 'yes' : 'no' }}</td>
                                <td><span class="badge {{ ($job['failed'] ?? false) ? 'failed' : (($job['executed'] ?? false) ? 'executed' : 'skipped') }}">{{ $job['action'] ?? '-' }}</span></td>
                                <td><code>{{ $job['command'] ?? '-' }}</code></td>
                                <td><code>{{ $job['schedule'] ?? '-' }}</code></td>
                                <td><code>{{ $job['effective_command'] ?? ($job['command'] ?? '-') }}</code></td>
                                <td class="right" title="{{ $job['youtube_quota_estimate']['basis'] ?? '' }}">{{ number_format((int) ($job['estimated_youtube_quota_units'] ?? 0)) }}</td>
                                <td>
                                    @if (! empty($job['error']))
                                        <code>{{ $job['error'] }}</code>
                                    @elseif (! empty($job['output']))
                                        <code>{{ $job['output'] }}</code>
                                    @elseif (! empty($job['scheduled_write']['blocks'] ?? []))
                                        <code>{{ implode('; ', $job['scheduled_write']['blocks']) }}</code>
                                    @else
                                        <span class="muted">-</span>
                                    @endif
                                </td>
                                <td class="right">{{ $job['exit_code'] ?? '-' }}</td>
                            </tr>
                        @empty
                            <tr>
                                <td colspan="10" class="muted">No job rows were recorded for this run.</td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
