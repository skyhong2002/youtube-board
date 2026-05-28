@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $period['type_name'] }} · {{ $period['from'] ?? '-' }} - {{ $period['to'] ?? '-' }} · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #f2f4f7; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .switcher, .filters, .cards { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters li { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .cards { margin: 0 0 14px; }
            .card { min-width: 160px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .card .label { color: var(--muted); font-size: 12px; }
            .card .value { margin-top: 4px; font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 860px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .keyword { font-weight: 700; white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                $periodQuery = $query;
                unset($periodQuery['days'], $periodQuery['from'], $periodQuery['to']);
                $typeQuery = $query;
                unset($typeQuery['type']);
            @endphp



            <nav class="switcher" aria-label="日期範圍">
                @foreach ([1 => '一天', 3 => '三天', 7 => '一週', 10 => '十天'] as $days => $label)
                    <a class="{{ (int) ($period['days'] ?? 0) === $days ? 'active' : '' }}" href="{{ route('live.tags', $periodQuery + ['days' => $days, 'type' => $period['type']]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="指標">
                @foreach ($types as $typeKey => $typeName)
                    <a class="{{ $period['type'] === $typeKey ? 'active' : '' }}" href="{{ route('live.tags', $typeQuery + ['type' => $typeKey, 'days' => request()->query('days', 7)]) }}">{{ $typeName }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            @if ($totals !== [])
                <section class="cards" aria-label="每日快取摘要">
                    @foreach (array_slice($totals, -4) as $total)
                        <div class="card">
                            <div class="label">{{ $total['date'] }}</div>
                            <div class="value">{{ number_format($total['total_views']) }}</div>
                            <div class="label">{{ number_format($total['count_videos']) }} 部 · {{ number_format($total['count_tags']) }} 標籤</div>
                        </div>
                    @endforeach
                </section>
            @endif

            @if (! $available)
                <div class="empty">本機尚未匯入 `urt_show_live_tag_date`。<br><x-ingestion-portal job="reports.live.build" /></div>
            @elseif ($rows === [])
                <div class="empty">目前沒有符合這組 tag/filter/date 的直播標籤 cache。新系統會透過排程擷取、快取重建與本地資料補齊這張即時儀表板資料。<br><x-ingestion-portal job="reports.live.build" /></div>
            @else
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>關鍵字</th>
                                <th class="number">指數</th>
                                <th class="number">合計</th>
                                @foreach ($dates as $date)
                                    <th class="number">{{ $date }}</th>
                                @endforeach
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <th class="keyword">{{ $row['keyword'] }}</th>
                                    <td class="number">{{ number_format($row['score'], 1) }}</td>
                                    <td class="number">{{ number_format($row['total']) }}</td>
                                    @foreach ($dates as $date)
                                        <td class="number">{{ ($row['values'][$date] ?? 0) > 0 ? number_format($row['values'][$date]) : '' }}</td>
                                    @endforeach
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endif
@endsection
