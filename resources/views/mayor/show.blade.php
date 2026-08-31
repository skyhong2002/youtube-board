@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $type_name }} · {{ $range['from'] }} - {{ $range['to'] }} · cache rows {{ number_format($cache_rows) }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav, .switcher, .legend, .facts { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher, .legend { margin-bottom: 14px; }
            .switcher a, .legend span, .facts span { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .city-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 14px; }
            .city-group { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 8px; }
            .city-group summary { margin-bottom: 8px; color: #344054; cursor: pointer; font-size: 13px; font-weight: 700; }
            .city-group .switcher { margin-bottom: 0; }
            .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 999px; }
            .legend small { margin-left: 4px; color: var(--muted); font-weight: 650; }
            .facts { margin: 0 0 16px; }
            .facts span { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .notice { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .missing { color: var(--warn); font-weight: 700; }
            .dashboard-portal { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 0 0 18px; }
            .portal-card { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
            .portal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
            .portal-name { min-width: 0; color: #202a36; font-size: 17px; font-weight: 800; overflow-wrap: anywhere; }
            .portal-dot { flex: 0 0 10px; width: 10px; height: 10px; border-radius: 999px; }
            .portal-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
            .portal-stat { min-width: 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
            .portal-stat strong { display: block; color: #202a36; font-size: 16px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
            .portal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
            .portal-actions a { display: inline-flex; align-items: center; min-height: 30px; padding: 5px 9px; border: 1px solid var(--line); border-radius: 6px; background: #f8fafc; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
            .portal-actions a.primary { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); }
            .chart { border: 1px solid var(--line); background: var(--surface); padding: 12px; overflow-x: auto; }
            .chart-heading { position: sticky; left: 0; margin: 0 0 10px; }
            .chart-heading h2 { margin: 0 0 4px; }
            .chart-heading p { margin: 0; color: var(--muted); font-size: 12px; }
            svg { display: block; min-width: 860px; width: 100%; height: auto; }
            .model-reference { margin-top: 22px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
            .model-reference summary { padding: 10px 12px; color: #344054; cursor: pointer; font-weight: 700; }
            .model-reference .table-wrap { border: 0; border-top: 1px solid var(--line); }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 860px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; text-align: left; }
            th { position: sticky; top: 0; z-index: 1; background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            tbody tr:hover { background: #f9fbfd; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) {
                main { padding: 16px; }
                header { display: block; }
                .meta { margin-top: 8px; white-space: normal; }
                .dashboard-portal { grid-template-columns: 1fr; }
                .portal-head { align-items: flex-start; }
                .portal-actions a { flex: 1 1 130px; justify-content: center; text-align: center; }
            }
</style>
@endpush

@section('content')
@php
                $chartWidth = 940;
                $chartHeight = 340;
                $padLeft = 64;
                $padRight = 18;
                $padTop = 18;
                $padBottom = 46;
                $plotWidth = $chartWidth - $padLeft - $padRight;
                $plotHeight = $chartHeight - $padTop - $padBottom;
                $fallbackColors = ['#2563eb', '#16a34a', '#64748b', '#0891b2', '#7c3aed', '#be123c'];
                $candidateColors = $candidate_colors ?? [];
                $candidateParties = $candidate_party_labels ?? [];
                $colorFor = fn (string $candidate, int $index): string => $candidateColors[$candidate] ?? $fallbackColors[$index % count($fallbackColors)];
                $partyLabelFor = fn (string $candidate): ?string => $candidateParties[$candidate] ?? null;
                $candidates = $city['candidates'];
                $allValues = collect($series)->flatMap(fn ($row) => array_values($row['percentages']))->filter(fn ($value) => is_numeric($value))->map(fn ($value) => (float) $value)->values();
                $minValue = min(0, (float) ($allValues->min() ?? 0));
                $maxValue = max(100, (float) ($allValues->max() ?? 100));
                if (abs($maxValue - $minValue) < 0.001) { $maxValue = $minValue + 1; }
                $xFor = fn (int $index): float => $padLeft + ($plotWidth * ($index / max(1, count($series) - 1)));
                $yFor = fn (int|float $value): float => $padTop + $plotHeight - ($plotHeight * (((float) $value - $minValue) / ($maxValue - $minValue)));
                $cityQuery = request()->query();
                unset($cityQuery['city']);
                $periodQuery = request()->query();
                unset($periodQuery['city'], $periodQuery['days'], $periodQuery['from'], $periodQuery['to']);
                $typeQuery = request()->query();
                unset($typeQuery['city'], $typeQuery['type']);
                $latestRow = collect($series)->last();
            @endphp



            <nav class="city-groups" aria-label="城市">
                @foreach ($city_regions as $region)
                    <details class="city-group" open>
                        <summary>{{ $region['label'] }}</summary>
                        <div class="switcher">
                            @foreach ($region['cities'] as $cityKey)
                                @if (isset($cities[$cityKey]))
                                    @php $option = $cities[$cityKey]; @endphp
                                    <a class="{{ $city['key'] === $cityKey ? 'active' : '' }}" href="{{ route('mayor.show', ['city' => $cityKey] + $cityQuery) }}">{{ $option['label'] }}</a>
                                @endif
                            @endforeach
                        </div>
                    </details>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="日期範圍">
                @foreach ([7 => '一週', 10 => '十天', 30 => '一個月', 60 => '兩個月', 90 => '一季'] as $days => $label)
                    <a class="{{ (int) $range['days'] === $days ? 'active' : '' }}" href="{{ route('mayor.show', ['city' => $city['key']] + $periodQuery + ['days' => $days, 'type' => $type]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="指標">
                @foreach ($types as $typeKey => $typeLabel)
                    <a class="{{ $type === $typeKey ? 'active' : '' }}" href="{{ route('mayor.show', ['city' => $city['key']] + $typeQuery + ['type' => $typeKey, 'days' => $range['days']]) }}">{{ $typeLabel }}</a>
                @endforeach
            </nav>

            <div class="facts" aria-label="Legacy mayor report details">
                <span>legacy source: mayor/city.php + mayor/{{ $city['key'] }}.php</span>
                <span>tag ids {{ implode(', ', $tagids) }}</span>
                <span>static preview: reports:mayor:static</span>
                <span>generated {{ $generated_at }}</span>
            </div>

            <p class="notice">
                本頁顯示候選人在四類政治頻道來源中的近 {{ $rolling_days }} 日媒體聲量占比，不是民調支持度。
                各來源等權加總，不套用舊版正負陣營係數；占比只代表候選人關鍵字在目前收錄內容中的相對聲量。
            </p>

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_show_tag_date` cache table。<br><x-ingestion-portal job="reports.mayor.static" /></p>
            @elseif (! $data_available)
                <p class="notice">目前沒有符合這組 city/date/type 的 tag-date cache；Laravel 會透過 mayor cache refresh 補齊動態儀表板資料。<br><x-ingestion-portal job="reports.mayor.static" /></p>
            @elseif (! ($coverage['complete'] ?? false))
                <p class="notice">
                    本報表要求 {{ number_format($coverage['requested_days']) }} 天，但 mayor tag 3–6 cache 只涵蓋 {{ number_format($coverage['covered_days']) }} 天，缺少 {{ number_format($coverage['missing_days']) }} 天。
                    @if ($coverage['last_covered_date'])目前最後涵蓋日期為 {{ $coverage['last_covered_date'] }}；缺資料日期會顯示為「待更新」，不會當成 0。@endif
                    <br><x-ingestion-portal job="reports.mayor.static" />
                </p>
            @endif

            <div class="legend" aria-label="候選人">
                @foreach ($candidates as $candidateIndex => $candidate)
                    @php $candidateColor = $colorFor($candidate, $candidateIndex); $partyLabel = $partyLabelFor($candidate); @endphp
                    <span><i style="background: {{ $candidateColor }}"></i>{{ $candidate }}@if ($partyLabel)<small>（{{ $partyLabel }}）</small>@endif</span>
                @endforeach
            </div>

            <h2>候選人每日 Dashboard</h2>
            <section class="dashboard-portal" aria-label="候選人每日 Dashboard">
                @foreach ($candidates as $candidateIndex => $candidate)
                    @php
                        $candidateColor = $colorFor($candidate, $candidateIndex);
                        $partyLabel = $partyLabelFor($candidate);
                        $dailyUrl = route('mayor.people.show', ['city' => $city['key'], 'person' => $candidate, 'type' => $type]);
                        $trendUrl = route('tags.compare', ['tagid' => implode(',', $tagids), 'tags' => $candidate, 'type' => $type, 'days' => $range['days'], 'from' => $range['from'], 'to' => $range['to']]);
                        $percentage = is_array($latestRow) ? ($latestRow['percentages'][$candidate] ?? null) : null;
                        $raw = is_array($latestRow) ? ($latestRow['raw'][$candidate] ?? null) : null;
                    @endphp
                    <article class="portal-card">
                        <div class="portal-head">
                            <a class="portal-name" href="{{ $dailyUrl }}">{{ $candidate }}</a>
                            <span class="portal-dot" style="background: {{ $candidateColor }}" title="{{ $partyLabel ?? '候選人' }}" aria-hidden="true"></span>
                        </div>
                        <div class="portal-stats">
                            <div class="portal-stat">
                                <strong>{{ is_numeric($percentage) ? number_format((float) $percentage, 1).'%' : 'n/a' }}</strong>
                                {{ $range['to'] }} 媒體聲量占比
                            </div>
                            <div class="portal-stat">
                                <strong>{{ is_numeric($raw) ? number_format((float) $raw, 0) : 'n/a' }}</strong>
                                近 {{ $rolling_days }} 日{{ $type_name }}
                            </div>
                        </div>
                        <div class="portal-actions">
                            <a class="primary" href="{{ $dailyUrl }}">每日 Dashboard</a>
                            <a href="{{ $trendUrl }}">關鍵字趨勢</a>
                        </div>
                    </article>
                @endforeach
            </section>

            @if ($data_available)
                <section class="chart" aria-label="候選人媒體聲量占比趨勢">
                    <div class="chart-heading">
                        <h2>近 {{ $rolling_days }} 日媒體聲量占比趨勢</h2>
                        <p>每個日期彙整當日及前 {{ $rolling_days - 1 }} 日；同日所有候選人的占比合計為 100%。</p>
                    </div>
                    <svg viewBox="0 0 {{ $chartWidth }} {{ $chartHeight }}" role="img" aria-label="{{ $city['label'] }}候選人近 {{ $rolling_days }} 日媒體聲量占比趨勢">
                        <line x1="{{ $padLeft }}" y1="{{ $padTop }}" x2="{{ $padLeft }}" y2="{{ $padTop + $plotHeight }}" stroke="#d7dde6" />
                        <line x1="{{ $padLeft }}" y1="{{ $padTop + $plotHeight }}" x2="{{ $padLeft + $plotWidth }}" y2="{{ $padTop + $plotHeight }}" stroke="#d7dde6" />
                        @for ($tick = 0; $tick <= 4; $tick++)
                            @php
                                $tickValue = $minValue + (($maxValue - $minValue) * $tick / 4);
                                $tickY = $yFor($tickValue);
                            @endphp
                            <line x1="{{ $padLeft }}" y1="{{ $tickY }}" x2="{{ $padLeft + $plotWidth }}" y2="{{ $tickY }}" stroke="#eef2f6" />
                            <text x="8" y="{{ $tickY + 4 }}" fill="#667085" font-size="11">{{ number_format($tickValue, 1) }}%</text>
                        @endfor
                        @foreach ($series as $index => $row)
                            @if ($index === 0 || $index === count($series) - 1 || $index % max(1, (int) floor(count($series) / 6)) === 0)
                                <text x="{{ $xFor($index) }}" y="{{ $chartHeight - 15 }}" fill="#667085" font-size="11" text-anchor="middle">{{ substr($row['date'], 5) }}</text>
                            @endif
                        @endforeach
                        @foreach ($candidates as $candidateIndex => $candidate)
                            @php
                                $candidateColor = $colorFor($candidate, $candidateIndex);
                                $segments = [];
                                $segment = [];
                                foreach ($series as $index => $row) {
                                    $value = $row['percentages'][$candidate] ?? null;
                                    if (! is_numeric($value)) {
                                        if (count($segment) > 1) { $segments[] = $segment; }
                                        $segment = [];
                                        continue;
                                    }
                                    $segment[] = $xFor($index).','.$yFor((float) $value);
                                }
                                if (count($segment) > 1) { $segments[] = $segment; }
                            @endphp
                            @foreach ($segments as $points)
                                <polyline points="{{ implode(' ', $points) }}" fill="none" stroke="{{ $candidateColor }}" stroke-width="2.6" />
                            @endforeach
                        @endforeach
                    </svg>
                </section>
            @else
                <div class="empty">目前沒有可繪製的候選人趨勢資料。</div>
            @endif

            <details class="model-reference">
                <summary>舊版政治傾向係數（僅供模型沿革參考，不納入上方聲量占比）</summary>
                <div class="table-wrap">
                    <table>
                    <thead>
                        <tr>
                            <th>候選人</th>
                            @foreach ($tagids as $tagId)
                                <th class="number" title="tag {{ $tagId }}">{{ $tag_labels[$tagId] ?? ('tag '.$tagId) }}係數</th>
                            @endforeach
                            <th>Links</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($candidates as $candidate)
                            <tr>
                                <th>{{ $candidate }}</th>
                                @foreach ($tagids as $tagId)
                                    <td class="number">{{ number_format((float) ($city['factors'][$candidate][$tagId] ?? 0), 2) }}</td>
                                @endforeach
                                <td>
                                    <a href="{{ route('mayor.people.date', ['city' => $city['key'], 'person' => $candidate, 'date' => $range['to'], 'type' => $type]) }}">每日 Dashboard</a>
                                    ·
                                    <a href="{{ route('tags.compare', ['tagid' => implode(',', $tagids), 'tags' => $candidate, 'type' => $type, 'days' => $range['days'], 'from' => $range['from'], 'to' => $range['to']]) }}">關鍵字趨勢</a>
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                    </table>
                </div>
            </details>

            <h2>每日資料</h2>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>日期</th>
                            @foreach ($candidates as $candidate)
                                <th class="number">{{ $candidate }} 聲量占比</th>
                                <th class="number">{{ $candidate }} {{ $type_name }}</th>
                            @endforeach
                            <th class="number">來源 cache rows</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse (array_reverse($series) as $row)
                            <tr>
                                <th>{{ $row['date'] }}</th>
                                @foreach ($candidates as $candidate)
                                    @php $percentage = $row['percentages'][$candidate] ?? null; $raw = $row['raw'][$candidate] ?? null; @endphp
                                    <td class="number {{ is_numeric($percentage) ? '' : 'missing' }}">{{ is_numeric($percentage) ? number_format((float) $percentage, 2).'%' : '待更新' }}</td>
                                    <td class="number {{ is_numeric($raw) ? '' : 'missing' }}">{{ is_numeric($raw) ? number_format((float) $raw, 2) : '待更新' }}</td>
                                @endforeach
                                <td class="number">{{ number_format($row['cache_rows']) }}</td>
                            </tr>
                        @empty
                            <tr><td class="empty" colspan="{{ 2 + count($candidates) * 2 }}">目前沒有可顯示的日期。</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
@endsection
