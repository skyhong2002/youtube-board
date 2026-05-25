<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>關鍵字列表 - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .notice { margin: 0 0 16px; color: var(--muted); }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1040px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .keyword { min-width: 220px; font-weight: 700; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
        </style>
    </head>
    <body>
        <main>
            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('tags.index') }}">頻道標籤列表</a>
                        <a href="{{ route('live.current') }}">直播排行</a>
                    </nav>
                    <h1>關鍵字列表</h1>
                </div>
                <div class="meta">{{ count($rows) }} 筆 · sort={{ $sort }} · {{ $generatedAt }}</div>
            </header>

            @unless ($cachedMetricsAvailable)
                <p class="notice">本機 `urt_show_data.tags_all` 尚無快取，因此影片數、觀看數、成長欄位先以空值呈現。</p>
            @endunless

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ is_array($value) ? implode(',', $value) : $value }}</li>
                    @endforeach
                </ul>
            @endif

            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>Tag</th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'hours_count']) }}">持續性</a></th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'max_count']) }}">極值</a></th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'max_hours']) }}">最熱日期</a></th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'weight']) }}">權重</a></th>
                            <th>影片數</th>
                            <th>觀看數</th>
                            <th>成長</th>
                            <th>觀看角度</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank">{{ $row['rank'] }}</td>
                                <td class="keyword">
                                    <a href="https://www.youtube.com/results?search_query={{ urlencode($row['tag']) }}&sp=CAI%253D" rel="noreferrer">{{ $row['tag'] }}</a>
                                </td>
                                <td class="number">{{ number_format($row['hours_count']) }}</td>
                                <td class="number">{{ number_format($row['max_count']) }}</td>
                                <td class="number">{{ substr($row['max_hours'], 0, 10) }}</td>
                                <td class="number">{{ number_format($row['weight_score']) }}</td>
                                <td class="number">{{ $row['video_count'] !== null ? number_format($row['video_count']) : '-' }}</td>
                                <td class="number">{{ $row['views'] !== null ? number_format($row['views']) : '-' }}</td>
                                <td class="number">
                                    @if ($row['growth_percent'] !== null)
                                        {{ number_format($row['growth_percent'], 2) }}%
                                    @else
                                        -
                                    @endif
                                </td>
                                <td><a href="/tag_group.php?tag={{ urlencode($row['tag']) }}&view=all">資訊</a></td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="10">
                                    {{ $dataAvailable ? '目前沒有符合條件的關鍵字資料。' : '本機尚未匯入 legacy tags table。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
        </main>
    </body>
</html>
