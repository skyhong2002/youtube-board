<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $channel['title'] ?? 'Channel' }} {{ $section['title'] }} - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --warn: #b54708; --warn-bg: #fff8e6; --chip: #f2f4f7; --blocked: #b42318; --blocked-bg: #fee4e2; --ok: #0f766e; --ok-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1040px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .tabs a, .badge { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .tabs a.active { border-color: #f7d58b; background: var(--warn-bg); color: var(--warn); font-weight: 700; }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); }
            .meta { color: var(--muted); text-align: right; }
            .panel { padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .notice { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .channel { display: flex; align-items: center; gap: 12px; }
            .channel img { width: 48px; height: 48px; border-radius: 8px; object-fit: cover; border: 1px solid var(--line); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; } }
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
                        @endif
                    </nav>
                    <h1>{{ $section['title'] }}</h1>
                </div>
                <div class="meta">{{ $generated_at }}</div>
            </header>

            @if ($channel)
                <div class="channel">
                    @if ($channel['thumbnail'])
                        <img src="{{ $channel['thumbnail'] }}" alt="{{ $channel['title'] }}">
                    @endif
                    <div>
                        <strong>{{ $channel['title'] }}</strong>
                        <div class="meta">u_id={{ $channel['u_id'] }}</div>
                    </div>
                </div>
            @endif

            @if ($channel)
                <nav class="tabs" aria-label="Channel subpages">
                    <a class="{{ $section['key'] === 'comments' ? 'active' : '' }}" href="{{ route('channels.comments', ['u_id' => $channel['u_id']]) }}">留言</a>
                    <a class="{{ $section['key'] === 'cloud' ? 'active' : '' }}" href="{{ route('channels.cloud', ['u_id' => $channel['u_id']]) }}">文字雲</a>
                    <a class="{{ $section['key'] === 'trends' ? 'active' : '' }}" href="{{ route('channels.trends', ['u_id' => $channel['u_id']]) }}">線圖</a>
                </nav>
            @endif

            <section class="panel">
                <p class="notice">Data unavailable locally. {{ $section['reason'] }}</p>
                <p>{{ $section['next_step'] }}</p>
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
                <p class="meta">Legacy source: {{ $section['legacy_file'] }}</p>
            </section>
        </main>
    </body>
</html>
