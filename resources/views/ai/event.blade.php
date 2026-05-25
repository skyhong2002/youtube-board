<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $title }} - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #f2f4f7; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 20px; }
            h3 { margin: 16px 0 8px; font-size: 16px; }
            .nav, .chips { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
            .tabs a { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .tabs a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); max-width: 220px; text-align: right; }
            .notice { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .event-block, .people-block { margin: 0 0 16px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .desc { color: var(--muted); line-height: 1.6; }
            .chip { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 7px; border-radius: 6px; background: var(--chip); color: #344054; font-size: 12px; }
            .chip.hot { background: var(--accent-bg); color: var(--accent); }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            ul { margin: 8px 0 0 20px; padding: 0; }
            li { margin-bottom: 6px; }
            .person { padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: #f9fbfd; }
            .person strong { display: block; margin-bottom: 4px; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 980px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; max-width: none; text-align: left; } .grid { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('ai.days.index') }}">每日主要事件</a>
                        <a href="{{ route('ai.hours') }}">今日每小時</a>
                        @if ($date)
                            <a href="{{ route('ai.days.date', ['date' => $date]) }}">{{ $date }}</a>
                        @endif
                    </nav>
                    <h1>{{ $title }}</h1>
                </div>
                <div class="meta">aipk={{ $aipk }} · {{ $generated_at }}</div>
            </header>

            <nav class="tabs" aria-label="事件頁面">
                <a class="active" href="{{ route('ai.events.show', ['id' => $aipk, 'event' => $event]) }}">事件分析</a>
                <a href="{{ route('ai.events.people', ['id' => $aipk, 'event' => $event]) }}">人物觀點</a>
                <a href="{{ route('ai.events.wall', ['id' => $aipk, 'event' => $event]) }}">影片牆</a>
            </nav>

            @if (! $available)
                <p class="notice">本機尚未匯入 legacy AI event tables。</p>
            @elseif (! $has_event_ai)
                <p class="notice">這個 daily topic 目前沒有對應的 `urt_ai_event` summary/people 內容；先顯示可用的事件入口，歷史追蹤待 `urt_ai_period` dump 後補齊。</p>
            @endif

            @if (! $history_available)
                <p class="notice">Legacy event history relies on `urt_ai_period` and `api_topic.php`; local dump does not currently include populated `urt_ai_period`, so 逐日事件線先標示 unavailable。</p>
            @endif

            <h2>事件分析</h2>
            @forelse ($summary_events as $summary)
                <section class="event-block">
                    <h3>{{ $summary['event'] }}</h3>
                    @if ($summary['description'] !== '')
                        <p class="desc">{{ $summary['description'] }}</p>
                    @endif
                    <div class="chips">
                        @foreach ($summary['keywords'] as $keyword)
                            <span class="chip hot">{{ $keyword }}</span>
                        @endforeach
                        @foreach ($summary['media'] as $media)
                            <span class="chip">{{ $media }}</span>
                        @endforeach
                    </div>

                    @if ($summary['facts'] !== [])
                        <h3>事實</h3>
                        <ul>
                            @foreach ($summary['facts'] as $fact)
                                <li>{{ $fact['media'] }} / {{ $fact['headline'] }}
                                    @if ($fact['video_id'] !== '')
                                        <a href="https://youtu.be/{{ $fact['video_id'] }}" target="_blank" rel="noreferrer">{{ $fact['video_id'] }}</a>
                                    @endif
                                </li>
                            @endforeach
                        </ul>
                    @endif

                    @if ($summary['opinions'] !== [])
                        <h3>觀點</h3>
                        <ul>
                            @foreach ($summary['opinions'] as $opinion)
                                <li>{{ $opinion['media'] }} / 角度: {{ $opinion['stance'] }} / 強度: {{ $opinion['intensity'] }} / {{ $opinion['content'] }}
                                    @if ($opinion['video_id'] !== '')
                                        <a href="https://youtu.be/{{ $opinion['video_id'] }}" target="_blank" rel="noreferrer">{{ $opinion['video_id'] }}</a>
                                    @endif
                                </li>
                            @endforeach
                        </ul>
                    @endif
                </section>
            @empty
                <div class="empty">目前沒有 event summary JSON。</div>
            @endforelse

            @if ($people)
                <h2>人物觀點 @if ($people['main_subject'] !== '') <span class="desc">主體角色：{{ $people['main_subject'] }}</span> @endif</h2>
                @foreach (['supporting' => '支持者', 'opposing' => '反對者', 'other' => '其他'] as $section => $label)
                    @if ($people[$section] !== [])
                        <h3>{{ $label }}</h3>
                        <div class="grid">
                            @foreach ($people[$section] as $person)
                                <div class="person">
                                    <strong>{{ $person['person'] }}</strong>
                                    <div class="desc">{{ $person['role'] }} · {{ $person['stance'] }} · {{ $person['strength'] }}</div>
                                    <div>{{ $person['description'] }}</div>
                                    @if ($person['video_id'] !== '')
                                        <a href="https://youtu.be/{{ $person['video_id'] }}" target="_blank" rel="noreferrer">{{ $person['media'] }} · {{ $person['video_id'] }}</a>
                                    @endif
                                </div>
                            @endforeach
                        </div>
                    @endif
                @endforeach
            @endif
        </main>
    </body>
</html>
