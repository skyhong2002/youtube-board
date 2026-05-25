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
            h2 { margin: 0 0 10px; font-size: 15px; line-height: 1.3; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
            .action { display: inline-flex; align-items: center; min-height: 32px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-weight: 600; }
            .action.primary { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); }
            .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }
            .metric { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
            .metric-label { color: var(--muted); font-size: 12px; }
            .metric-value { margin-top: 4px; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 840px; border-collapse: collapse; }
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
<div class="actions" aria-label="常用報表">
                <a class="action primary" href="{{ route('live.current', ['or' => '1,2,12,13,14,81']) }}">直播排行榜</a>
                <a class="action" href="{{ route('keywords.index') }}">關鍵字</a>
                <a class="action" href="{{ route('tags.channels', ['tagId' => 1, 'not' => '2,9,10,12,13,33,36,81']) }}">個人社論</a>
                <a class="action" href="{{ route('live.continuous') }}">現在帶狀直播排行</a>
                <a class="action" href="{{ route('live.days.index') }}">單日直播排行</a>
                <a class="action" href="{{ route('tags.compare', ['tags' => '蔡英文,柯文哲,侯友宜,陳時中']) }}">多關鍵字趨勢</a>
                <a class="action" href="/dev/check">API 檢查</a>
            </div>

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
                            <th><a href="{{ route('home', ['sort' => 'num', 'min' => $filters['min'] ?? 10]) }}">Num</a></th>
                            <th><a href="{{ route('home', ['sort' => 'total', 'min' => $filters['min'] ?? 10]) }}">Total</a></th>
                            <th><a href="{{ route('home', ['sort' => 'ave', 'min' => $filters['min'] ?? 10]) }}">Average</a></th>
                            <th><a href="{{ route('home', ['sort' => 'median', 'min' => $filters['min'] ?? 10]) }}">Median</a></th>
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
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="6">
                                    {{ $dataAvailable ? '目前沒有符合條件的分類資料。' : '本機尚未匯入 legacy tag/count tables。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
