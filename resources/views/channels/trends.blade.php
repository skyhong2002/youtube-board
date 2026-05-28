@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .tabs, .filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .tabs a, .filters span, .badge { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .tabs a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta, .muted { color: var(--muted); }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .panel { padding: 16px; border: 1px solid var(--line); background: var(--surface); }
            .chart { padding: 14px; border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
            svg { display: block; width: 100%; min-width: 760px; height: 260px; }
            .axis { stroke: #9aa4b2; stroke-width: 1; }
            .gridline { stroke: #e4e7ec; stroke-width: 1; }
            .line { fill: none; stroke: var(--accent); stroke-width: 3; }
            .dot { fill: var(--accent); }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); }
            table { width: 100%; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty { padding: 24px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } }
</style>
@endpush

@section('content')
@if ($channel)
                <nav class="tabs" aria-label="Legacy channel line modes">
                    <a class="{{ $mode === 'moving' ? 'active' : '' }}" href="{{ route('channels.trends', ['u_id' => $channel['u_id'], 'limit' => $filters['limit']]) }}">移動曲線</a>
                    <a class="{{ $mode === 'orig' ? 'active' : '' }}" href="{{ route('channels.trends', ['u_id' => $channel['u_id'], 'limit' => $filters['limit'], 'orig' => 1]) }}">原始資料</a>
                    <a class="{{ $mode === 'pred' ? 'active' : '' }}" href="{{ route('channels.trends', ['u_id' => $channel['u_id'], 'limit' => $filters['limit'], 'each' => 1]) }}">估計值</a>
                    <a class="{{ $mode === 'videos' ? 'active' : '' }}" href="{{ route('channels.trends', ['u_id' => $channel['u_id'], 'limit' => $filters['limit'], 'videos' => 1]) }}">影片數</a>
                </nav>
            @endif

            <div class="filters">
                <span>limit={{ $filters['limit'] }}</span>
                @if ($filters['orig'])<span>orig=1</span>@endif
                @if ($filters['each'])<span>each=1</span>@endif
                @if ($filters['videos'])<span>videos=1</span>@endif
            </div>

            <p class="muted">頻道線圖 · Legacy source: {{ $legacy_file }} · table: <code>urt_log</code></p>

            @if (! $data_available)
                <section class="panel">
                    <p class="notice">Data unavailable locally. {{ $blocked_reason ?? 'local urt_log has no rows for this channel' }}</p>
                    <p class="muted">Legacy source: {{ $legacy_file }}. Channel trend 資料會透過 Laravel channel stats polling 與 `urt_log` refresh 補齊。</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Dependency</th>
                                <th>Rows</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($dependencies as $dependency)
                                <tr>
                                    <td><code>{{ $dependency['table'] }}</code></td>
                                    <td>{{ $dependency['rows'] === null ? '-' : number_format($dependency['rows']) }}</td>
                                    <td><span class="badge {{ $dependency['status'] }}">{{ $dependency['status'] }}</span></td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </section>
            @endif

            <h2>{{ $mode_label }}</h2>
            @if ($data_available && $rows !== [])
                @php
                    $max = max(1, collect($rows)->max('value') ?? 0);
                    $count = max(1, count($rows) - 1);
                    $points = collect($rows)->map(function ($row, $index) use ($max, $count) {
                        $x = 36 + ($index / $count * 688);
                        $y = 216 - ($row['value'] / $max * 180);
                        return sprintf('%.1f,%.1f', $x, $y);
                    })->implode(' ');
                @endphp
                <div class="chart">
                    <svg viewBox="0 0 760 240" role="img" aria-label="{{ $title }} {{ $mode_label }}">
                        <line class="axis" x1="36" y1="216" x2="724" y2="216"></line>
                        <line class="axis" x1="36" y1="24" x2="36" y2="216"></line>
                        @foreach ([0.25, 0.5, 0.75, 1] as $tick)
                            <line class="gridline" x1="36" y1="{{ 216 - (180 * $tick) }}" x2="724" y2="{{ 216 - (180 * $tick) }}"></line>
                        @endforeach
                        <polyline class="line" points="{{ $points }}"></polyline>
                        @foreach ($rows as $index => $row)
                            @php
                                $x = 36 + ($index / $count * 688);
                                $y = 216 - ($row['value'] / $max * 180);
                            @endphp
                            <circle class="dot" cx="{{ $x }}" cy="{{ $y }}" r="3">
                                <title>{{ $row['date'] }} {{ number_format($row['value']) }}</title>
                            </circle>
                        @endforeach
                        <text x="36" y="232" fill="#667085" font-size="11">{{ $rows[0]['date'] }}</text>
                        <text x="724" y="232" text-anchor="end" fill="#667085" font-size="11">{{ $rows[count($rows) - 1]['date'] }}</text>
                        <text x="42" y="20" fill="#667085" font-size="11">{{ number_format($max) }}</text>
                    </svg>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            <th class="number">顯示值</th>
                            <th class="number">原始日增</th>
                            <th class="number">估計值</th>
                            <th class="number">移動曲線</th>
                            <th class="number">影片數</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($rows as $row)
                            <tr>
                                <td>{{ $row['date'] }}</td>
                                <td class="number">{{ number_format($row['value']) }}</td>
                                <td class="number">{{ number_format($row['orig']) }}</td>
                                <td class="number">{{ number_format($row['pred']) }}</td>
                                <td class="number">{{ number_format($row['moving']) }}</td>
                                <td class="number">{{ number_format($row['videos']) }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @else
                <div class="empty">沒有 `urt_log.thedata` 可顯示。</div>
            @endif
@endsection
