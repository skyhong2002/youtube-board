<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $title }} - YouTube Board</title>
        <style>
            :root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --hot: #b42318; --warm: #fef0c7; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1320px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .switcher { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .switcher { gap: 8px; margin-bottom: 14px; }
            .switcher a { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 980px; border-collapse: collapse; }
            th, td { padding: 7px 9px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); vertical-align: middle; text-align: right; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            th:first-child { left: 0; z-index: 2; text-align: left; }
            td:first-child { position: sticky; left: 0; background: var(--surface); text-align: left; font-weight: 700; }
            tbody tr:hover td { background: #f9fbfd; }
            tbody tr:hover td.hot { background: #fee4e2; }
            .number { font-variant-numeric: tabular-nums; white-space: nowrap; }
            .cell-meta { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; }
            .hot { background: #fff4ed; color: var(--hot); font-weight: 700; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            tfoot th, tfoot td { background: #f2f4f7; font-weight: 700; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
        </style>
    </head>
    <body>
        <main>
            @php
                $query = request()->query();
                $periodQuery = $query;
                unset($periodQuery['days'], $periodQuery['from'], $periodQuery['to'], $periodQuery['today']);
                $maxCell = max(1, collect($rows)->flatMap(fn ($row) => collect($row['cells'])->pluck('views'))->max() ?? 1);
            @endphp

            <header>
                <div>
                    <nav class="nav">
                        <a href="{{ route('home') }}">YouTube Board</a>
                        <a href="{{ route('live.current') }}">現在正直播排行</a>
                        <a href="{{ route('live.continuous') }}">現在帶狀直播排行</a>
                        <a href="{{ route('live.days.index') }}">單日直播排行</a>
                        <a href="{{ route('live.periods') }}">期間直播排行</a>
                        <a href="{{ route('live.channels') }}">直播頻道排行</a>
                        <a href="{{ route('live.trends.daily') }}">直播趨勢</a>
                    </nav>
                    <h1>{{ $title }}</h1>
                </div>
                <div class="meta">{{ $period['from'] }} - {{ $period['to'] }} · {{ $generatedAt }}</div>
            </header>

            <nav class="switcher" aria-label="日期範圍">
                @foreach ([3 => '三天', 7 => '一週', 14 => '兩週', 30 => '一月'] as $days => $label)
                    <a class="{{ $period['mode'] === 'days' && (int) $period['days'] === $days ? 'active' : '' }}" href="{{ route('live.hours', $periodQuery + ['days' => $days]) }}">{{ $label }}</a>
                @endforeach
            </nav>

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
                            <th scope="col">日期</th>
                            @foreach ($dates as $date)
                                <th scope="col">{{ $date }}</th>
                            @endforeach
                            <th scope="col">合計</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td>{{ (int) $row['hour'] }} 時</td>
                                @foreach ($dates as $date)
                                    @php
                                        $cell = $row['cells'][$date] ?? ['views' => 0, 'videos' => 0];
                                        $isHot = $cell['views'] > 0 && $cell['views'] >= $maxCell * 0.55;
                                    @endphp
                                    <td class="number {{ $isHot ? 'hot' : '' }}">
                                        {{ $cell['views'] > 0 ? number_format($cell['views']) : '-' }}
                                        @if ($cell['videos'] > 0)
                                            <span class="cell-meta">{{ number_format($cell['videos']) }} 部</span>
                                        @endif
                                    </td>
                                @endforeach
                                <td class="number">{{ $row['views'] > 0 ? number_format($row['views']) : '-' }}</td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="{{ count($dates) + 2 }}">
                                    {{ $dataAvailable ? '目前沒有符合條件的直播小時資料。' : '本機尚未匯入 legacy live log tables。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                    @if ($rows !== [])
                        <tfoot>
                            <tr>
                                <th>合計</th>
                                @foreach ($dates as $date)
                                    <td class="number">
                                        {{ ($totals[$date]['views'] ?? 0) > 0 ? number_format($totals[$date]['views']) : '-' }}
                                        @if (($totals[$date]['videos'] ?? 0) > 0)
                                            <span class="cell-meta">{{ number_format($totals[$date]['videos']) }} 部</span>
                                        @endif
                                    </td>
                                @endforeach
                                <td class="number">{{ number_format(collect($totals)->sum('views')) }}</td>
                            </tr>
                        </tfoot>
                    @endif
                </table>
            </div>
        </main>
    </body>
</html>
