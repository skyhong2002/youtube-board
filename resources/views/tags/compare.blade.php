@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $type_name }} · {{ $range['from'] }} - {{ $range['to'] }} · {{ $source }} · cache rows {{ number_format($cache_rows) }}
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
            .nav, .switcher, .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .switcher { gap: 8px; margin-bottom: 14px; }
            .switcher a, .filters li, .legend span { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 999px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .insight-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; align-items: start; margin: 0 0 14px; }
            .insight-panel { min-width: 0; border: 1px solid var(--line); background: var(--surface); padding: 12px; }
            .insight-panel h2 { margin: 0 0 10px; font-size: 15px; line-height: 1.3; }
            .keyword-cloud { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-height: 64px; }
            .keyword-cloud span { display: inline-flex; align-items: baseline; gap: 5px; max-width: 100%; color: #12312d; font-weight: 800; line-height: 1.15; overflow-wrap: anywhere; }
            .keyword-cloud small { color: var(--muted); font-size: 11px; font-weight: 600; }
            .trend-list { display: grid; gap: 8px; }
            .trend-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid #eef2f6; }
            .trend-row:last-child { padding-bottom: 0; border-bottom: 0; }
            .trend-name { min-width: 0; overflow-wrap: anywhere; font-weight: 800; }
            .trend-meta { margin-top: 2px; color: var(--muted); font-size: 12px; line-height: 1.35; }
            .trend-value { font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .chart { border: 1px solid var(--line); background: var(--surface); padding: 12px; overflow-x: auto; }
            svg { display: block; min-width: 860px; width: 100%; height: auto; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 860px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty, .notice { padding: 24px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            .notice { margin: 0 0 14px; padding: 12px; border-color: #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); text-align: left; }
            @media (max-width: 820px) { .insight-grid { grid-template-columns: 1fr; } }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $chartWidth = 940;
                $chartHeight = 320;
                $padLeft = 64;
                $padRight = 18;
                $padTop = 18;
                $padBottom = 46;
                $plotWidth = $chartWidth - $padLeft - $padRight;
                $plotHeight = $chartHeight - $padTop - $padBottom;
                $colors = ['#0f766e', '#2563eb', '#b45309', '#be123c', '#7c3aed', '#047857', '#0e7490', '#9333ea', '#c2410c', '#4d7c0f', '#0369a1', '#9f1239'];
                $allValues = collect($series)->flatMap(fn ($row) => array_values($row['values']))->filter(fn ($value) => $value !== null)->values();
                $maxValue = max(1, (float) ($allValues->max() ?? 1));
                $xFor = fn (int $index): float => $padLeft + ($plotWidth * ($index / max(1, count($series) - 1)));
                $yFor = fn (int|float $value): float => $padTop + $plotHeight - ($plotHeight * ($value / $maxValue));
                $query = request()->query();
                $periodQuery = $query;
                unset($periodQuery['days'], $periodQuery['from'], $periodQuery['to']);
                $typeQuery = $query;
                unset($typeQuery['type']);
                $keywordTotals = collect($keywords)
                    ->mapWithKeys(fn ($keyword) => [$keyword => collect($series)->sum(fn ($row) => (float) ($row['values'][$keyword] ?? 0))])
                    ->sortDesc();
                $keywordMax = max(1.0, (float) ($keywordTotals->max() ?? 1));
                $keywordCloud = $keywordTotals
                    ->map(function (float $total, string $keyword) use ($keywordMax): array {
                        $size = $total > 0 ? 14 + (18 * (log($total + 1) / log($keywordMax + 1))) : 14;

                        return ['keyword' => $keyword, 'total' => $total, 'size' => min(32, $size)];
                    })
                    ->values();
                $trendRows = collect($keywords)
                    ->map(function (string $keyword) use ($series): array {
                        $values = collect($series)
                            ->map(fn ($row) => ['date' => $row['date'], 'value' => (float) ($row['values'][$keyword] ?? 0)])
                            ->values();
                        $latest = $values->last() ?? ['date' => null, 'value' => 0.0];
                        $first = $values->first() ?? ['date' => null, 'value' => 0.0];
                        $peak = $values->sortByDesc('value')->first() ?? ['date' => null, 'value' => 0.0];

                        return [
                            'keyword' => $keyword,
                            'latest_date' => $latest['date'],
                            'latest_value' => (float) $latest['value'],
                            'delta' => (float) $latest['value'] - (float) $first['value'],
                            'peak_date' => $peak['date'],
                            'peak_value' => (float) $peak['value'],
                        ];
                    })
                    ->sortByDesc('latest_value')
                    ->values();
            @endphp



            <nav class="switcher" aria-label="日期範圍">
                @foreach ([7 => '一週', 10 => '十天', 30 => '一個月', 60 => '兩個月', 90 => '一季'] as $days => $label)
                    <a class="{{ (string) $range['days'] === (string) $days ? 'active' : '' }}" href="{{ route('tags.compare', $periodQuery + ['days' => $days, 'type' => $type]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="指標">
                @foreach ($types as $typeKey => $label)
                    <a class="{{ $type === $typeKey ? 'active' : '' }}" href="{{ route('tags.compare', $typeQuery + ['type' => $typeKey, 'days' => $range['days']]) }}">{{ $label }}</a>
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
            @elseif (! $data_available)
                <p class="notice">目前沒有符合條件的多關鍵字趨勢 cache；Laravel 會透過 ingestion 與 tag-date cache refresh 補齊這張即時儀表板。<br><x-ingestion-portal job="reports.tag_date.build" /></p>
            @endif

            @if ($data_available)
                <section class="insight-grid" aria-label="關鍵字摘要">
                    <div class="insight-panel">
                        <h2>關鍵字文字雲</h2>
                        <div class="keyword-cloud">
                            @foreach ($keywordCloud as $word)
                                <span style="font-size: {{ number_format((float) $word['size'], 1) }}px;">
                                    {{ $word['keyword'] }}
                                    <small>{{ number_format((float) $word['total'], $type === 'tags_result' ? 1 : 0) }}</small>
                                </span>
                            @endforeach
                        </div>
                    </div>

                    <div class="insight-panel">
                        <h2>趨勢摘要</h2>
                        <div class="trend-list">
                            @foreach ($trendRows as $row)
                                <div class="trend-row">
                                    <div>
                                        <div class="trend-name">{{ $row['keyword'] }}</div>
                                        <div class="trend-meta">峰值 {{ $row['peak_date'] }} · {{ number_format((float) $row['peak_value'], $type === 'tags_result' ? 1 : 0) }}</div>
                                    </div>
                                    <div class="trend-value">
                                        {{ number_format((float) $row['latest_value'], $type === 'tags_result' ? 1 : 0) }}
                                        <div class="trend-meta">{{ (float) $row['delta'] >= 0 ? '+' : '' }}{{ number_format((float) $row['delta'], $type === 'tags_result' ? 1 : 0) }}</div>
                                    </div>
                                </div>
                            @endforeach
                        </div>
                    </div>
                </section>
            @endif

            <div class="legend" aria-label="關鍵字">
                @foreach ($keywords as $keywordIndex => $keyword)
                    <span><i style="background: {{ $colors[$keywordIndex % count($colors)] }}"></i>{{ $keyword }}</span>
                @endforeach
            </div>

            @if ($data_available)
                <section class="chart" aria-label="多關鍵字折線圖">
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
                        @foreach ($keywords as $keywordIndex => $keyword)
                            @php
                                $points = collect($series)
                                    ->map(fn ($row, $index) => $xFor($index).','.$yFor((float) ($row['values'][$keyword] ?? 0)))
                                    ->implode(' ');
                            @endphp
                            <polyline points="{{ $points }}" fill="none" stroke="{{ $colors[$keywordIndex % count($colors)] }}" stroke-width="2.6" />
                        @endforeach
                    </svg>
                </section>
            @else
                <div class="empty">目前沒有可繪製的多關鍵字趨勢資料。</div>
            @endif

            <h2>每日資料</h2>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            @foreach ($keywords as $keyword)
                                <th>{{ $keyword }}</th>
                            @endforeach
                            <th>每日影片</th>
                            <th>每日觀看</th>
                            <th>頻道數</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($series as $row)
                            <tr>
                                <th>{{ $row['date'] }}</th>
                                @foreach ($keywords as $keyword)
                                    <td class="number">{{ number_format((float) ($row['values'][$keyword] ?? 0), $type === 'tags_result' ? 1 : 0) }}</td>
                                @endforeach
                                <td class="number">{{ $row['count_videos'] !== null ? number_format($row['count_videos']) : '-' }}</td>
                                <td class="number">{{ $row['total_views'] !== null ? number_format($row['total_views']) : '-' }}</td>
                                <td class="number">{{ $row['count_channels'] !== null ? number_format($row['count_channels']) : '-' }}</td>
                            </tr>
                        @empty
                            <tr><td class="empty" colspan="{{ count($keywords) + 4 }}">目前沒有可顯示的日期。</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
