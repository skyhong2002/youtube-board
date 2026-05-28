@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $type_name }} · {{ $range['from'] }} - {{ $range['to'] }} · cache rows {{ number_format($cache_rows) }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .switcher { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .switcher { gap: 8px; margin-bottom: 14px; }
            .switcher a, .filters li { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .chart { border: 1px solid var(--line); background: var(--surface); padding: 12px; overflow-x: auto; }
            svg { display: block; min-width: 860px; width: 100%; height: auto; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 760px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty, .notice { padding: 24px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            .notice { margin: 0 0 14px; padding: 12px; border-color: #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); text-align: left; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $chartWidth = 940;
                $chartHeight = 300;
                $padLeft = 58;
                $padRight = 18;
                $padTop = 18;
                $padBottom = 46;
                $plotWidth = $chartWidth - $padLeft - $padRight;
                $plotHeight = $chartHeight - $padTop - $padBottom;
                $values = collect($series)->pluck('value')->filter(fn ($value) => $value !== null)->values();
                $maxValue = max(1, (float) ($values->max() ?? 1));
                $xFor = fn (int $index): float => $padLeft + ($plotWidth * ($index / max(1, count($series) - 1)));
                $yFor = fn (int|float $value): float => $padTop + $plotHeight - ($plotHeight * ($value / $maxValue));
                $query = request()->query();
                $periodQuery = $query;
                unset($periodQuery['days'], $periodQuery['from'], $periodQuery['to']);
                $typeQuery = $query;
                unset($typeQuery['type']);
                $routeParams = request()->route('tagId') ? ['tagId' => request()->route('tagId')] : [];
                $routeName = request()->route('tagId') ? 'tags.trends' : 'tags.trends.index';
            @endphp



            <nav class="switcher" aria-label="日期範圍">
                @foreach ([7 => '一週', 10 => '十天', 30 => '一個月', 60 => '兩個月', 90 => '一季'] as $days => $label)
                    <a class="{{ (string) $range['days'] === (string) $days ? 'active' : '' }}" href="{{ route($routeName, $routeParams + $periodQuery + ['days' => $days, 'type' => $type]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="指標">
                @foreach ($types as $typeKey => $label)
                    <a class="{{ $type === $typeKey ? 'active' : '' }}" href="{{ route($routeName, $routeParams + $typeQuery + ['type' => $typeKey, 'days' => $range['days']]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_show_tag_date` cache table。<br><x-ingestion-portal job="reports.tag_date.build" /></p>
            @endif

            @if ($data_available)
                <section class="chart" aria-label="標籤折線圖">
                    <svg viewBox="0 0 {{ $chartWidth }} {{ $chartHeight }}" role="img" aria-label="{{ $title }}">
                        <line x1="{{ $padLeft }}" y1="{{ $padTop }}" x2="{{ $padLeft }}" y2="{{ $padTop + $plotHeight }}" stroke="#d7dde6" />
                        <line x1="{{ $padLeft }}" y1="{{ $padTop + $plotHeight }}" x2="{{ $padLeft + $plotWidth }}" y2="{{ $padTop + $plotHeight }}" stroke="#d7dde6" />
                        @for ($tick = 0; $tick <= 4; $tick++)
                            @php
                                $tickValue = $maxValue * $tick / 4;
                                $tickY = $yFor($tickValue);
                            @endphp
                            <line x1="{{ $padLeft }}" y1="{{ $tickY }}" x2="{{ $padLeft + $plotWidth }}" y2="{{ $tickY }}" stroke="#eef2f6" />
                            <text x="8" y="{{ $tickY + 4 }}" fill="#667085" font-size="11">{{ number_format($tickValue) }}</text>
                        @endfor
                        @foreach ($series as $index => $row)
                            @if ($index === 0 || $index === count($series) - 1 || $index % max(1, (int) floor(count($series) / 6)) === 0)
                                <text x="{{ $xFor($index) }}" y="{{ $chartHeight - 15 }}" fill="#667085" font-size="11" text-anchor="middle">{{ substr($row['date'], 5) }}</text>
                            @endif
                        @endforeach
                        @php
                            $points = collect($series)
                                ->filter(fn ($row) => $row['value'] !== null)
                                ->map(fn ($row, $index) => $xFor($index).','.$yFor((float) $row['value']))
                                ->implode(' ');
                        @endphp
                        <polyline points="{{ $points }}" fill="none" stroke="#0f766e" stroke-width="2.6" />
                    </svg>
                </section>
            @else
                <div class="empty">目前沒有符合條件的標籤趨勢 cache；Laravel 會透過 ingestion 與 tag-date cache refresh 補齊這張即時儀表板。<br><x-ingestion-portal job="reports.tag_date.build" /></div>
            @endif

            <h2>每日資料</h2>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            <th>7 日{{ $type_name }}</th>
                            <th>每日影片</th>
                            <th>每日觀看</th>
                            <th>頻道數</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($series as $row)
                            <tr>
                                <th>{{ $row['date'] }}</th>
                                <td class="number">{{ $row['value'] !== null ? number_format($row['value'], $type === 'average' ? 1 : 0) : '-' }}</td>
                                <td class="number">{{ $row['count_videos'] !== null ? number_format($row['count_videos']) : '-' }}</td>
                                <td class="number">{{ $row['total_views'] !== null ? number_format($row['total_views']) : '-' }}</td>
                                <td class="number">{{ $row['count_channels'] !== null ? number_format($row['count_channels']) : '-' }}</td>
                            </tr>
                        @empty
                            <tr><td class="empty" colspan="5">目前沒有可顯示的日期。</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
