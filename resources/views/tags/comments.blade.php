@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1260px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .filters, .quick { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li, .badge, .quick a { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .quick a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta, .muted { color: var(--muted); }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .panel { padding: 16px; border: 1px solid var(--line); background: var(--surface); }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 980px; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; white-space: nowrap; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .thumb { width: 96px; height: 54px; object-fit: cover; background: #eef2f6; }
            .avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #eef2f6; }
            .empty { padding: 24px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } }
</style>
@endpush

@section('content')
<nav class="quick" aria-label="Legacy hour filters">
                @foreach ([24 => '一天', 72 => '三天', 168 => '一週'] as $hours => $label)
                    <a class="{{ (int) ($filters['hours'] ?? 24) === $hours ? 'active' : '' }}" href="{{ request()->fullUrlWithQuery(['hours' => $hours]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <ul class="filters" aria-label="Legacy filters">
                @foreach ($filters as $name => $value)
                    @if ($value !== '')
                        <li>{{ $name }}={{ $value }}</li>
                    @endif
                @endforeach
            </ul>

            @include('reports.partials.lineage', ['lineage' => $lineage ?? null])

            @if (! $data_available)
                <section class="panel">
                    <p class="notice">Data unavailable locally. {{ $blocked_reason }}<br><x-ingestion-portal job="youtube.comments.fetch" /></p>
                    <p class="muted">Legacy source: {{ $legacy_file }}. 留言資料會透過 Laravel comment queue 與 comment ingestion 補齊。</p>
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
            @endif

            <h2>近期留言影片</h2>
            @if ($rows !== [])
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th class="number">排名</th>
                                <th>縮圖</th>
                                <th>頻道</th>
                                <th>標題</th>
                                <th>最後留言</th>
                                <th class="number">留言人數</th>
                                <th class="number">按讚總數</th>
                                <th class="number">留言數</th>
                                <th class="number">回應數</th>
                                <th class="number">總數</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <td class="number"><a href="{{ route('videos.analytics', ['videoId' => $row['video_id']]) }}">{{ $row['rank'] }}</a></td>
                                    <td><a href="{{ $row['youtube_url'] }}"><img class="thumb" src="{{ $row['thumbnail'] }}" alt=""></a></td>
                                    <td>
                                        @if ($row['u_id'] > 0)
                                            <a href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['channel_title'] }}</a>
                                        @else
                                            {{ $row['channel_title'] }}
                                        @endif
                                    </td>
                                    <td>{{ $row['title'] }}</td>
                                    <td>{{ $row['latest_time'] }}</td>
                                    <td class="number">{{ number_format($row['authors_count']) }}</td>
                                    <td class="number">{{ number_format($row['likes_count']) }}</td>
                                    <td class="number">{{ number_format($row['threads_count']) }}</td>
                                    <td class="number">{{ number_format($row['replies_count']) }}</td>
                                    <td class="number">{{ number_format($row['comments_count']) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @else
                <div class="empty">沒有符合條件的留言影片。<br><x-ingestion-portal job="youtube.comments.fetch" /></div>
            @endif

            <h2>留言者排行</h2>
            @if ($authors !== [])
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th class="number">排名</th>
                                <th>頭像</th>
                                <th>人名</th>
                                <th class="number">次數</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($authors as $index => $author)
                                <tr>
                                    <td class="number"><a href="{{ route('comments.authors.show', ['authorKey' => $author['channel_id'], 'lookup' => 'ChannelId']) }}">{{ $index + 1 }}</a></td>
                                    <td>
                                        @if ($author['image_url'] !== '')
                                            <img class="avatar" src="{{ $author['image_url'] }}" alt="">
                                        @endif
                                    </td>
                                    <td>
                                        @if ($author['channel_url'] !== '')
                                            <a href="{{ $author['channel_url'] }}">{{ $author['display_name'] }}</a>
                                        @else
                                            {{ $author['display_name'] }}
                                        @endif
                                    </td>
                                    <td class="number">{{ number_format($author['count']) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @else
                <div class="empty">沒有留言者排行資料。</div>
            @endif
@endsection
