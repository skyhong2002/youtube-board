<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $title }} - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 22px 0 10px; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; font-size: 12px; color: #344054; white-space: nowrap; }
            td.number { text-align: right; white-space: nowrap; }
            .nav, .switcher, .filters, .stats { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters li, .stat { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            .table-wrap { overflow-x: auto; border-radius: 8px; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } th, td { padding: 7px; } }
        </style>
    </head>
    <body>
        <main>
            @php
                $query = request()->query();
                $conditionQuery = $query;
                unset($conditionQuery['condition']);
                $monthQuery = $query;
                unset($monthQuery['month'], $monthQuery['from'], $monthQuery['to']);
            @endphp

            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('ai.days.index') }}">每日主要事件</a>
                        <a href="{{ route('ai.hours') }}">今日每小時</a>
                        <a href="{{ route('ai.aspects') }}">立場分布</a>
                    </nav>
                    <h1>{{ $title }}</h1>
                </div>
                <div class="meta">{{ $range['from'] }} - {{ $range['to'] }} · {{ $generated_at }}</div>
            </header>

            <nav class="switcher" aria-label="條件">
                @foreach (['all' => '全部', 'green' => '泛綠', 'blue' => '泛藍', 'neutral' => '較無偏', 'finance' => '財經', 'world' => '世界'] as $key => $label)
                    <a class="{{ $condition === $key ? 'active' : '' }}" href="{{ route('ai.periods', $conditionQuery + ['condition' => $key]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="月份">
                @foreach ([now('Asia/Taipei')->format('Y-m'), now('Asia/Taipei')->subMonth()->format('Y-m')] as $month)
                    <a class="{{ $range['month'] === $month ? 'active' : '' }}" href="{{ route('ai.periods', $monthQuery + ['month' => $month]) }}">{{ $month }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            <section class="stats" aria-label="Period stats">
                <div class="stat">事件 {{ number_format($rows_count) }}</div>
                <div class="stat">read-only period summary</div>
                <div class="stat">no cache writeback</div>
            </section>

            @if (! $available)
                <h2>Unavailable</h2>
                <div class="empty">本機尚未匯入 `urt_ai_date` 或必要 AI tables。</div>
            @elseif ($topics === [])
                <h2>Unavailable</h2>
                <div class="empty">這個期間目前沒有可用的每日 AI topic cache。legacy 會呼叫 `api/api_topic.php` 補寫 cache；Laravel 目前只讀取既有資料。</div>
            @else
                <h2>期間事件</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>編號</th>
                                <th>事件</th>
                                <th>日期</th>
                                <th>媒體事件數</th>
                                <th>影片數</th>
                                <th>關鍵字數</th>
                                <th>最重要人</th>
                                <th>次數</th>
                                <th>最重要事</th>
                                <th>次數</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($topics as $index => $topic)
                                <tr>
                                    <td class="number">{{ $index + 1 }}</td>
                                    <td><a href="{{ route('ai.events.show', ['id' => $topic['row_pk'], 'event' => $topic['event']]) }}">{{ $topic['event'] }}</a></td>
                                    <td>{{ $topic['date'] }}</td>
                                    <td class="number">{{ number_format($topic['media_count']) }}</td>
                                    <td class="number">{{ number_format($topic['video_count']) }}</td>
                                    <td class="number">{{ number_format($topic['keyword_count']) }}</td>
                                    <td>{{ $topic['top_person'] ?: '-' }}</td>
                                    <td class="number">{{ number_format($topic['top_person_count']) }}</td>
                                    <td>{{ $topic['top_keyword'] ?: '-' }}</td>
                                    <td class="number">{{ number_format($topic['top_keyword_count']) }}</td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @endif
        </main>
    </body>
</html>
