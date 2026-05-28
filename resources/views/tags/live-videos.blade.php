@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ count($rows) }} 筆 ·
                    @if ($period['is_range'])
                        {{ $period['from'] }} - {{ $period['to'] }}
                    @else
                        {{ $period['date'] }}
                    @endif
                    · {{ $generatedAt }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1400px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .range-nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .range-nav { gap: 8px; margin-bottom: 16px; }
            .range-nav a { display: inline-flex; min-height: 28px; align-items: center; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li, .tag { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .tag { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); margin: 2px 4px 2px 0; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1120px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .thumb { width: 88px; }
            .thumb img { display: block; width: 72px; height: 54px; object-fit: cover; background: #d7dde6; }
            .title-cell { min-width: 420px; line-height: 1.45; }
            .channel, .time { white-space: nowrap; }
            .trend { max-width: 180px; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $baseParams = $filters;
                unset($baseParams['date'], $baseParams['from'], $baseParams['to']);
                $targetRoute = $tag['id'] > 0 ? 'tags.live.videos' : 'tags.live.videos.index';
                $targetBase = $tag['id'] > 0 ? ['tagId' => $tag['id']] : [];
                $today = now('Asia/Taipei')->toDateString();
            @endphp



            <nav class="range-nav" aria-label="時間範圍">
                <a href="{{ route($targetRoute, $targetBase + $baseParams + ['date' => $today]) }}">一天</a>
                <a href="{{ route($targetRoute, $targetBase + $baseParams + ['from' => now('Asia/Taipei')->subDays(3)->toDateString(), 'to' => $today]) }}">三天</a>
                <a href="{{ route($targetRoute, $targetBase + $baseParams + ['from' => now('Asia/Taipei')->subDays(7)->toDateString(), 'to' => $today]) }}">一週</a>
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ is_array($value) ? implode(',', $value) : $value }}</li>
                    @endforeach
                </ul>
            @endif

            <div class="table-wrap">
                <table class="report-table" style="--report-table-min-width: 1120px; --report-col-label: 170px; --report-col-number: 104px; --report-col-time: 150px; --report-col-trend: 180px;">
                    <colgroup>
                        <col class="report-col-rank">
                        <col class="report-col-thumb">
                        <col class="report-col-channel">
                        <col class="report-col-time">
                        <col class="report-col-fill">
                        <col class="report-col-number">
                        <col class="report-col-trend">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>排名</th>
                            <th>縮圖</th>
                            <th>頻道</th>
                            <th>時間</th>
                            <th>標題</th>
                            <th>最高人數</th>
                            <th>趨勢線</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank"><a href="{{ route('live.videos.trend', ['videoId' => $row['video_id']]) }}">{{ $row['rank'] }}</a></td>
                                <td class="thumb">
                                    <a href="{{ $row['youtube_url'] }}" rel="noreferrer">
                                        <img src="{{ $row['thumbnail'] }}" alt="">
                                    </a>
                                </td>
                                <td class="channel"><a href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['channel_title'] }}</a></td>
                                <td class="time">{{ $row['published_at'] }}</td>
                                <td class="title-cell">
                                    {{ $row['title'] }}
                                    @foreach ($row['tags'] as $rowTag)
                                        <a class="tag" href="{{ route('tags.live.videos', ['tagId' => $rowTag['id'], 'date' => $period['date']]) }}">{{ $rowTag['name'] }}</a>
                                    @endforeach
                                </td>
                                <td class="number">{{ number_format($row['max_current']) }}</td>
                                <td class="trend" title="{{ $row['trend_label'] }}">{{ $row['trend_label'] }}</td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="7">
                                    {{ $dataAvailable ? '目前沒有符合條件的直播影片資料。' : '本機尚未匯入 legacy live tables。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
