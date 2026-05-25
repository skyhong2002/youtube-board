<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $title }} - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #eef2f6; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 0 0 10px; font-size: 20px; }
            h3 { margin: 0 0 6px; font-size: 16px; }
            .nav, .tabs, .chips { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .tabs { margin: 0 0 18px; }
            .tabs a, .chip, .score { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border-radius: 6px; background: var(--chip); color: #344054; font-size: 12px; }
            .tabs a { border: 1px solid var(--line); background: var(--surface); }
            .tabs a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); max-width: 360px; text-align: right; }
            .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
            section, aside { margin: 0 0 16px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .item { padding: 12px 0; border-top: 1px solid var(--line); }
            .item:first-of-type { border-top: 0; padding-top: 0; }
            .desc { color: var(--muted); line-height: 1.65; margin: 4px 0 0; }
            .section-meta { color: var(--muted); font-size: 12px; margin-bottom: 12px; }
            .prompt { margin: 0; padding-left: 20px; color: #344054; line-height: 1.65; }
            .prompt li { margin: 0 0 8px; }
            .score { background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .notice, .empty { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 860px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; max-width: none; } .layout { grid-template-columns: 1fr; } }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        @if ($channel)
                            <a href="{{ route('channels.show', ['u_id' => $channel['u_id']]) }}">頻道基本資料</a>
                            <a href="{{ route('channels.videos', ['u_id' => $channel['u_id']]) }}">頻道影片</a>
                            <a href="{{ route('channels.ai.days', ['u_id' => $channel['u_id']]) }}">每日重點</a>
                        @endif
                    </nav>
                    <h1>{{ $title }}</h1>
                </div>
                <div class="meta">{{ $generated_at }}</div>
            </header>

            @if ($channel)
                <nav class="tabs" aria-label="頻道頁面">
                    <a href="{{ route('channels.show', ['u_id' => $channel['u_id']]) }}">基本資料</a>
                    <a href="{{ route('channels.ai.days', ['u_id' => $channel['u_id']]) }}">每日重點</a>
                    <a href="{{ route('channels.people', ['u_id' => $channel['u_id']]) }}">人物</a>
                    <a href="{{ route('channels.prompt', ['u_id' => $channel['u_id']]) }}">Prompt</a>
                    <a class="active" href="{{ route('channels.ai', ['u_id' => $channel['u_id']]) }}">GPT / AI</a>
                </nav>
            @endif

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_channel_ai`。</p>
            @endif

            <div class="layout">
                <div>
                    <section>
                        <h2>討論主題</h2>
                        @if ($topic)
                            <div class="section-meta">pk {{ $topic['row']['pk'] }} · {{ $topic['row']['ai_type'] ?: 'legacy ai' }}</div>
                            @forelse ($topic['items'] as $item)
                                <article class="item">
                                    <h3>{{ $item['title'] }}</h3>
                                    @if ($item['strength'] !== '')
                                        <span class="chip">{{ $item['strength'] }}</span>
                                    @endif
                                    @if ($item['content'] !== '')
                                        <p class="desc">{{ $item['content'] }}</p>
                                    @endif
                                </article>
                            @empty
                                <p class="empty">這筆 topic JSON 沒有可解析的主題欄位。</p>
                            @endforelse
                        @else
                            <p class="empty">目前沒有 topic 類型的頻道 AI 資料。</p>
                        @endif
                    </section>

                    <section>
                        <h2>人物評價</h2>
                        @if ($people)
                            <div class="section-meta">pk {{ $people['row']['pk'] }} · {{ $people['row']['ai_type'] ?: 'legacy ai' }}</div>
                            @forelse ($people['items'] as $person)
                                <article class="item">
                                    <h3>{{ $person['name'] }}</h3>
                                    <div class="chips">
                                        @if ($person['role'] !== '') <span class="chip">{{ $person['role'] }}</span> @endif
                                        @if ($person['evaluation'] !== '') <span class="chip">{{ $person['evaluation'] }}</span> @endif
                                        @if ($person['score'] !== null) <span class="score">{{ $person['score'] }}/10</span> @endif
                                    </div>
                                    @if ($person['content'] !== '')
                                        <p class="desc">{{ $person['content'] }}</p>
                                    @endif
                                </article>
                            @empty
                                <p class="empty">這筆 people JSON 沒有可解析的人物欄位。</p>
                            @endforelse
                        @else
                            <p class="empty">目前沒有 people 類型的頻道 AI 資料。</p>
                        @endif
                    </section>

                    <section>
                        <h2>立場角度</h2>
                        @if ($aspect)
                            <div class="section-meta">pk {{ $aspect['row']['pk'] }} · {{ $aspect['row']['ai_type'] ?: 'legacy ai' }}</div>
                            @forelse ($aspect['items'] as $group)
                                <article class="item">
                                    <h3>{{ $group['name'] }}</h3>
                                    @foreach ($group['items'] as $aspectItem)
                                        <div class="item">
                                            <div class="chips">
                                                <span class="chip">{{ $aspectItem['item'] }}</span>
                                                @if ($aspectItem['preference'] !== null) <span class="score">{{ $aspectItem['preference'] }}/10</span> @endif
                                            </div>
                                            @if ($aspectItem['description'] !== '')
                                                <p class="desc">{{ $aspectItem['description'] }}</p>
                                            @endif
                                        </div>
                                    @endforeach
                                </article>
                            @empty
                                <p class="empty">這筆 aspect JSON 沒有可解析的立場欄位。</p>
                            @endforelse
                        @else
                            <p class="empty">目前沒有 aspect 類型的頻道 AI 資料。</p>
                        @endif
                    </section>
                </div>

                <aside>
                    <h2>GPT Prompt</h2>
                    <ol class="prompt">
                        @foreach ($prompt as $line)
                            <li>{{ $line }}</li>
                        @endforeach
                    </ol>
                </aside>
            </div>
        </main>
    </body>
</html>
