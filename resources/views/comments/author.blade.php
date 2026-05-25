<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ ($author['display_name'] ?? $author_key) }} 的留言 - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .stats, .filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .stat, .filters li, .badge { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .meta, .muted { color: var(--muted); }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .panel { padding: 16px; border: 1px solid var(--line); background: var(--surface); }
            .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
            .hour-grid { display: grid; grid-template-columns: repeat(24, minmax(26px, 1fr)); gap: 4px; align-items: end; min-height: 150px; padding: 12px; border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
            .bar-wrap { display: grid; grid-template-rows: 1fr auto; gap: 6px; min-width: 26px; height: 128px; text-align: center; color: var(--muted); font-size: 11px; }
            .bar { align-self: end; min-height: 2px; border-radius: 3px 3px 0 0; background: var(--accent); }
            .empty { padding: 22px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); }
            table { width: 100%; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .comment-text { max-width: 560px; }
            .thumb { width: 96px; height: 72px; object-fit: cover; background: #eef2f6; }
            @media (max-width: 860px) { main { padding: 16px; } header { display: block; } .grid { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('tags.comments.index') }}">標籤近期留言</a>
                        <a href="{{ route('keywords.index') }}">關鍵字</a>
                    </nav>
                    <h1>{{ ($author['display_name'] ?? $author_key) }} 的留言</h1>
                </div>
                <div class="meta">{{ $generated_at }}</div>
            </header>

            <ul class="filters" aria-label="Legacy filters">
                <li>lookup={{ $filters['lookup'] }}</li>
                <li>hours={{ $filters['hours'] }}</li>
                <li>limit={{ $filters['limit'] }}</li>
                @if ($author)
                    <li>author_id={{ $author['author_id'] }}</li>
                    <li>ChannelId={{ $author['channel_id'] }}</li>
                @else
                    <li>author={{ $author_key }}</li>
                @endif
            </ul>

            @if (! $data_available)
                <section class="panel">
                    <p class="notice">Data unavailable locally. {{ $blocked_reason }}</p>
                    <p class="muted">Legacy source: {{ $legacy_file }}. Laravel 不會觸發 comment ingestion 或寫入 legacy cache。</p>
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

            <div class="stats">
                <span class="stat">影片 rows {{ number_format($summary['video_rows']) }}</span>
                <span class="stat">留言 {{ number_format($summary['comment_count']) }}</span>
                <span class="stat">回應 {{ number_format($summary['reply_count']) }}</span>
                <span class="stat">頻道 {{ number_format($summary['channel_count']) }}</span>
                <span class="stat">符合留言 {{ number_format($summary['matched_comments']) }}</span>
            </div>

            <h2>留言時間</h2>
            @php
                $maxHour = max(1, collect($hourly)->max('count') ?? 0);
            @endphp
            <div class="hour-grid" aria-label="Hourly comment chart">
                @foreach ($hourly as $point)
                    <div class="bar-wrap" title="{{ $point['hour'] }}: {{ $point['count'] }}">
                        <div class="bar" style="height: {{ max(2, (int) round($point['count'] / $maxHour * 100)) }}%"></div>
                        <span>{{ $point['hour'] }}</span>
                    </div>
                @endforeach
            </div>

            <div class="grid">
                <section>
                    <h2>留言頻道</h2>
                    @if ($channels !== [])
                        <table>
                            <thead>
                                <tr>
                                    <th>頻道</th>
                                    <th class="number">影片</th>
                                    <th class="number">留言</th>
                                    <th class="number">回應</th>
                                </tr>
                            </thead>
                            <tbody>
                                @foreach ($channels as $channel)
                                    <tr>
                                        <td><a href="{{ route('channels.show', ['u_id' => $channel['u_id']]) }}">{{ $channel['title'] }}</a></td>
                                        <td class="number">{{ number_format($channel['video_count']) }}</td>
                                        <td class="number">{{ number_format($channel['comments']) }}</td>
                                        <td class="number">{{ number_format($channel['replies']) }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    @else
                        <div class="empty">沒有可用的留言頻道統計。</div>
                    @endif
                </section>

                <section>
                    <h2>留言標籤</h2>
                    @if ($tags !== [])
                        <table>
                            <thead>
                                <tr>
                                    <th>標籤</th>
                                    <th class="number">留言影片數</th>
                                </tr>
                            </thead>
                            <tbody>
                                @foreach ($tags as $tag)
                                    <tr>
                                        <td>{{ $tag['tag_name'] }}</td>
                                        <td class="number">{{ number_format($tag['count']) }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    @else
                        <div class="empty">沒有 legacy 顯示名單內的留言標籤統計。</div>
                    @endif
                </section>
            </div>

            <h2>留言內容</h2>
            @if ($comments !== [])
                <table>
                    <thead>
                        <tr>
                            <th class="number">#</th>
                            <th>影片</th>
                            <th>內容</th>
                            <th class="number">按讚</th>
                            <th>時間</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($comments as $index => $comment)
                            <tr>
                                <td class="number"><a href="{{ route('videos.analytics', ['videoId' => $comment['video_id']]) }}">{{ $index + 1 }}</a></td>
                                <td><a href="{{ $comment['youtube_url'] }}"><img class="thumb" src="{{ $comment['thumbnail'] }}" alt=""></a></td>
                                <td class="comment-text">{{ $comment['text'] }} @if ($comment['is_reply']) <span class="muted">(reply)</span> @endif</td>
                                <td class="number">{{ number_format($comment['like_count']) }}</td>
                                <td>{{ $comment['published_at'] }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @else
                <div class="empty">沒有留言內容。</div>
            @endif
        </main>
    </body>
</html>
