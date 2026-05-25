<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $channel['title'] ?? $uId }} 基本資料 - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 26px 0 10px; font-size: 20px; }
            h3 { margin: 18px 0 8px; font-size: 16px; }
            h4 { margin: 14px 0 6px; font-size: 15px; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .meta, .muted { color: var(--muted); }
            .profile { display: grid; grid-template-columns: 120px 1fr; gap: 18px; padding: 14px; border: 1px solid var(--line); background: var(--surface); }
            .profile img { display: block; width: 120px; height: 120px; object-fit: cover; background: #d7dde6; border-radius: 50%; }
            .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
            .tag { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid #b7ded6; border-radius: 6px; background: var(--accent-bg); color: var(--accent); font-size: 12px; }
            .stats { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; }
            .stat, .panel { border: 1px solid var(--line); background: var(--surface); padding: 12px; }
            .stat .label { color: var(--muted); font-size: 12px; }
            .stat .value { margin-top: 4px; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
            table { width: 100%; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; white-space: nowrap; }
            .video-thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
            .video-thumbs img { width: 72px; height: 54px; object-fit: cover; background: #d7dde6; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 820px) {
                main { padding: 16px; }
                header, .profile { display: block; }
                .profile img { margin-bottom: 12px; }
                .stats { grid-template-columns: repeat(2, minmax(130px, 1fr)); }
            }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('live.current') }}">直播排行</a>
                        <a href="{{ route('channels.videos', ['u_id' => $uId]) }}">影片</a>
                    </nav>
                    <h1>{{ $channel['title'] ?? 'Unknown channel' }}</h1>
                    <div class="meta">頻道基本資料 · {{ $generatedAt }}</div>
                </div>
            </header>

            @if (! $channel)
                <div class="empty">{{ $dataAvailable ? '找不到此頻道。' : '本機尚未匯入 legacy channel tables。' }}</div>
            @else
                <section class="profile">
                    <a href="{{ $channel['youtube_url'] }}" rel="noreferrer">
                        @if ($channel['thumbnail'])
                            <img src="{{ $channel['thumbnail'] }}" alt="">
                        @endif
                    </a>
                    <div>
                        <h2>{{ $channel['title'] }}</h2>
                        <div class="muted">{{ $channel['youtube_id'] }}</div>
                        <div class="tags">
                            @foreach ($tags as $tag)
                                <a class="tag" href="{{ route('tags.channels', ['tagId' => $tag['id']]) }}">{{ $tag['name'] }}</a>
                            @endforeach
                        </div>
                    </div>
                </section>

                <h2>基本資料</h2>
                @if ($count)
                    <section class="stats">
                        <div class="stat"><div class="label">這週影片數</div><div class="value">{{ number_format($count['video_week']) }}</div></div>
                        <div class="stat"><div class="label">這月影片數</div><div class="value">{{ number_format($count['video_month']) }}</div></div>
                        <div class="stat"><div class="label">這週觀看次數</div><div class="value">{{ number_format($count['view_week']) }}</div></div>
                        <div class="stat"><div class="label">這月觀看次數</div><div class="value">{{ number_format($count['view_month']) }}</div></div>
                        <div class="stat"><div class="label">觀看成長幅度</div><div class="value">{{ $count['growth_percent'] !== null ? number_format($count['growth_percent'], 1).'%' : 'n/a' }}</div></div>
                        <div class="stat"><div class="label">這週訂閱數</div><div class="value">{{ number_format($count['sub_week']) }}</div></div>
                        <div class="stat"><div class="label">這月訂閱數</div><div class="value">{{ number_format($count['sub_month']) }}</div></div>
                        <div class="stat"><div class="label">平均每片週觀看</div><div class="value">{{ $count['tv_rating_base'] !== null ? number_format($count['tv_rating_base']) : 'n/a' }}</div></div>
                    </section>
                @else
                    <div class="empty">找不到此頻道的 urt_count 統計資料。</div>
                @endif

                <h2>頻道趨勢</h2>
                <section class="panel">
                    @if ($trendAvailable)
                        <span class="muted">已偵測到 `urt_log` 資料；頻道趨勢圖會在後續 channel trend slice 補上。</span>
                    @else
                        <span class="muted">本機 `urt_log` 目前沒有可用資料，先不顯示趨勢圖。</span>
                    @endif
                </section>

                <h2>AI 摘要</h2>
                @if ($ai['daily'])
                    <section class="panel">
                        <h3>{{ $ai['daily']['date_from'] }}{{ $ai['daily']['date_from'] !== $ai['daily']['date_to'] ? ' ~ '.$ai['daily']['date_to'] : '' }} 主要新聞</h3>
                        <div class="muted">事件總數：{{ count($ai['daily']['topics']) }} / 播報週期：{{ $ai['daily']['data_type'] }} @if ($ai['daily']['video_count'] !== null) / 影片總數：{{ number_format($ai['daily']['video_count']) }} @endif</div>
                        @foreach (array_slice($ai['daily']['topics'], 0, 10) as $topic)
                            <h4>※ {{ $topic['title'] }}</h4>
                            <p>{{ $topic['description'] }}</p>
                            <table>
                                <tr><th>關鍵字</th><td>{{ implode(' ', $topic['keywords']) }}</td></tr>
                                <tr><th>人物</th><td>{{ implode(' ', $topic['people']) }}</td></tr>
                                <tr>
                                    <th>影片</th>
                                    <td>
                                        <div class="video-thumbs">
                                            @foreach (array_slice($topic['video_ids'], 0, 7) as $topicVideoId)
                                                <a href="https://www.youtube.com/watch?v={{ $topicVideoId }}" rel="noreferrer"><img src="https://i.ytimg.com/vi/{{ $topicVideoId }}/default.jpg" alt=""></a>
                                            @endforeach
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        @endforeach
                    </section>
                @else
                    <div class="panel muted">沒有可用的 daily channel AI 摘要。</div>
                @endif

                @if ($ai['topic'])
                    <section class="panel">
                        <h3>最近主題</h3>
                        <ul>
                            @foreach (array_slice($ai['topic']['items'], 0, 12) as $topic)
                                <li><strong>{{ $topic['title'] }}</strong>：{{ $topic['description'] }}</li>
                            @endforeach
                        </ul>
                    </section>
                @endif

                @if ($ai['people'])
                    <section class="panel">
                        <h3>最近提及人物</h3>
                        <table>
                            <thead><tr><th>人物</th><th>評價</th><th>內容</th><th>分數</th></tr></thead>
                            <tbody>
                                @foreach (array_slice($ai['people']['items'], 0, 20) as $person)
                                    <tr>
                                        <th>{{ $person['name'] }}</th>
                                        <td>{{ $person['evaluation'] }}</td>
                                        <td>{{ $person['content'] }}</td>
                                        <td>{{ $person['score'] }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </section>
                @endif

                @if ($ai['aspect'])
                    <section class="panel">
                        <h3>觀點角度</h3>
                        <table>
                            <thead><tr><th>項目</th><th>偏好度</th><th>描述</th></tr></thead>
                            <tbody>
                                @foreach ($ai['aspect'] as $aspect)
                                    <tr>
                                        <th>{{ $aspect['item'] }}</th>
                                        <td>{{ $aspect['preference'] }}</td>
                                        <td>{{ $aspect['description'] }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </section>
                @endif
            @endif
        </main>
    </body>
</html>
