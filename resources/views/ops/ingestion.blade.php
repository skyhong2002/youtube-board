<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Ingestion Scheduler - YouTube Board</title>
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
            .badge.active { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); }
            .badge.blocked { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.disabled { border-color: #d0d5dd; background: #f2f4f7; color: #344054; }
            .badge.ready { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); }
            .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .meta { color: var(--muted); white-space: nowrap; }
            .panel { border: 1px solid var(--line); background: var(--surface); padding: 14px; margin-bottom: 14px; }
            .status-grid { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.4fr); gap: 14px; margin-bottom: 14px; }
            .status-grid h2 { margin-top: 0; }
            .status-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
            .reason-list { margin: 8px 0 0; padding-left: 18px; color: var(--muted); }
            form.run-form { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 1fr) minmax(180px, 1fr) auto; gap: 10px; align-items: end; }
            label { display: grid; gap: 5px; color: #344054; font-size: 12px; font-weight: 700; }
            select, input[type="text"] { width: 100%; min-height: 36px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); padding: 6px 8px; font: inherit; }
            button { min-height: 36px; border: 1px solid #0f766e; border-radius: 6px; background: #0f766e; color: #fff; padding: 7px 12px; font: inherit; font-weight: 700; cursor: pointer; }
            button:hover { background: #115e59; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1180px; border-collapse: collapse; }
            .runs table { min-width: 900px; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
            .compact { max-width: 260px; }
            .muted { color: var(--muted); }
            .detail-link { display: inline-flex; margin-top: 3px; font-size: 12px; }
            .writes { display: flex; flex-wrap: wrap; gap: 4px; }
            .writes span { display: inline-flex; padding: 2px 6px; border-radius: 5px; background: #f2f4f7; color: #344054; font-size: 12px; }
            @media (max-width: 900px) { form.run-form { grid-template-columns: 1fr; } }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('live.current') }}">直播排行</a>
                        <a href="{{ route('live.channels') }}">直播頻道排行</a>
                        <a href="{{ route('live.hours') }}">小時熱度</a>
                    </nav>
                    <h1>Ingestion Scheduler</h1>
                </div>
                <div class="meta">
                    Web request gates
                    <span class="badge {{ $summary['scheduler_enabled'] ? 'active' : 'disabled' }}">
                        {{ $summary['scheduler_enabled'] ? 'scheduler enabled' : 'scheduler disabled' }}
                    </span>
                    <span class="badge {{ $summary['local_polling_enabled'] ? 'active' : 'disabled' }}">
                        {{ $summary['local_polling_enabled'] ? 'local polling enabled' : 'local polling disabled' }}
                    </span>
                </div>
            </header>

            <section class="status-grid" aria-label="Scheduler status">
                <div class="panel">
                    <h2>Web Request Gates</h2>
                    <div class="status-line">
                        <span class="badge {{ $summary['scheduler_enabled'] ? 'active' : 'disabled' }}">
                            {{ $summary['scheduler_enabled'] ? 'scheduler enabled' : 'scheduler disabled' }}
                        </span>
                        <span class="badge {{ $summary['local_polling_enabled'] ? 'active' : 'disabled' }}">
                            {{ $summary['local_polling_enabled'] ? 'local polling enabled' : 'local polling disabled' }}
                        </span>
                        <span>scheduled write allowlist {{ count($summary['scheduled_write_allowlist']) }}</span>
                    </div>
                    <p class="muted">These gates describe this web request only. Dokploy scheduled tasks may inject separate env flags for their one-shot CLI process without enabling polling for normal web traffic.</p>
                </div>

                <div class="panel">
                    <h2>External Scheduler Activity</h2>
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
                            age={{ $externalSchedulerActivity['latest_age_seconds'] ?? '-' }}s
                            evaluated={{ $externalSummary['evaluated'] ?? 0 }}
                            due={{ $externalSummary['due'] ?? 0 }}
                            executed={{ $externalSummary['executed'] ?? 0 }}
                            skipped={{ $externalSummary['skipped'] ?? 0 }}
                            failed={{ $externalSummary['failed'] ?? 0 }}
                        </p>
                    @else
                        <p class="muted">No external <code>ingestion:run --execute --record</code> run file has been observed.</p>
                    @endif
                    @unless ($externalSchedulerActivity['active'])
                        <ul class="reason-list">
                            @foreach ($externalSchedulerActivity['not_observed_reasons'] as $reason)
                                <li>{{ $reason }}</li>
                            @endforeach
                        </ul>
                    @endunless
                </div>
            </section>

            <div class="summary" aria-label="Job summary">
                <span>{{ number_format($summary['total']) }} jobs</span>
                <span>{{ number_format($summary['planned']) }} planned</span>
                <span>{{ number_format($summary['active']) }} active</span>
                <span>{{ number_format($summary['blocked']) }} blocked</span>
                <span>{{ number_format($summary['command_ready']) }} command-ready</span>
                <span>{{ number_format($summary['command_missing']) }} command-missing</span>
                <span>timezone {{ config('ingestion.timezone') }}</span>
                <span>dry-run <code>php artisan ingestion:run</code></span>
            </div>

            @if (session('ingestion_run_summary'))
                @php($runSummary = session('ingestion_run_summary'))
                <div class="panel">
                    <strong>Run saved:</strong>
                    <code>{{ session('ingestion_run_id') }}</code>
                    <span class="muted">
                        evaluated={{ $runSummary['evaluated'] ?? 0 }}
                        due={{ $runSummary['due'] ?? 0 }}
                        executed={{ $runSummary['executed'] ?? 0 }}
                        skipped={{ $runSummary['skipped'] ?? 0 }}
                        failed={{ $runSummary['failed'] ?? 0 }}
                    </span>
                    @if (session('ingestion_run_invalid_at'))
                        <div class="muted">Invalid <code>at</code> value ignored: <code>{{ session('ingestion_run_invalid_at') }}</code></div>
                    @endif
                </div>
            @endif

            <section class="panel">
                <h2>One-shot Runner</h2>
                <form class="run-form" method="POST" action="{{ route('ops.ingestion.run') }}">
                    @csrf
                    <label>
                        Mode
                        <select name="mode">
                            <option value="dry-run">dry-run</option>
                            <option value="execute">execute read-only due jobs once</option>
                        </select>
                    </label>
                    <label>
                        Job
                        <select name="job">
                            <option value="">all due jobs</option>
                            @foreach ($groups as $jobs)
                                @foreach ($jobs as $job)
                                    <option value="{{ $job['key'] }}">{{ $job['key'] }}</option>
                                @endforeach
                            @endforeach
                        </select>
                    </label>
                    <label>
                        At
                        <input name="at" type="text" value="{{ now(config('ingestion.timezone'))->format('Y-m-d H:i:00') }}">
                    </label>
                    <button type="submit">Run Once</button>
                </form>
                <p class="muted">Execute mode temporarily enables the local runner for this request only. Local write polling still requires <code>INGESTION_LOCAL_POLLING_ENABLED=true</code>, an allowlisted job key, and each job's capped scheduled execute command.</p>
            </section>

            <section class="runs">
                <h2>Latest One-shot Runs</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Created</th>
                                <th>Mode</th>
                                <th>Job</th>
                                <th>Evaluated</th>
                                <th>Due</th>
                                <th>Executed</th>
                                <th>Skipped</th>
                                <th>Failed</th>
                                <th>File</th>
                            </tr>
                        </thead>
                        <tbody>
                            @forelse ($recentRuns as $run)
                                @php($runSummary = $run['result']['summary'] ?? [])
                                <tr>
                                    <td>{{ $run['created_at'] ?? '-' }}</td>
                                    <td>{{ $run['request']['mode'] ?? ($run['result']['mode'] ?? '-') }}</td>
                                    <td><code>{{ $run['request']['job'] ?? 'all due jobs' }}</code></td>
                                    <td>{{ $runSummary['evaluated'] ?? 0 }}</td>
                                    <td>{{ $runSummary['due'] ?? 0 }}</td>
                                    <td>{{ $runSummary['executed'] ?? 0 }}</td>
                                    <td>{{ $runSummary['skipped'] ?? 0 }}</td>
                                    <td>{{ $runSummary['failed'] ?? 0 }}</td>
                                    <td>
                                        @if (isset($run['id']))
                                            <a href="{{ route('ops.ingestion.runs.show', ['runId' => $run['id']]) }}"><code>{{ $run['path'] ?? $run['id'] }}</code></a>
                                        @else
                                            <code>{{ $run['path'] ?? '-' }}</code>
                                        @endif
                                    </td>
                                </tr>
                            @empty
                                <tr>
                                    <td colspan="9" class="muted">No local one-shot runs yet.</td>
                                </tr>
                            @endforelse
                        </tbody>
                    </table>
                </div>
            </section>

            @foreach ($groups as $group => $jobs)
                <h2>{{ $group }}</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Priority</th>
                                <th>Status</th>
                                <th>Modern command</th>
                                <th>Command state</th>
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
                                    <td><span class="badge {{ $job['status'] }}">{{ $job['status'] }}</span></td>
                                    <td class="compact">
                                        <code>{{ $job['modern_command'] }}</code>
                                        <div class="muted">{{ $job['key'] }}</div>
                                        <a class="detail-link" href="{{ route('ops.ingestion.show', ['jobKey' => $job['key']]) }}">detail / next runs</a>
                                    </td>
                                    <td><span class="badge {{ $job['command_exists'] ? 'ready' : 'missing' }}">{{ $job['command_exists'] ? 'ready' : 'missing' }}</span></td>
                                    <td class="compact"><code>{{ $job['legacy_command'] }}</code></td>
                                    <td>
                                        <code>{{ $job['schedule'] }}</code>
                                        <div class="muted">{{ $job['cadence'] }}</div>
                                    </td>
                                    <td>{{ $job['external_dependency'] }}</td>
                                    <td>
                                        <div class="writes">
                                            @foreach ($job['writes'] as $table)
                                                <span>{{ $table }}</span>
                                            @endforeach
                                        </div>
                                    </td>
                                    <td class="compact">{{ $job['notes'] }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endforeach
        </main>
    </body>
</html>
