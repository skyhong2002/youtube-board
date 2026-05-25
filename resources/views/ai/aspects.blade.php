<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $title }} - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #f2f4f7; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .switcher, .filters, .tags { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters li, .tag { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { color: var(--muted); }
            .tag { border-color: transparent; background: var(--chip); }
            .meta { color: var(--muted); white-space: nowrap; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 980px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .channel { display: flex; align-items: center; gap: 10px; min-width: 260px; }
            .channel img { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: #eef2f6; }
            .channel-title { font-weight: 700; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .balance { font-weight: 800; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
        </style>
    </head>
    <body>
        <main>
            @php
                $query = request()->query();
                $conditionQuery = $query;
                unset($conditionQuery['condition'], $conditionQuery['tagid'], $conditionQuery['or'], $conditionQuery['not']);
            @endphp

            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('ai.days.index') }}">每日主要事件</a>
                        <a href="{{ route('ai.hours') }}">今日每小時</a>
                        <a href="{{ route('live.current') }}">直播排行</a>
                    </nav>
                    <h1>{{ $title }}</h1>
                </div>
                <div class="meta">{{ $generated_at }}</div>
            </header>

            <nav class="switcher" aria-label="條件">
                @foreach (['all' => '全部', 'blue' => '泛藍', 'green' => '泛綠', 'neutral' => '中立', 'finance' => '財經', 'world' => '國際'] as $condition => $label)
                    <a class="{{ request()->query('condition', 'all') === $condition ? 'active' : '' }}" href="{{ route('ai.aspects', $conditionQuery + ['condition' => $condition]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            @if (! $available)
                <div class="empty">本機尚未匯入 `urt_channel_ai` aspect 資料。</div>
            @elseif ($rows === [])
                <div class="empty">目前沒有符合條件的立場資料。</div>
            @else
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>頻道</th>
                                <th class="number">台灣立場</th>
                                <th class="number">泛綠度</th>
                                <th class="number">泛白度</th>
                                <th class="number">泛藍度</th>
                                <th class="number">泛紅度</th>
                                <th class="number">中國立場</th>
                                <th class="number">傾向</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <th>
                                        <div class="channel">
                                            @if ($row['thumbnail'])
                                                <img src="{{ $row['thumbnail'] }}" alt="{{ $row['title'] }}">
                                            @endif
                                            <div>
                                                <a class="channel-title" href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['title'] }}</a>
                                                <div class="tags">
                                                    @foreach ($row['tags'] as $tag)
                                                        <span class="tag">{{ $tag['name'] }}</span>
                                                    @endforeach
                                                </div>
                                            </div>
                                        </div>
                                    </th>
                                    @foreach (['台灣', '泛綠', '泛白', '泛藍', '泛紅', '中國'] as $name)
                                        <td class="number" title="{{ $row['descriptions'][$name] }}">{{ number_format($row['values'][$name]) }}</td>
                                    @endforeach
                                    <td class="number balance">{{ number_format($row['balance']) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endif
        </main>
    </body>
</html>
