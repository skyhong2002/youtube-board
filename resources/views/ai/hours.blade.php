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
            main { max-width: 1360px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 28px 0 10px; font-size: 20px; }
            .nav, .switcher, .filters, .chips { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters span, .chip { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { margin: 0 0 16px; }
            .filters span { color: var(--muted); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1040px; border-collapse: collapse; }
            th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .event { min-width: 260px; }
            .event strong { display: block; margin-bottom: 5px; font-size: 15px; }
            .desc { color: var(--muted); line-height: 1.55; }
            .chip { background: var(--chip); border-color: transparent; margin: 0 4px 4px 0; }
            .thumb { display: block; width: 154px; aspect-ratio: 16 / 9; object-fit: cover; border: 1px solid var(--line); background: #eef2f6; }
            .video-link { display: inline-flex; flex-direction: column; gap: 5px; color: #344054; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            .notice { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } table { min-width: 900px; } }
        </style>
    </head>
    <body>
        <main>
            @php
                $query = request()->query();
                $dateForNav = $date ?: now('Asia/Taipei')->format('Y-m-d');
                $prevDate = \Carbon\CarbonImmutable::parse($dateForNav, 'Asia/Taipei')->subDay()->format('Y-m-d');
                $nextDate = \Carbon\CarbonImmutable::parse($dateForNav, 'Asia/Taipei')->addDay()->format('Y-m-d');
                $conditionQuery = $query;
                unset($conditionQuery['condition']);
            @endphp

            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('live.current') }}">直播排行</a>
                        <a href="{{ route('ai.hours') }}">今日每小時</a>
                        <a href="{{ route('ops.ingestion') }}">Ingestion</a>
                    </nav>
                    <h1>{{ $title }}</h1>
                </div>
                <div class="meta">{{ $rows_count }} rows · {{ $generated_at }}</div>
            </header>

            <nav class="switcher" aria-label="日期">
                <a href="{{ route('ai.hours', $query + ['date' => $prevDate]) }}">{{ $prevDate }}</a>
                @if ($date)
                    <a class="active" href="{{ route('ai.hours', $query + ['date' => $date]) }}">{{ $date }}</a>
                @endif
                <a href="{{ route('ai.hours', $query + ['date' => $nextDate]) }}">{{ $nextDate }}</a>
            </nav>

            <nav class="switcher" aria-label="條件">
                @foreach (['all' => '全部', 'green' => '泛綠', 'blue' => '泛藍', 'neutral' => '較無偏', 'finance' => '財經', 'world' => '世界'] as $conditionKey => $label)
                    <a class="{{ $condition === $conditionKey ? 'active' : '' }}" href="{{ route('ai.hours', $conditionQuery + ['condition' => $conditionKey]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <div class="filters" aria-label="Legacy filters">
                <span>condition={{ $condition }}</span>
                <span>limit={{ $limit }}</span>
                @if ($date)
                    <span>date={{ $date }}</span>
                @endif
            </div>

            @if (! $available)
                <p class="notice">本機尚未匯入 legacy AI hourly table。</p>
            @endif

            @forelse ($hours as $hour)
                <h2>{{ $date }} {{ (int) $hour['hour'] }}時</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>編號</th>
                                <th>事件</th>
                                <th>影片數</th>
                                <th>分類</th>
                                <th>角度 / 陣營</th>
                                <th>關鍵字</th>
                                <th>人物 / 地名</th>
                                <th>影片</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($hour['topics'] as $index => $topic)
                                <tr>
                                    <td class="number">{{ $index + 1 }}</td>
                                    <td class="event">
                                        <strong>{{ $topic['event'] }}</strong>
                                        @if ($topic['description'] !== '')
                                            <div class="desc">{{ $topic['description'] }}</div>
                                        @endif
                                    </td>
                                    <td class="number">{{ number_format($topic['video_count']) }}</td>
                                    <td>{{ $topic['category'] !== '' ? $topic['category'] : '-' }}</td>
                                    <td>
                                        @if ($topic['angle'] !== '')
                                            <span class="chip">{{ $topic['angle'] }}</span>
                                        @endif
                                        @if ($topic['camp'] !== '')
                                            <span class="chip">{{ $topic['camp'] }}</span>
                                        @endif
                                    </td>
                                    <td>
                                        @forelse (array_slice($topic['keywords'], 0, 8) as $keyword)
                                            <span class="chip">{{ $keyword }}</span>
                                        @empty
                                            <span class="desc">-</span>
                                        @endforelse
                                    </td>
                                    <td>
                                        @foreach (array_slice(array_merge($topic['people'], $topic['places']), 0, 8) as $name)
                                            <span class="chip">{{ $name }}</span>
                                        @endforeach
                                    </td>
                                    <td>
                                        @if ($topic['first_video_id'])
                                            <a class="video-link" href="https://www.youtube.com/watch?v={{ $topic['first_video_id'] }}" target="_blank" rel="noreferrer">
                                                <img class="thumb" src="https://i.ytimg.com/vi/{{ $topic['first_video_id'] }}/mqdefault.jpg" alt="{{ $topic['event'] }}">
                                                <span>{{ $topic['first_video_id'] }}</span>
                                            </a>
                                        @else
                                            <span class="desc">-</span>
                                        @endif
                                    </td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>
            @empty
                <div class="table-wrap">
                    <div class="empty">{{ $available ? '目前沒有符合條件的每小時 AI 摘要。' : '本機尚未匯入 legacy AI hourly table。' }}</div>
                </div>
            @endforelse
        </main>
    </body>
</html>
