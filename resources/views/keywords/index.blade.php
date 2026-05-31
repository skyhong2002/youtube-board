@extends('layouts.report')

@section('title')
關鍵字列表
@endsection

@section('meta')
{{ count($rows) }} 筆 · sort={{ $sort }} · {{ $generatedAt }}
@endsection

@push('styles')
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
            .row-actions { display: flex; flex-wrap: wrap; gap: 8px; }
            .notice { margin: 0 0 16px; color: var(--muted); }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1280px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .keyword { min-width: 220px; font-weight: 700; }
            .row-actions { min-width: 420px; }
            .row-actions a { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; font-weight: 650; white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            .lineage { margin: 0 0 18px; padding: 16px; border: 1px solid var(--line); background: var(--surface); }
            .lineage h2, .lineage h3, .lineage p { margin: 0; }
            .lineage h2 { font-size: 18px; line-height: 1.25; }
            .lineage h3 { margin-bottom: 10px; color: #344054; font-size: 14px; }
            .lineage p { color: var(--muted); line-height: 1.55; }
            .lineage code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; color: #344054; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
            .lineage-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
            .lineage-ops { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 30px; padding: 5px 10px; border: 1px solid #b7ded6; border-radius: 6px; background: var(--accent-bg); color: var(--accent); font-size: 12px; font-weight: 700; }
            .lineage-graph { display: flex; align-items: stretch; gap: 8px; margin-bottom: 14px; overflow-x: auto; padding-bottom: 2px; }
            .lineage-node, .lineage-edge { min-height: 74px; border: 1px solid var(--line); border-radius: 6px; background: #f9fbfd; }
            .lineage-node { display: flex; flex: 0 0 132px; flex-direction: column; justify-content: center; gap: 5px; padding: 10px; }
            .lineage-node span { color: var(--text); font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
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
            .lineage-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 12px; }
            .lineage-panel, .lineage-fixed { padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
            .lineage-job + .lineage-job { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
            .lineage-job strong { display: block; margin-bottom: 4px; color: var(--text); }
            .lineage-job p { margin-top: 5px; }
            .lineage dl { display: grid; gap: 8px; margin: 10px 0 0; }
            .lineage dl div { display: grid; grid-template-columns: 152px minmax(0, 1fr); gap: 8px; }
            .lineage dt { color: var(--muted); font-size: 12px; font-weight: 700; }
            .lineage dd { margin: 0; min-width: 0; color: #344054; line-height: 1.45; }
            .lineage-steps { margin: 10px 0 14px; padding-left: 20px; color: #344054; line-height: 1.55; }
            .lineage-fixed { margin-top: 12px; }
            .lineage-fixed-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
            .lineage-fixed-list div { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
            .lineage-fixed-list strong { color: var(--text); }
            .lineage-fixed-list span { color: var(--muted); line-height: 1.45; }
            @media (max-width: 1080px) { .lineage-grid, .lineage-fixed-list { grid-template-columns: 1fr; } }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } .lineage-head { display: block; } .lineage-ops { margin-top: 10px; } .lineage dl div { grid-template-columns: 1fr; gap: 2px; } }
</style>
@endpush

@section('content')
            @include('reports.partials.lineage', ['lineage' => $lineage ?? null])

            @unless ($cachedMetricsAvailable)
                <p class="notice">本機 `urt_show_data.tags_all` 尚無快取，因此影片數、觀看數、成長欄位先以空值呈現。<br><x-ingestion-portal job="reports.keywords.cache" /></p>
            @endunless

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ is_array($value) ? implode(',', $value) : $value }}</li>
                    @endforeach
                </ul>
            @endif

            <div class="table-wrap">
                <table class="report-table" style="--report-table-min-width: 1180px; --report-col-label: 170px; --report-col-number: 88px; --report-col-date: 112px; --report-col-actions: 330px;">
                    <colgroup>
                        <col class="report-col-rank">
                        <col class="report-col-keyword">
                        <col class="report-col-number">
                        <col class="report-col-number">
                        <col class="report-col-date">
                        <col class="report-col-number">
                        <col class="report-col-number">
                        <col class="report-col-number">
                        <col class="report-col-number">
                        <col class="report-col-actions">
                    </colgroup>
                    <thead>
                        <tr>
                            <th>No</th>
                            <th>關鍵字</th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'hours_count']) }}">持續性</a></th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'max_count']) }}">極值</a></th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'max_hours']) }}">最熱日期</a></th>
                            <th><a href="{{ route('keywords.index', ['sort' => 'weight']) }}">權重</a></th>
                            <th>影片數</th>
                            <th>觀看數</th>
                            <th>成長</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank">{{ $row['rank'] }}</td>
                                <td class="keyword">
                                    <a href="{{ route('keywords.days', ['keyword' => $row['tag']]) }}">{{ $row['tag'] }}</a>
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
                                <td>
                                    <div class="row-actions" aria-label="{{ $row['tag'] }} 相關報表">
                                        <a href="{{ route('keywords.days', ['keyword' => $row['tag']]) }}">逐日</a>
                                        <a href="{{ route('keywords.videos', ['keyword' => $row['tag']]) }}">影片</a>
                                        <a href="{{ route('keywords.cloud', ['keyword' => $row['tag'], 'days' => 3]) }}">文字雲</a>
                                        <a href="{{ route('keywords.live.trends', ['keyword' => $row['tag']]) }}">直播趨勢</a>
                                        <a href="{{ route('keywords.groups.trends', ['keyword' => $row['tag']]) }}">群組趨勢</a>
                                        <a href="{{ route('tags.compare', ['tags' => $row['tag']]) }}">比較</a>
                                        <a href="https://www.youtube.com/results?search_query={{ urlencode($row['tag']) }}&sp=CAI%253D" rel="noreferrer">YouTube</a>
                                    </div>
                                </td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="10">
                                    {{ $dataAvailable ? '目前沒有符合條件的關鍵字資料。' : '本機尚未匯入 legacy tags table。' }}<br><x-ingestion-portal job="reports.keywords.cache" />
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
