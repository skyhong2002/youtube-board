@extends('layouts.report')

@section('title')
{{ $video['title'] ?? $video_id }}
@endsection

@section('meta')
影片基本資料 · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 26px; line-height: 1.25; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .actions, .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .action, .stat { display: inline-flex; align-items: center; min-height: 30px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .action.primary { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta, .muted { color: var(--muted); }
            .summary { display: grid; grid-template-columns: 180px 1fr; gap: 18px; padding: 14px; border: 1px solid var(--line); background: var(--surface); }
            .summary img { display: block; width: 180px; aspect-ratio: 16 / 9; object-fit: cover; background: #d7dde6; }
            .stat { font-variant-numeric: tabular-nums; }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .description { max-height: 180px; overflow: auto; white-space: pre-wrap; color: #344054; }
            .chart { padding: 14px; border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
            svg { display: block; width: 100%; min-width: 680px; height: 220px; }
            .axis { stroke: #9aa4b2; stroke-width: 1; }
            .line { fill: none; stroke: var(--accent); stroke-width: 3; }
            .dot { fill: var(--accent); }
            table { width: 100%; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header, .summary { display: block; } .summary img { width: 100%; margin-bottom: 12px; } }
</style>
@endpush

@section('content')
@if (! $available)
                <p class="notice">本機尚未匯入影片相關 legacy tables。</p>
            @endif

            @if ($video)
                <section class="summary">
                    <a href="{{ $video['youtube_url'] }}" rel="noreferrer">
                        <img src="{{ $video['thumbnail'] }}" alt="">
                    </a>
                    <div>
                        <div><strong>{{ $video['channel_title'] }}</strong></div>
                        <div class="muted">{{ $video['published_at'] }} · {{ $video['duration_label'] ?? 'duration n/a' }}</div>
                        <div class="stats">
                            <span class="stat">觀看 {{ $video['view_count'] !== null ? number_format($video['view_count']) : 'n/a' }}</span>
                            <span class="stat">喜歡 {{ $video['like_count'] !== null ? number_format($video['like_count']) : 'n/a' }}</span>
                            <span class="stat">留言 {{ $video['comment_count'] !== null ? number_format($video['comment_count']) : 'n/a' }}</span>
                            <span class="stat">直播 log {{ number_format($live['log_rows']) }}</span>
                        </div>
                        <div class="actions">
                            <a class="action primary" href="{{ $video['youtube_url'] }}" rel="noreferrer">YouTube</a>
                            <a class="action" href="{{ route('videos.analytics', ['videoId' => $video_id]) }}">留言/統計分析</a>
                            @if ($live['log_rows'] > 0)
                                <a class="action" href="{{ route('live.videos.trend', ['videoId' => $video_id]) }}">直播趨勢</a>
                            @endif
                        </div>
                        @if ($video['description'] !== '')
                            <div class="description">{{ $video['description'] }}</div>
                        @endif
                    </div>
                </section>
            @elseif ($data_available)
                <div class="empty">找不到 `urt_video` 基本資料，但本機有其他影片相關資料。</div>
            @else
                <div class="empty">找不到這支影片的本機 legacy 資料。</div>
            @endif

            <h2>直播摘要</h2>
            @if ($live['log_rows'] > 0)
                <section class="chart">
                    @include('videos.partials.chart', ['series' => $live['daily'], 'label' => 'daily live viewers'])
                </section>
            @else
                <div class="empty">沒有 `urt_video_live_log` 資料。</div>
            @endif

            <h2>影片統計歷史</h2>
            @if ($history['rows'] !== [])
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            <th class="number">觀看</th>
                            <th class="number">喜歡</th>
                            <th class="number">留言</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($history['rows'] as $row)
                            <tr>
                                <td>{{ $row['date'] }}</td>
                                <td class="number">{{ $row['view'] !== null ? number_format($row['view']) : '-' }}</td>
                                <td class="number">{{ $row['like'] !== null ? number_format($row['like']) : '-' }}</td>
                                <td class="number">{{ $row['comment'] !== null ? number_format($row['comment']) : '-' }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @else
                <div class="empty">沒有 `urt_video_log` 資料；影片統計會透過 Laravel YouTube stats ingestion 補齊。</div>
            @endif
@endsection
