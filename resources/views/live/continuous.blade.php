@extends('layouts.report')

@section('title')
現在帶狀直播排行
@endsection

@section('meta')
{{ count($rows) }} 筆 · {{ $period['from'] }} - {{ $period['to'] }} · {{ $generatedAt }}
@endsection

@push('styles')
<style>
:root {
                color-scheme: light;
                --bg: #f7f8fa;
                --surface: #ffffff;
                --text: #18202a;
                --muted: #667085;
                --line: #d7dde6;
                --accent: #0f766e;
                --accent-bg: #e6f4f1;
            }

            * { box-sizing: border-box; }
            body {
                margin: 0;
                background: var(--bg);
                color: var(--text);
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 14px;
            }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1320px; margin: 0 auto; padding: 24px; }
            header {
                display: flex;
                align-items: end;
                justify-content: space-between;
                gap: 18px;
                margin-bottom: 18px;
            }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li, .tag {
                display: inline-flex;
                align-items: center;
                min-height: 24px;
                padding: 3px 8px;
                border: 1px solid var(--line);
                border-radius: 6px;
                background: var(--surface);
                color: var(--muted);
                font-size: 12px;
            }
            .tag {
                border-color: #b7ded6;
                background: var(--accent-bg);
                color: var(--accent);
                margin-left: 4px;
            }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1040px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .thumb { width: 88px; }
            .thumb img { display: block; width: 72px; height: 54px; object-fit: cover; background: #d7dde6; }
            .title-cell { min-width: 420px; line-height: 1.45; }
            .channel { white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            @media (max-width: 720px) {
                main { padding: 16px; }
                header { display: block; }
                .meta { margin-top: 8px; white-space: normal; }
            }
</style>
@endpush

@section('content')
@if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ is_array($value) ? implode(',', $value) : $value }}</li>
                    @endforeach
                </ul>
            @endif

            <div class="table-wrap">
                <table class="report-table" style="--report-table-min-width: 1080px; --report-col-label: 170px; --report-col-number: 96px;">
                    <colgroup>
                        <col class="report-col-rank">
                        <col class="report-col-thumb">
                        <col class="report-col-channel">
                        <col class="report-col-fill">
                        <col class="report-col-number">
                        <col class="report-col-number">
                        <col class="report-col-number">
                        <col class="report-col-number">
                    </colgroup>
                    <thead>
                        <tr>
                            <th scope="col">排名</th>
                            <th scope="col">縮圖</th>
                            <th scope="col">頻道</th>
                            <th scope="col">標題</th>
                            <th scope="col">現在人數</th>
                            <th scope="col">今天最高</th>
                            <th scope="col">週平均</th>
                            <th scope="col">週最高</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank">
                                    <a href="{{ route('live.videos.trend', ['videoId' => $row['video_id']]) }}">{{ $row['rank'] }}</a>
                                </td>
                                <td class="thumb">
                                    <a href="{{ $row['youtube_url'] }}" rel="noreferrer">
                                        <img src="{{ $row['thumbnail'] }}" alt="">
                                    </a>
                                </td>
                                <td class="channel">
                                    <a href="/channels/{{ $row['u_id'] }}">{{ $row['channel_title'] }}</a>
                                </td>
                                <td class="title-cell">
                                    {{ $row['title'] }}
                                    @foreach ($row['tags'] as $tag)
                                        <a class="tag" href="{{ route('live.continuous', ['tagid' => $tag['id']]) }}">{{ $tag['name'] }}</a>
                                    @endforeach
                                </td>
                                <td class="number">{{ number_format($row['current_viewers']) }}</td>
                                <td class="number">{{ $row['today_peak'] !== null ? number_format($row['today_peak']) : '' }}</td>
                                <td class="number">{{ number_format($row['weekly_average']) }}</td>
                                <td class="number">{{ number_format($row['weekly_peak']) }}</td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="8">
                                    {{ $dataAvailable ? '目前沒有符合條件的帶狀直播資料。' : '本機尚未匯入 legacy live tables。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
