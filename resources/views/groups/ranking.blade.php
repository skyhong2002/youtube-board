@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $range['from'] }} - {{ $range['to'] }} · cache rows {{ number_format($cache_rows) }} · {{ $generated_at }}
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
            .nav, .switcher, .filters { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters li { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 860px; border-collapse: collapse; }
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
                $query = request()->query();
                unset($query['group'], $query['days'], $query['from'], $query['to']);
                $periodQuery = request()->query();
                unset($periodQuery['group'], $periodQuery['days'], $periodQuery['from'], $periodQuery['to']);
            @endphp



            <nav class="switcher" aria-label="群組">
                @foreach ($options as $option)
                    <a class="{{ $group['name'] === $option['name'] ? 'active' : '' }}" href="{{ route('groups.ranking', ['groupName' => $option['name']] + $query + ['days' => $range['days']]) }}">{{ $option['label'] }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="日期範圍">
                @foreach ([1 => '一天', 3 => '三天', 7 => '一週', 10 => '十天', 30 => '一個月'] as $days => $label)
                    <a class="{{ (string) $range['days'] === (string) $days ? 'active' : '' }}" href="{{ route('groups.ranking', ['groupName' => $group['name']] + $periodQuery + ['days' => $days]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <ul class="filters" aria-label="Legacy group filters">
                @foreach ($group['groups'] as $item)
                    <li>{{ $item['name'] }} {{ $item['tag_para'] }}</li>
                @endforeach
            </ul>

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_show_tag_date` cache table。</p>
            @elseif (! $data_available)
                <p class="notice">目前沒有符合這組 group/date 的 tag-date cache；Laravel 不會觸發 legacy `api/cloud_tag_date.php` 產生資料。</p>
            @endif

            @if ($rows === [])
                <div class="empty">目前沒有可顯示的群組排行資料。</div>
            @else
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>群組</th>
                                <th>Legacy filter</th>
                                <th class="number">總觀看次數</th>
                                <th class="number">觀看中位數</th>
                                <th class="number">總影片數</th>
                                <th class="number">影片中位數</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <th>{{ $row['name'] }}</th>
                                    <td>{{ $row['tag_para'] }}</td>
                                    <td class="number">{{ number_format($row['views_sum']) }}</td>
                                    <td class="number">{{ number_format($row['views_median'], $row['views_median'] === floor($row['views_median']) ? 0 : 1) }}</td>
                                    <td class="number">{{ number_format($row['videos_sum']) }}</td>
                                    <td class="number">{{ number_format($row['videos_median'], $row['videos_median'] === floor($row['videos_median']) ? 0 : 1) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endif
@endsection
