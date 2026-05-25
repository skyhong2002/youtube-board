<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $title }} 影片牆 - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #f2f4f7; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 0 0 8px; font-size: 15px; line-height: 1.35; }
            .nav, .tabs { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .tabs { margin: 0 0 16px; }
            .tabs a, .chip { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border-radius: 6px; background: var(--chip); color: #344054; }
            .tabs a { border: 1px solid var(--line); background: var(--surface); }
            .tabs a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta, .desc { color: var(--muted); }
            .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
            .video { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); overflow: hidden; }
            .video img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #eef2f6; }
            .body { padding: 10px; }
            .chip { min-height: 22px; padding: 2px 7px; font-size: 12px; }
            .empty, .notice { margin: 0 0 16px; padding: 16px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); }
            .notice { border-color: #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 1000px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
            @media (max-width: 620px) { main { padding: 16px; } header { display: block; } .grid { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('ai.days.index') }}">每日主要事件</a>
                        @if ($date)<a href="{{ route('ai.days.date', ['date' => $date]) }}">{{ $date }}</a>@endif
                    </nav>
                    <h1>{{ $title }} 影片牆</h1>
                </div>
                <div class="meta">aipk={{ $aipk }} · {{ count($videos) }} videos · {{ $generated_at }}</div>
            </header>

            <nav class="tabs" aria-label="事件頁面">
                <a href="{{ route('ai.events.show', ['id' => $aipk, 'event' => $event]) }}">事件分析</a>
                <a href="{{ route('ai.events.people', ['id' => $aipk, 'event' => $event]) }}">人物觀點</a>
                <a class="active" href="{{ route('ai.events.wall', ['id' => $aipk, 'event' => $event]) }}">影片牆</a>
            </nav>

            @if (! $history_available)
                <p class="notice">Legacy wall 的逐日追蹤需要 `urt_ai_period`；{{ $history['blocked_reason'] ?? '目前先從 `urt_ai_event` summary/people JSON 顯示可驗證影片' }}。</p>
            @endif

            @if ($videos !== [])
                <section class="grid" aria-label="事件影片">
                    @foreach ($videos as $video)
                        <article class="video">
                            <a href="https://www.youtube.com/watch?v={{ $video['video_id'] }}" target="_blank" rel="noreferrer">
                                <img src="https://i.ytimg.com/vi/{{ $video['video_id'] }}/mqdefault.jpg" alt="{{ $video['label'] }}">
                            </a>
                            <div class="body">
                                <h2>{{ $video['label'] ?: $video['video_id'] }}</h2>
                                <div class="desc">{{ $video['media'] ?: 'YouTube' }}</div>
                                <span class="chip">{{ $video['source'] }}</span>
                            </div>
                        </article>
                    @endforeach
                </section>
            @else
                <div class="empty">目前沒有可從 event JSON 擷取的影片。</div>
            @endif
        </main>
    </body>
</html>
