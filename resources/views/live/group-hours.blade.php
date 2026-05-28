@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $date }} · cache rows {{ number_format($cache_rows) }} · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .switcher, .date-nav, .filters { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher, .date-nav { margin-bottom: 14px; }
            .switcher a, .date-nav a, .filters li { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 820px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .sub { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                unset($query['group'], $query['date']);
                $previousDate = \Carbon\CarbonImmutable::parse($date, 'Asia/Taipei')->subDay()->toDateString();
                $nextDate = \Carbon\CarbonImmutable::parse($date, 'Asia/Taipei')->addDay()->toDateString();
            @endphp



            <nav class="switcher" aria-label="群組">
                @foreach ($options as $option)
                    <a class="{{ $group['name'] === $option['name'] ? 'active' : '' }}" href="{{ route('live.groups.hours', array_merge(['group' => $option['name']], $query, ['date' => $date])) }}">{{ $option['label'] }}</a>
                @endforeach
            </nav>

            <nav class="date-nav" aria-label="日期">
                <a href="{{ route('live.groups.hours', array_merge(['group' => $group['name']], $query, ['date' => $previousDate])) }}">前一天</a>
                <a href="{{ route('live.groups.hours', array_merge(['group' => $group['name']], $query, ['date' => $nextDate])) }}">後一天</a>
            </nav>

            <ul class="filters" aria-label="Legacy group filters">
                @foreach ($group['groups'] as $item)
                    <li>{{ $item['name'] }} {{ $item['tag_para'] }}</li>
                @endforeach
            </ul>

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_show_live_tag_date` cache table。<br><x-ingestion-portal job="reports.live.build" /></p>
            @elseif (! $data_available)
                <p class="notice">目前沒有符合這組 group/date 的 live tag cache；Laravel 會透過 live tag ingestion 與 cache refresh 補齊這張即時儀表板。<br><x-ingestion-portal job="reports.live.build" /></p>
            @endif

            @if ($rows === [])
                <div class="empty">目前沒有可顯示的每小時直播資料。</div>
            @else
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>時間</th>
                                @foreach ($group['groups'] as $item)
                                    <th class="number">{{ $item['name'] }}</th>
                                @endforeach
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <th>{{ $row['hour'] }} 時</th>
                                    @foreach ($group['groups'] as $item)
                                        @php($cell = $row['cells'][$item['name']] ?? ['views' => 0, 'count' => 0])
                                        <td class="number">
                                            {{ $cell['views'] > 0 ? number_format($cell['views']) : '' }}
                                            <span class="sub">{{ $cell['count'] > 0 ? number_format($cell['count']).' 部' : '' }}</span>
                                        </td>
                                    @endforeach
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endif
@endsection
