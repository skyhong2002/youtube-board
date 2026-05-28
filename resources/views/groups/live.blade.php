@php
    $maxValue = collect($groups)
        ->flatMap(fn ($group) => collect($group['series'])->flatMap(fn ($series) => collect($series['values'])->pluck('value')))
        ->max() ?: 1;

    $sparkline = function (array $values) use ($maxValue): string {
        if (count($values) < 2) {
            return '';
        }

        $width = 180;
        $height = 42;
        $last = max(1, count($values) - 1);

        return collect($values)
            ->values()
            ->map(function (array $point, int $index) use ($width, $height, $last, $maxValue): string {
                $x = ($index / $last) * $width;
                $y = $height - (((int) $point['value'] / $maxValue) * ($height - 4)) - 2;

                return round($x, 2).','.round($y, 2);
            })
            ->implode(' ');
    };
@endphp
@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --ok: #0f766e; --ok-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1240px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 26px 0 10px; font-size: 18px; }
            .nav, .stats, .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .stat, .tab { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .tab.active { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); }
            .meta, .muted { color: var(--muted); }
            .meta { text-align: right; }
            .empty { padding: 28px; color: var(--warn); text-align: center; border: 1px solid #f7d58b; background: var(--warn-bg); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); margin-bottom: 18px; }
            table { width: 100%; min-width: 780px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            svg { display: block; width: 180px; height: 42px; }
            polyline { fill: none; stroke: #0f766e; stroke-width: 2; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; } }
</style>
@endpush

@section('content')
<section class="stats" aria-label="Group live stats">
                <div class="stat">{{ $from }} to {{ $to }}</div>
                <div class="stat">{{ $metric['label'] }}</div>
                <div class="stat">tag set {{ $tag_set['source_status'] }}</div>
                <div class="stat">view {{ $comparison['source_status'] }}</div>
                <div class="stat">live cache</div>
            </section>

            <nav class="tabs" aria-label="View options">
                @foreach ($options as $option)
                    <a class="tab {{ $option['name'] === $comparison['name'] ? 'active' : '' }}" href="{{ route('groups.live', ['groupName' => $tag_set['name'], 'view' => $option['name'], 'days' => $days, 'type' => $metric['column']]) }}">
                        {{ $option['label'] }}
                    </a>
                @endforeach
            </nav>

            @if (! $available)
                <div class="empty">本機沒有足夠的 <code>urt_show_live_tag_date</code> cache 可以重建這個 legacy group live report。直播群組資料會透過 Laravel live tag ingestion 與 cache refresh 補齊。<br><x-ingestion-portal job="reports.live.build" /></div>
            @else
                @foreach ($groups as $group)
                    <h2>{{ $group['name'] }} <span class="muted">cache rows {{ $group['cache_rows'] }}, latest total {{ number_format($group['latest_total']) }}</span></h2>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Tag</th>
                                    <th>Latest 7-day total</th>
                                    <th>Peak</th>
                                    <th>Trend</th>
                                </tr>
                            </thead>
                            <tbody>
                                @foreach ($group['series'] as $series)
                                    <tr>
                                        <td>{{ $series['tag'] }}</td>
                                        <td>{{ number_format($series['latest']) }}</td>
                                        <td>{{ number_format($series['peak']) }}</td>
                                        <td>
                                            <svg viewBox="0 0 180 42" role="img" aria-label="{{ $series['tag'] }} trend">
                                                <polyline points="{{ $sparkline($series['values']) }}"></polyline>
                                            </svg>
                                        </td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </div>
                @endforeach
            @endif
@endsection
