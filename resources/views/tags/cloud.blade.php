@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $subject }} {{ $section_title }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0b5cad; --ok: #0f766e; --ok-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: var(--accent); text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1160px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 22px 0 8px; font-size: 18px; }
            .nav, .tabs, .filters, .summary { display: flex; flex-wrap: wrap; gap: 10px; }
            .nav, .tabs { margin-bottom: 10px; }
            .tabs a, .filters li, .badge, .summary span { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .tabs a.active { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { color: var(--muted); }
            .meta { color: var(--muted); text-align: right; }
            .notice { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .panel { padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .cloud { display: flex; min-height: 320px; align-content: center; align-items: center; justify-content: center; flex-wrap: wrap; gap: 9px 14px; padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .cloud a { display: inline-flex; align-items: center; line-height: 1.05; color: hsl(var(--hue), 62%, 34%); font-weight: 700; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; background: var(--surface); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            .number { text-align: right; font-variant-numeric: tabular-nums; }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
            @media (max-width: 760px) {
                main { padding: 16px; }
                header { display: block; }
                .meta { margin-top: 8px; text-align: left; }
                .grid { grid-template-columns: 1fr; }
                .cloud { min-height: 220px; padding: 14px; }
            }
</style>
@endpush

@section('content')
<div class="meta">{{ $generated_at }}</div>

@php
                $query = request()->query();
                unset($query['days']);
                $tagRouteName = $tag_id ? 'tags.cloud' : 'tags.cloud.index';
                $tagRouteParams = $tag_id ? ['tagId' => $tag_id] : [];
                $dayRouteName = $mode === 'keyword' ? 'keywords.cloud' : $tagRouteName;
                $dayRouteParams = $mode === 'keyword' ? ['keyword' => $keyword] : $tagRouteParams;
                $dayOptions = $mode === 'keyword' ? [1 => '一天', 3 => '三天', 7 => '一週'] : [1 => '一天', 3 => '三天', 7 => '一週', 30 => '一月'];
                $categoryTabs = [
                    13 => '新聞',
                    3 => '泛藍',
                    4 => '泛綠',
                    5 => '泛紅',
                    6 => '泛白',
                ];
            @endphp



            @if ($mode === 'keyword')
                <nav class="tabs" aria-label="Keyword category filters">
                    @foreach ($categoryTabs as $categoryId => $label)
                        @php
                            $categoryQuery = request()->query();
                            $categoryQuery['tagid'] = $categoryId;
                            $categoryQuery['days'] = $days;
                        @endphp
                        <a class="{{ in_array($categoryId, $cache_filters['tagid'], true) ? 'active' : '' }}" href="{{ route('keywords.cloud', ['keyword' => $keyword] + $categoryQuery) }}">{{ $label }}</a>
                    @endforeach
                </nav>
            @endif

            <nav class="tabs" aria-label="Cloud period">
                @foreach ($dayOptions as $optionDays => $label)
                    <a class="{{ $days === $optionDays ? 'active' : '' }}" href="{{ route($dayRouteName, $dayRouteParams + $query + ['days' => $optionDays]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            @if (! $data_available)
                <section class="panel">
                    <p class="notice">Data unavailable locally. {{ $blocked_reason }}</p>
                    <p>Legacy source: {{ $legacy_file }}. Laravel only reads {{ $cache_table }} and does not trigger cache generation.</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Dependency</th>
                                <th>Rows</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($dependencies as $dependency)
                                <tr>
                                    <td><code>{{ $dependency['table'] }}</code></td>
                                    <td>{{ $dependency['rows'] === null ? '-' : number_format($dependency['rows']) }}</td>
                                    <td><span class="badge {{ $dependency['status'] }}">{{ $dependency['status'] }}</span></td>
                                </tr>
                            @endforeach
                        </tbody>
                    </table>
                </section>
            @else
                <div class="summary" aria-label="Cache summary">
                    <span>{{ $days }} 天 cache: {{ number_format($short_cache['counts']['tags_count']) }} keywords</span>
                    <span>{{ $long_days }} 天 cache: {{ number_format($long_cache['counts']['tags_count']) }} keywords</span>
                    <span>videos {{ number_format($short_cache['counts']['videos']) }}</span>
                    <span>channels {{ number_format($short_cache['counts']['channels']) }}</span>
                    @if ($short_cache['mtime'])
                        <span>mtime {{ $short_cache['mtime'] }}</span>
                    @endif
                </div>

                <section class="cloud" aria-label="Tag cloud">
                    @foreach ($rows as $index => $row)
                        @php
                            $scale = $max_score > 0 ? $row['score'] / $max_score : 0;
                            $size = 14 + min(42, pow($scale, 0.72) * 42);
                            $hue = (int) (($index * 47) % 360);
                        @endphp
                        <a href="https://www.youtube.com/results?search_query={{ urlencode($row['word']) }}&amp;sp=CAI%253D" style="font-size: {{ number_format($size, 1) }}px; --hue: {{ $hue }};">{{ $row['word'] }}</a>
                    @endforeach
                </section>

                <h2>差分排行</h2>
                <table>
                    <thead>
                        <tr>
                            <th>名次</th>
                            <th>關鍵字</th>
                            <th class="number">指數</th>
                            <th class="number">{{ $days }} 天</th>
                            <th class="number">{{ $long_days }} 天</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($rows as $index => $row)
                            <tr>
                                <td class="number">{{ $index + 1 }}</td>
                                <td><a href="https://www.youtube.com/results?search_query={{ urlencode($row['word']) }}&amp;sp=CAI%253D">{{ $row['word'] }}</a></td>
                                <td class="number">{{ number_format($row['score'], 3) }}</td>
                                <td class="number">{{ number_format($row['short_score'], 3) }}</td>
                                <td class="number">{{ number_format($row['long_score'], 3) }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>

                <div class="grid">
                    <section>
                        <h2>{{ $days }} 天原始資料</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>關鍵字</th>
                                    <th class="number">權重</th>
                                </tr>
                            </thead>
                            <tbody>
                                @foreach ($short_rows as $row)
                                    <tr>
                                        <td>{{ $row['word'] }}</td>
                                        <td class="number">{{ number_format($row['score'], 3) }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </section>
                    <section>
                        <h2>{{ $long_days }} 天原始資料</h2>
                        <table>
                            <thead>
                                <tr>
                                    <th>關鍵字</th>
                                    <th class="number">權重</th>
                                </tr>
                            </thead>
                            <tbody>
                                @foreach ($long_rows as $row)
                                    <tr>
                                        <td>{{ $row['word'] }}</td>
                                        <td class="number">{{ number_format($row['score'], 3) }}</td>
                                    </tr>
                                @endforeach
                            </tbody>
                        </table>
                    </section>
                </div>

                <p class="meta">Legacy source: {{ $legacy_file }}; writes=0</p>
            @endif
@endsection
