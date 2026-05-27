@extends('layouts.report')

@section('title')
所有分類列表
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
            .row-actions { min-width: 340px; }
            .row-actions a { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; font-weight: 650; white-space: nowrap; }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
            .metric { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
            .metric-label { color: var(--muted); font-size: 12px; }
            .metric-value { margin-top: 4px; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1180px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .tag-name { min-width: 240px; font-weight: 700; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            @media (max-width: 720px) {
                main { padding: 16px; }
                header { display: block; }
                .meta { margin-top: 8px; white-space: normal; }
                .summary { grid-template-columns: 1fr; }
            }
</style>
@endpush

@section('content')
            <section class="summary" aria-label="分類摘要">
                <div class="metric">
                    <div class="metric-label">分類數</div>
                    <div class="metric-value">{{ number_format($summary['visible_tags']) }}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">分類頻道筆數</div>
                    <div class="metric-value">{{ number_format($summary['total_channels']) }}</div>
                </div>
                <div class="metric">
                    <div class="metric-label">週觀看總量</div>
                    <div class="metric-value">{{ number_format($summary['weekly_views']) }}</div>
                </div>
            </section>

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
                            <th><a href="{{ route('tags.index', ['sort' => 'num', 'min' => $filters['min'] ?? 10]) }}">Num</a></th>
                            <th><a href="{{ route('tags.index', ['sort' => 'total', 'min' => $filters['min'] ?? 10]) }}">Total</a></th>
                            <th><a href="{{ route('tags.index', ['sort' => 'ave', 'min' => $filters['min'] ?? 10]) }}">Average</a></th>
                            <th><a href="{{ route('tags.index', ['sort' => 'median', 'min' => $filters['min'] ?? 10]) }}">Median</a></th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank">{{ $row['rank'] }}</td>
                                <td class="tag-name">
                                    <a href="{{ route('tags.channels', ['tagId' => $row['tag_id']]) }}">{{ $row['name'] }}</a>
                                </td>
                                <td class="number">{{ number_format($row['num']) }}</td>
                                <td class="number">{{ number_format($row['total']) }}</td>
                                <td class="number">{{ number_format($row['ave']) }}</td>
                                <td class="number">{{ number_format($row['median']) }}</td>
                                <td>
                                    <div class="row-actions" aria-label="{{ $row['name'] }} 相關報表">
                                        <a href="{{ route('tags.channels', ['tagId' => $row['tag_id']]) }}">頻道</a>
                                        <a href="{{ route('tags.videos', ['tagId' => $row['tag_id']]) }}">影片</a>
                                        <a href="{{ route('tags.live.videos', ['tagId' => $row['tag_id']]) }}">直播</a>
                                        <a href="{{ route('tags.comments', ['tagId' => $row['tag_id']]) }}">留言</a>
                                        <a href="{{ route('tags.cloud', ['tagId' => $row['tag_id']]) }}">文字雲</a>
                                        <a href="{{ route('tags.days', ['tagId' => $row['tag_id']]) }}">逐日</a>
                                        <a href="{{ route('tags.trends', ['tagId' => $row['tag_id']]) }}">趨勢</a>
                                    </div>
                                </td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="7">
                                    {{ $dataAvailable ? '目前沒有符合條件的分類資料。' : '本機尚未匯入 legacy tag/count tables。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
