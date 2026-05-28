@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $period['from'] }} - {{ $period['to'] }} · {{ $generated_at }}
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
            .nav, .switcher { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .switcher a { display: inline-flex; align-items: center; min-height: 28px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
            .summary span { display: inline-flex; min-height: 24px; align-items: center; padding: 2px 7px; border-radius: 6px; background: #f2f4f7; color: #344054; font-size: 12px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 980px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: right; vertical-align: middle; }
            th { background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            th:first-child, td:first-child { position: sticky; left: 0; background: var(--surface); text-align: left; font-weight: 700; }
            thead th:first-child { background: #eef2f6; }
            .person-meta { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            .notice { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 760px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                $baseQuery = $query;
                unset($baseQuery['days']);
            @endphp



            @if ($channel)
                <nav class="switcher" aria-label="期間">
                    @foreach ([7 => '一週', 14 => '兩週', 28 => '四週', 60 => '兩月'] as $days => $label)
                        <a class="{{ $period['days'] === $days ? 'active' : '' }}" href="{{ route('channels.people', ['u_id' => $channel['u_id']] + $baseQuery + ['days' => $days]) }}">{{ $label }}</a>
                    @endforeach
                </nav>
            @endif

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_channel_ai`。<br><x-ingestion-portal job="ai.daily" /></p>
            @endif

            <div class="summary">
                @foreach ($people as $person)
                    <span>{{ $person['name'] }} · {{ number_format($person['videos']) }} 部 · {{ number_format($person['topics']) }} 則</span>
                @endforeach
            </div>

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            @foreach ($people as $person)
                                <th>
                                    {{ $person['name'] }}
                                    <span class="person-meta">{{ number_format($person['videos']) }} 部 / {{ number_format($person['topics']) }} 則 / {{ count($person['dates']) }} 日</span>
                                </th>
                            @endforeach
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($matrix as $row)
                            <tr>
                                <td>{{ $row['date'] }}</td>
                                @foreach ($people as $person)
                                    <td>{{ ($row['cells'][$person['name']] ?? 0) > 0 ? number_format($row['cells'][$person['name']]) : '-' }}</td>
                                @endforeach
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="{{ max(1, count($people) + 1) }}">
                                    {{ $available ? '目前沒有符合條件的頻道人物資料。' : '本機尚未匯入 `urt_channel_ai`。' }}<br><x-ingestion-portal job="ai.daily" />
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
