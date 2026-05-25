@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $keyword }} {{ $section_title }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0b5cad; --accent-bg: #e6f4f1; --ok: #0f766e; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: var(--accent); text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1400px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .subnav, .filters, .summary { display: flex; flex-wrap: wrap; gap: 10px; }
            .nav, .subnav { margin-bottom: 10px; }
            .subnav a, .filters li, .summary span, .badge { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .subnav a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--ok); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { color: var(--muted); }
            .meta { color: var(--muted); white-space: nowrap; }
            .panel { padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .notice { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1080px; border-collapse: collapse; }
            .panel table { min-width: 0; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .thumb { width: 88px; }
            .thumb img { display: block; width: 72px; height: 54px; object-fit: cover; background: #d7dde6; }
            .title-cell { min-width: 390px; line-height: 1.45; }
            .channel, .time { white-space: nowrap; }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--accent-bg); color: var(--ok); }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
<div class="meta">{{ count($rows) }} 筆 · cache {{ $cache_rows }} rows · {{ $generated_at }}</div>

@php
                $query = request()->query();
                unset($query['hours'], $query['days']);
                $periods = [
                    ['label' => '一天', 'hours' => 24, 'days' => 1],
                    ['label' => '三天', 'hours' => 72, 'days' => 3],
                    ['label' => '一週', 'hours' => 168, 'days' => 7],
                ];
            @endphp



            <nav class="subnav" aria-label="時間範圍">
                @foreach ($periods as $period)
                    <a class="{{ $hours === $period['hours'] ? 'active' : '' }}" href="{{ route('keywords.videos', ['keyword' => $keyword] + $query + ['hours' => $period['hours'], 'days' => $period['days']]) }}">{{ $period['label'] }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            @if (! $data_available)
                <section class="panel">
                    <p class="notice">Data unavailable locally. {{ $blocked_reason }}</p>
                    <p>Legacy source: {{ $legacy_file }}. Laravel only reads `urt_show_video_tag_date` and `urt_video`; it does not call `api/tags_relation_date.php`.</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Dependency</th>
                                <th>Rows</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($dependencies as $dependency)
                                <tr>
                                    <td><code>{{ $dependency['table'] }}</code></td>
                                    <td>{{ $dependency['rows'] === null ? '-' : number_format($dependency['rows']) }}</td>
                                    <td><span class="badge {{ $dependency['status'] }}">{{ $dependency['status'] }}</span></td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </section>
            @else
                <div class="summary" aria-label="Keyword video summary">
                    <span>{{ $days }} 天 cache range</span>
                    <span>{{ count($dates) }} dates</span>
                    <span>{{ $cache_rows }} cache rows</span>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>排名</th>
                                <th>縮圖</th>
                                <th>頻道</th>
                                <th>時間</th>
                                <th>標題</th>
                                <th>觀看</th>
                                <th>喜歡</th>
                                <th>留言</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <td class="rank">{{ $row['rank'] }}</td>
                                    <td class="thumb">
                                        <a href="{{ $row['youtube_url'] }}" rel="noreferrer">
                                            @if ($row['thumbnail'])
                                                <img src="{{ $row['thumbnail'] }}" alt="">
                                            @endif
                                        </a>
                                    </td>
                                    <td class="channel">
                                        @if ($row['u_id'] > 0)
                                            <a href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['channel_title'] }}</a>
                                        @else
                                            {{ $row['channel_title'] }}
                                        @endif
                                    </td>
                                    <td class="time">{{ $row['published_at'] }}</td>
                                    <td class="title-cell">{{ $row['title'] }}</td>
                                    <td class="number">{{ number_format($row['view_count']) }}</td>
                                    <td class="number">{{ number_format($row['like_count']) }}</td>
                                    <td class="number">{{ number_format($row['comment_count']) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>

                <p class="meta">Legacy source: {{ $legacy_file }}; writes=0</p>
            @endif
@endsection
