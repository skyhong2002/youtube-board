@extends('layouts.report')

@section('title')
{{ $tag['name'] }} 排行榜
@endsection

@section('meta')
{{ count($rows) }} 筆 · sort={{ $sortColumn }} · {{ $generatedAt }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1400px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li, .tag { display: inline-flex; align-items: center; min-height: 24px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; }
            .tag { border-color: #b7ded6; background: var(--accent-bg); color: var(--accent); margin: 2px 4px 2px 0; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 1160px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .rank, .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .thumb { width: 72px; }
            .thumb img { display: block; width: 48px; height: 48px; object-fit: cover; background: #d7dde6; border-radius: 50%; }
            .name { min-width: 240px; }
            .empty { padding: 28px; color: var(--muted); text-align: center; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
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
                            <th>排名</th>
                            <th>圖示</th>
                            <th>名稱</th>
                            <th>觀看次數</th>
                            <th>訂閱人數</th>
                            <th>這週觀看</th>
                            <th>這月觀看</th>
                            <th>預估觀看</th>
                            <th>預估差距</th>
                            <th>標籤</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($rows as $row)
                            <tr>
                                <td class="rank">{{ $row['rank'] }}</td>
                                <td class="thumb">
                                    <a href="{{ $row['youtube_url'] }}" rel="noreferrer">
                                        @if ($row['thumbnail'])
                                            <img src="{{ $row['thumbnail'] }}" alt="">
                                        @endif
                                    </a>
                                </td>
                                <td class="name"><a href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['title'] }}</a></td>
                                <td class="number">{{ number_format($row['view_count']) }}</td>
                                <td class="number">{{ number_format($row['subscriber_count']) }}</td>
                                <td class="number">{{ number_format($row['view_week']) }}</td>
                                <td class="number">{{ number_format($row['view_month']) }}</td>
                                <td class="number">{{ number_format($row['views_pred_month']) }}</td>
                                <td class="number">{{ number_format($row['pred_gap']) }}</td>
                                <td>
                                    @foreach ($row['tags'] as $rowTag)
                                        <a class="tag" href="{{ route('tags.channels', ['tagId' => $rowTag['id']]) }}">{{ $rowTag['name'] }}</a>
                                    @endforeach
                                </td>
                            </tr>
                        @empty
                            <tr>
                                <td class="empty" colspan="10">
                                    {{ $dataAvailable ? '目前沒有符合條件的頻道。' : '本機尚未匯入 legacy channel/tag tables。' }}
                                </td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
