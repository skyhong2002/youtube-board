@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $range['from'] }} - {{ $range['to'] }} · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1240px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 22px 0 10px; font-size: 18px; }
            table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; font-size: 12px; color: #344054; white-space: nowrap; }
            td.rank { width: 52px; color: var(--muted); text-align: right; }
            .nav, .switcher, .filters, .stats { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters li, .stat { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            .value { color: var(--muted); font-size: 12px; margin-top: 2px; }
            .table-wrap { overflow-x: auto; border-radius: 8px; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } th, td { padding: 7px; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                $typeQuery = $query;
                unset($typeQuery['type']);
                $dayQuery = $query;
                unset($dayQuery['days'], $dayQuery['from'], $dayQuery['to']);
                $baseRoute = $mode === 'keyword' ? 'keywords.days' : ($filters['tagid'] ?? null ? 'tags.days' : 'tags.days.index');
                $baseParams = $mode === 'keyword'
                    ? ['keyword' => $subject]
                    : (($filters['tagid'] ?? null) ? ['tagId' => (int) explode(',', (string) $filters['tagid'])[0]] : []);
            @endphp



            <nav class="switcher" aria-label="天數">
                @foreach ([1 => '一天', 3 => '三天', 7 => '一週', 10 => '十天'] as $days => $label)
                    <a class="{{ $range['display_days'] === $days ? 'active' : '' }}" href="{{ route($baseRoute, $baseParams + $dayQuery + ['days' => $days]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="類型">
                @foreach (['tags_result' => '重要度', 'tags_video' => '影片數', 'tags_views' => '觀看數'] as $key => $label)
                    <a class="{{ $type === $key ? 'active' : '' }}" href="{{ route($baseRoute, $baseParams + $typeQuery + ['type' => $key]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            <section class="stats" aria-label="Daily relation stats">
                <div class="stat">cache rows {{ number_format($cache_rows) }}</div>
                <div class="stat">{{ $diff ? 'diff ranking' : 'raw ranking' }}</div>
                <div class="stat">{{ $source ?? 'dashboard cache source' }}</div>
            </section>

            @if (! $available)
                <h2>Unavailable</h2>
                <div class="empty">{{ $unavailable_reason }}</div>
            @elseif ($rows === [])
                <h2>Unavailable</h2>
                <div class="empty">本機 cache 目前沒有這個日期範圍與條件的逐日標籤資料。Laravel 會透過排程擷取與快取重建補齊即時儀表板資料。</div>
            @else
                <h2>逐日標籤</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>No</th>
                                @foreach ($range['dates'] as $date)
                                    <th>{{ $date }}</th>
                                @endforeach
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($rows as $row)
                                <tr>
                                    <td class="rank">{{ $row['rank'] }}</td>
                                    @foreach ($range['dates'] as $date)
                                        @php $cell = $row['cells'][$date] ?? null; @endphp
                                        <td>
                                            @if ($cell)
                                                <a href="https://www.youtube.com/results?search_query={{ urlencode($cell['tag']) }}&sp=CAI%253D">{{ $cell['tag'] }}</a>
                                                <div class="value">{{ number_format($cell['value'], 2) }} / {{ number_format($cell['total'], 0) }}</div>
                                            @else
                                                <span class="meta">-</span>
                                            @endif
                                        </td>
                                    @endforeach
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </div>

                <h2>每日總量</h2>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>類型</th>
                                @foreach ($range['dates'] as $date)
                                    <th>{{ $date }}</th>
                                @endforeach
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <th>頻道數</th>
                                @foreach ($range['dates'] as $date)
                                    <td>{{ isset($metrics[$date]['count_channels']) ? number_format($metrics[$date]['count_channels']) : '-' }}</td>
                                @endforeach
                            </tr>
                            <tr>
                                <th>影片數</th>
                                @foreach ($range['dates'] as $date)
                                    <td>{{ isset($metrics[$date]['count_videos']) ? number_format($metrics[$date]['count_videos']) : '-' }}</td>
                                @endforeach
                            </tr>
                            <tr>
                                <th>觀看數</th>
                                @foreach ($range['dates'] as $date)
                                    <td>{{ isset($metrics[$date]['total_views']) ? number_format($metrics[$date]['total_views']) : '-' }}</td>
                                @endforeach
                            </tr>
                        </tbody>
                    </table>
                </div>
            @endif
@endsection
