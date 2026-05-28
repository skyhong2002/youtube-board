@extends('layouts.report')

@section('title')
{{ $video['title'] ?? $videoId }}
@endsection

@push('styles')
<style>
:root {
                color-scheme: light;
                --bg: #f7f8fa;
                --surface: #ffffff;
                --text: #18202a;
                --muted: #667085;
                --line: #d7dde6;
                --accent: #0f766e;
            }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 26px; line-height: 1.25; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 10px; }
            .meta, .muted { color: var(--muted); }
            .summary { display: grid; grid-template-columns: 120px 1fr; gap: 18px; padding: 14px; border: 1px solid var(--line); background: var(--surface); }
            .summary img { display: block; width: 120px; height: 90px; object-fit: cover; background: #d7dde6; }
            .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
            .stat { padding: 5px 8px; border: 1px solid var(--line); background: #fff; color: var(--muted); font-variant-numeric: tabular-nums; }
            .chart { padding: 14px; border: 1px solid var(--line); background: var(--surface); overflow-x: auto; }
            svg { display: block; width: 100%; min-width: 680px; height: 220px; }
            .axis { stroke: #9aa4b2; stroke-width: 1; }
            .line { fill: none; stroke: var(--accent); stroke-width: 3; }
            .dot { fill: var(--accent); }
            table { width: 100%; border-collapse: collapse; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .number { text-align: right; font-variant-numeric: tabular-nums; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 720px) {
                main { padding: 16px; }
                header, .summary { display: block; }
                .summary img { margin-bottom: 12px; }
            }
</style>
@endpush

@section('content')
@if ($video)
                <section class="summary">
                    <a href="{{ $video['youtube_url'] }}" rel="noreferrer">
                        <img src="{{ $video['thumbnail'] }}" alt="">
                    </a>
                    <div>
                        <div><strong>{{ $video['channel_title'] }}</strong></div>
                        <div class="muted">{{ $video['published_at'] }}</div>
                        <div class="stats">
                            <span class="stat">目前 {{ $video['current_viewers'] !== null ? number_format($video['current_viewers']) : 'n/a' }}</span>
                            <span class="stat">最高 {{ $video['max_current'] !== null ? number_format($video['max_current']) : 'n/a' }}</span>
                            <span class="stat">結束 {{ $video['actual_end_time'] ?: '直播中或未知' }}</span>
                        </div>
                    </div>
                </section>
            @elseif ($dataAvailable)
                <div class="empty">找不到這支直播影片的 legacy 資料。<br><x-ingestion-portal job="reports.live.build" /></div>
            @else
                <div class="empty">本機尚未匯入 legacy live tables。<br><x-ingestion-portal job="reports.live.build" /></div>
            @endif

            @php
                $renderChart = function (array $series): string {
                    if ($series === []) {
                        return '';
                    }
                    $width = 900;
                    $height = 180;
                    $padding = 24;
                    $max = max(array_column($series, 'value')) ?: 1;
                    $count = max(1, count($series) - 1);
                    $points = [];
                    foreach ($series as $index => $point) {
                        $x = $padding + (($width - $padding * 2) * $index / $count);
                        $y = $height - $padding - (($height - $padding * 2) * $point['value'] / $max);
                        $points[] = [round($x, 1), round($y, 1), $point['label'], $point['value']];
                    }
                    $path = collect($points)->map(fn ($point, $index) => ($index === 0 ? 'M' : 'L').$point[0].' '.$point[1])->implode(' ');
                    $dots = collect($points)->map(fn ($point) => '<circle class="dot" cx="'.$point[0].'" cy="'.$point[1].'" r="3"><title>'.$point[2].' '.number_format($point[3]).'</title></circle>')->implode('');
                    return '<svg viewBox="0 0 '.$width.' '.$height.'" role="img" aria-label="trend chart"><line class="axis" x1="'.$padding.'" y1="'.($height - $padding).'" x2="'.($width - $padding).'" y2="'.($height - $padding).'"></line><line class="axis" x1="'.$padding.'" y1="'.$padding.'" x2="'.$padding.'" y2="'.($height - $padding).'"></line><path class="line" d="'.$path.'"></path>'.$dots.'</svg>';
                };
            @endphp

            <h2>每小時最高線上人數</h2>
            <section class="chart">
                @if ($hourly !== [])
                    {!! $renderChart($hourly) !!}
                @else
                    <div class="muted">沒有 hourly trend 資料。</div>
                @endif
            </section>

            <h2>每日最高線上人數</h2>
            <section class="chart">
                @if ($daily !== [])
                    {!! $renderChart($daily) !!}
                @else
                    <div class="muted">沒有 daily trend 資料。</div>
                @endif
            </section>

            <h2>最近資料點</h2>
            <table>
                <thead>
                    <tr>
                        <th>時間</th>
                        <th class="number">線上人數</th>
                    </tr>
                </thead>
                <tbody>
                    @forelse (array_slice($hourly, -24) as $point)
                        <tr>
                            <td>{{ $point['label'] }}</td>
                            <td class="number">{{ number_format($point['value']) }}</td>
                        </tr>
                    @empty
                        <tr><td colspan="2" class="muted">沒有資料。</td></tr>
                    @endforelse
                </tbody>
            </table>
@endsection
