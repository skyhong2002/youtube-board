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
            .lineage { margin: 0 0 18px; padding: 0; }
            .lineage h2, .lineage h3, .lineage p { margin: 0; }
            .lineage h2 { font-size: 18px; line-height: 1.25; }
            .lineage h3 { margin-bottom: 10px; color: #344054; font-size: 14px; }
            .lineage p { color: var(--muted); line-height: 1.55; }
            .lineage code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; color: #344054; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
            .lineage-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
            .lineage-ops { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 30px; padding: 5px 10px; border: 1px solid #b7ded6; border-radius: 6px; background: var(--accent-bg); color: var(--accent); font-size: 12px; font-weight: 700; }
            .lineage-flow { display: grid; gap: 12px; margin-bottom: 0; }
            .lineage-graph { min-height: 250px; overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
            .lineage-graph svg { display: block; min-width: 760px; width: auto; height: auto; }
            .lineage-fallback { display: flex; align-items: stretch; gap: 8px; min-width: 760px; padding: 10px; }
            .lineage-node, .lineage-edge { min-height: 74px; border: 1px solid var(--line); border-radius: 6px; background: #f9fbfd; }
            .lineage-node { display: flex; flex: 0 0 132px; flex-direction: column; justify-content: center; gap: 5px; padding: 10px; }
            .lineage-node span { color: var(--text); font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
            .lineage-node em { color: #475467; font-size: 11px; font-style: normal; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
            .lineage-node small { color: var(--muted); font-size: 11px; text-transform: uppercase; }
            .lineage-node-api { border-color: #a7c7e7; background: #edf6ff; }
            .lineage-node-table { border-color: #c7d7a7; background: #f5faec; }
            .lineage-node-cache { border-color: #e6c58f; background: #fff7e8; }
            .lineage-node-service { border-color: #b7ded6; background: var(--accent-bg); }
            .lineage-node-page { border-color: #c7b7df; background: #f5f0ff; }
            .lineage-edge { display: flex; flex: 0 0 48px; align-items: center; justify-content: center; color: var(--muted); font-size: 11px; font-weight: 700; text-align: center; position: relative; }
            .lineage-edge::before { content: ""; position: absolute; left: 8px; right: 8px; top: 50%; border-top: 1px solid #98a2b3; }
            .lineage-edge::after { content: ""; position: absolute; right: 8px; top: calc(50% - 4px); width: 8px; height: 8px; border-top: 1px solid #98a2b3; border-right: 1px solid #98a2b3; transform: rotate(45deg); background: transparent; }
            .lineage-edge span { position: relative; z-index: 1; padding: 2px 5px; background: #f9fbfd; }
            .lineage-svg-node { cursor: pointer; outline: none; }
            .lineage-svg-node rect { transition: stroke-width .12s ease, filter .12s ease; }
            .lineage-svg-node:hover rect, .lineage-svg-node:focus rect, .lineage-svg-node.is-active rect { filter: drop-shadow(0 2px 3px rgb(16 24 40 / 18%)); stroke-width: 2.4; }
            .lineage-detail { min-height: 220px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
            .lineage-detail[hidden] { display: none; }
            .lineage-detail h3 { margin-bottom: 8px; font-size: 16px; }
            .lineage-detail p { margin-bottom: 10px; color: #344054; }
            .lineage dl { display: grid; gap: 8px; margin: 10px 0 0; }
            .lineage dl div { display: grid; grid-template-columns: 152px minmax(0, 1fr); gap: 8px; }
            .lineage dt { color: var(--muted); font-size: 12px; font-weight: 700; }
            .lineage dd { margin: 0; min-width: 0; color: #344054; line-height: 1.45; white-space: pre-line; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } th, td { padding: 7px; } }
</style>
@endpush

@section('content')
            @include('reports.partials.lineage', ['lineage' => $lineage ?? null])

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
                <div class="empty">{{ $unavailable_reason }}<br><x-ingestion-portal job="reports.tag_date.build" /></div>
            @elseif ($rows === [])
                <h2>Unavailable</h2>
                <div class="empty">本機 cache 目前沒有這個日期範圍與條件的逐日標籤資料。Laravel 會透過排程擷取與快取重建補齊即時儀表板資料。<br><x-ingestion-portal job="reports.tag_date.build" /></div>
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
