@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ count($rows) }} 筆 · {{ $period['from'] }} - {{ $period['to'] }} · {{ $generatedAt }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1320px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .switcher { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .switcher { gap: 8px; margin-bottom: 14px; }
            .switcher a { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li, .tag { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .tag { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); margin-left: 4px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1040px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .thumb { width: 86px; }
            .thumb img { display: block; width: 64px; height: 64px; object-fit: cover; background: #d7dde6; }
            .video-thumb { width: 92px; }
            .video-thumb img { display: block; width: 72px; height: 54px; object-fit: cover; background: #d7dde6; }
            .channel-cell { min-width: 260px; line-height: 1.45; }
            .video-cell { min-width: 280px; line-height: 1.45; }
            .subtle { color: var(--muted); font-size: 12px; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                $periodQuery = $query;
                unset($periodQuery['days'], $periodQuery['date'], $periodQuery['from'], $periodQuery['to']);
                $dateQuery = $query;
                unset($dateQuery['days'], $dateQuery['from'], $dateQuery['to']);
            @endphp



            <nav class="switcher" aria-label="日期範圍">
                @foreach ([7 => '一週', 30 => '一月', 90 => '一季'] as $days => $label)
                    <a class="{{ $period['mode'] === 'days' && (int) $period['days'] === $days ? 'active' : '' }}" href="{{ route('live.channels', $periodQuery + ['days' => $days]) }}">{{ $label }}</a>
                @endforeach
                <a class="{{ $period['mode'] === 'date' ? 'active' : '' }}" href="{{ route('live.channels', $dateQuery + ['date' => $period['to']]) }}">單日</a>
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ is_array($value) ? implode(',', $value) : $value }}</li>
                    @endforeach
                </ul>
            @endif

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">排名</th>
                            <th scope="col">縮圖</th>
                            <th scope="col">頻道</th>
                            <th scope="col">總數</th>
                            <th scope="col">直播數</th>
                            <th scope="col">最高影片</th>
                            <th scope="col">最高人數</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank">{{ $row['rank'] }}</td>
                                <td class="thumb">
                                    @if ($row['channel_url'])
                                        <a href="{{ $row['channel_url'] }}" rel="noreferrer"><img src="{{ $row['thumbnail'] }}" alt=""></a>
                                    @else
                                        <img src="{{ $row['thumbnail'] }}" alt="">
                                    @endif
                                </td>
                                <td class="channel-cell">
                                    <a href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['title'] }}</a>
                                    @foreach ($row['tags'] as $tag)
                                        <a class="tag" href="{{ route('live.channels', ['tagid' => $tag['id']]) }}">{{ $tag['name'] }}</a>
                                    @endforeach
                                    @if ($row['youtube_id'])
                                        <div class="subtle">{{ $row['youtube_id'] }}</div>
                                    @endif
                                </td>
                                <td class="number">{{ number_format($row['total_current']) }}</td>
                                <td class="number">{{ number_format($row['live_count']) }}</td>
                                <td class="video-cell">
                                    @if ($row['max_video_url'])
                                        <a class="video-thumb" href="{{ $row['max_video_url'] }}" rel="noreferrer"><img src="{{ $row['max_video_thumbnail'] }}" alt=""></a>
                                        <a href="{{ route('live.videos.trend', ['videoId' => $row['max_video_id']]) }}">{{ $row['max_video_title'] }}</a>
                                        <div class="subtle">{{ $row['max_video_id'] }} · {{ $row['max_date'] }}</div>
                                    @endif
                                </td>
                                <td class="number">{{ number_format($row['max_current']) }}</td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="7">
                                    {{ $dataAvailable ? '目前沒有符合條件的直播頻道資料。' : '本機尚未匯入 legacy live channel tables。' }}
                                    <br><x-ingestion-portal job="reports.live.build" />
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
