@extends('layouts.report')

@section('title')
{{ $video['title'] ?? $video_id }} 留言分析
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { margin-bottom: 18px; }
            h1 { margin: 0; font-size: 26px; line-height: 1.25; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .stat { display: inline-flex; align-items: center; min-height: 30px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-variant-numeric: tabular-nums; }
            .meta, .muted { color: var(--muted); }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .chart { padding: 14px; border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
            svg { display: block; width: 100%; min-width: 680px; height: 220px; }
            .axis { stroke: #9aa4b2; stroke-width: 1; }
            .line { fill: none; stroke: var(--accent); stroke-width: 3; }
            .dot { fill: var(--accent); }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
            table { width: 100%; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .comment-text { max-width: 560px; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 860px) { main { padding: 16px; } .grid { grid-template-columns: 1fr; } }
</style>
@endpush

@section('content')
@if (! $available)
                <p class="notice">本機尚未匯入影片分析相關 legacy tables。<br><x-ingestion-portal job="youtube.videos.stats" /></p>
            @endif

            <div class="stats">
                <span class="stat">影片 log rows {{ number_format($history['log_rows']) }}</span>
                <span class="stat">直播 log rows {{ number_format($live['log_rows']) }}</span>
                <span class="stat">留言 {{ $comments['row'] ? number_format($comments['row']['comments_count']) : 'n/a' }}</span>
                <span class="stat">留言者 {{ $comments['row'] ? number_format($comments['row']['authors_count']) : 'n/a' }}</span>
                <span class="stat">最後留言 {{ $comments['row']['latest_time'] ?? 'n/a' }}</span>
            </div>

            <div class="grid">
                <section>
                    <h2>逐時留言數</h2>
                    <div class="chart">
                        @include('videos.partials.chart', ['series' => $comments['hourly'], 'label' => 'hourly comments'])
                    </div>
                </section>
                <section>
                    <h2>逐天留言數</h2>
                    <div class="chart">
                        @include('videos.partials.chart', ['series' => $comments['daily'], 'label' => 'daily comments'])
                    </div>
                </section>
            </div>

            @if (! $comments['row'])
                <p class="notice">本機 `urt_comment` 沒有這支影片的資料；Laravel 不會提供 legacy 留言抓取連結。</p>
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
                <div class="empty">沒有 `urt_video_log` 資料。</div>
            @endif

            <h2>最多留言/回應</h2>
            @if ($comments['authors'] !== [])
                <table>
                    <thead>
                        <tr>
                            <th>人名</th>
                            <th class="number">留言</th>
                            <th class="number">回應</th>
                            <th class="number">總數</th>
                            <th class="number">按讚總數</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($comments['authors'] as $author)
                            <tr>
                                <td>{{ $author['name'] }}</td>
                                <td class="number">{{ number_format($author['comments']) }}</td>
                                <td class="number">{{ number_format($author['replies']) }}</td>
                                <td class="number">{{ number_format($author['total']) }}</td>
                                <td class="number">{{ number_format($author['likes']) }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @else
                <div class="empty">沒有留言者統計。</div>
            @endif

            <h2>留言文本</h2>
            @if ($comments['comments'] !== [])
                <table>
                    <thead>
                        <tr>
                            <th>人名</th>
                            <th>內文</th>
                            <th class="number">按讚</th>
                            <th>時間</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($comments['comments'] as $comment)
                            <tr>
                                <td>{{ $comment['author_name'] }}</td>
                                <td class="comment-text">{{ $comment['text'] }}</td>
                                <td class="number">{{ number_format($comment['like_count']) }}</td>
                                <td>{{ $comment['published_at'] }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @else
                <div class="empty">沒有留言文本。</div>
            @endif
@endsection
