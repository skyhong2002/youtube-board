@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $period['type_name'] }} · {{ $period['from'] }} - {{ $period['to'] }} · {{ $generatedAt }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .switcher { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .switcher { gap: 8px; margin-bottom: 14px; }
            .switcher a { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .switcher .divider { display: inline-flex; align-items: center; color: var(--muted); min-height: 30px; padding: 0 2px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .chart { border: 1px solid var(--line); background: var(--surface); padding: 12px; overflow-x: auto; }
            svg { display: block; min-width: 900px; width: 100%; height: auto; }
            .legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 10px 0 0; color: var(--muted); font-size: 12px; }
            .legend-item { display: inline-flex; align-items: center; gap: 6px; }
            .swatch { width: 16px; height: 3px; border-radius: 2px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 760px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $colors = ['#0f766e', '#b42318', '#175cd3', '#93370d', '#7a2e8e', '#475467', '#0086c9', '#027a48', '#c11574', '#b54708'];
                $chartWidth = 980;
                $chartHeight = 320;
                $padLeft = 58;
                $padRight = 18;
                $padTop = 18;
                $padBottom = 48;
                $plotWidth = $chartWidth - $padLeft - $padRight;
                $plotHeight = $chartHeight - $padTop - $padBottom;
                $maxValue = max(1, collect($series)->flatMap(fn ($row) => $row['values'])->max() ?? 1);
                $xFor = fn (int $index): float => $padLeft + ($plotWidth * ($index / max(1, count($dates) - 1)));
                $yFor = fn (int|float $value): float => $padTop + $plotHeight - ($plotHeight * ($value / $maxValue));
                $query = request()->query();
                $periodQuery = $query;
                unset($periodQuery['days'], $periodQuery['from'], $periodQuery['to']);
                $groupQuery = $query;
                unset($groupQuery['group']);
                $typeQuery = $query;
                unset($typeQuery['type']);
            @endphp



            <nav class="switcher" aria-label="日期範圍">
                @foreach ([7 => '一週', 10 => '十天', 30 => '一個月', 90 => '一季'] as $days => $label)
                    <a class="{{ (int) ($period['days'] ?? 0) === $days ? 'active' : '' }}" href="{{ route('live.trends.daily', $periodQuery + ['days' => $days, 'type' => $period['type'], 'group' => $period['group']]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="指標和群組">
                @foreach ($types as $typeKey => $typeName)
                    <a class="{{ $period['type'] === $typeKey ? 'active' : '' }}" href="{{ route('live.trends.daily', $typeQuery + ['type' => $typeKey, 'group' => $period['group'], 'days' => request()->query('days', 7)]) }}">{{ $typeName }}</a>
                @endforeach
                <span class="divider">群組</span>
                @foreach ($groups as $groupKey => $groupName)
                    <a class="{{ $period['group'] === $groupKey ? 'active' : '' }}" href="{{ route('live.trends.daily', $groupQuery + ['group' => $groupKey, 'type' => $period['type'], 'days' => request()->query('days', 7)]) }}">{{ $groupName }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ is_array($value) ? implode(',', $value) : $value }}</li>
                    @endforeach
                </ul>
            @endif

            @if ($series !== [] && $dates !== [])
                <section class="chart" aria-label="每日直播線上人數圖表">
                    <svg viewBox="0 0 {{ $chartWidth }} {{ $chartHeight }}" role="img" aria-label="{{ $title }}">
                        <line x1="{{ $padLeft }}" y1="{{ $padTop }}" x2="{{ $padLeft }}" y2="{{ $padTop + $plotHeight }}" stroke="#d7dde6" />
                        <line x1="{{ $padLeft }}" y1="{{ $padTop + $plotHeight }}" x2="{{ $padLeft + $plotWidth }}" y2="{{ $padTop + $plotHeight }}" stroke="#d7dde6" />
                        @for ($tick = 0; $tick <= 4; $tick++)
                            @php
                                $value = $maxValue * $tick / 4;
                                $y = $yFor($value);
                            @endphp
                            <line x1="{{ $padLeft }}" y1="{{ $y }}" x2="{{ $padLeft + $plotWidth }}" y2="{{ $y }}" stroke="#eef2f6" />
                            <text x="8" y="{{ $y + 4 }}" fill="#667085" font-size="11">{{ number_format($value) }}</text>
                        @endfor
                        @foreach ($dates as $index => $date)
                            @if ($index === 0 || $index === count($dates) - 1 || $index % max(1, (int) floor(count($dates) / 6)) === 0)
                                <text x="{{ $xFor($index) }}" y="{{ $chartHeight - 16 }}" fill="#667085" font-size="11" text-anchor="middle">{{ substr($date, 5) }}</text>
                            @endif
                        @endforeach
                        @foreach ($series as $seriesIndex => $row)
                            @php
                                $points = collect($row['values'])
                                    ->map(fn ($value, $index) => $xFor($index).','.$yFor((int) $value))
                                    ->implode(' ');
                            @endphp
                            <polyline points="{{ $points }}" fill="none" stroke="{{ $colors[$seriesIndex % count($colors)] }}" stroke-width="2.4" />
                        @endforeach
                    </svg>
                    <div class="legend">
                        @foreach ($series as $seriesIndex => $row)
                            <span class="legend-item"><span class="swatch" style="background: {{ $colors[$seriesIndex % count($colors)] }}"></span>{{ $row['name'] }}</span>
                        @endforeach
                    </div>
                </section>
            @else
                <div class="empty">{{ $dataAvailable ? '目前沒有符合條件的直播趨勢資料。' : '本機尚未匯入 legacy live log tables。' }}<br><x-ingestion-portal job="reports.live.build" /></div>
            @endif

            <h2>期間合計</h2>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>媒體名</th>
                            <th>影片數</th>
                            <th>觀看數</th>
                            <th>每部觀看</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <th>{{ $row['name'] }}</th>
                                <td class="number">{{ number_format($row['count']) }}</td>
                                <td class="number">{{ number_format($row['total_views']) }}</td>
                                <td class="number">{{ $row['views_per_video'] !== null ? number_format($row['views_per_video'], 1) : '-' }}</td>
                            </tr>
                        @empty
                            <tr><td class="empty" colspan="4">目前沒有可彙總的資料。</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
