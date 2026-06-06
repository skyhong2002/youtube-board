@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $date }} · {{ $ai['available'] ? 'AI generated '.$ai['generated_at'] : 'AI pending' }} · cache rows {{ number_format($cache_rows) }}
@endsection

@push('styles')
<style>
            .person-shell { max-width: 1180px; margin: 0 auto; }
            .switcher { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
            .switcher a, .facts span, .status-chip { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .facts { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
            .facts span { color: var(--muted); }
            .notice { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: #fff8e6; color: #9a4b12; }
            .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 20px; }
            .kpi { min-width: 0; padding: 10px; border: 1px solid var(--line); background: var(--surface); }
            .kpi-label { color: var(--muted); font-size: 12px; }
            .kpi-value { margin-top: 4px; color: #202a36; font-size: 21px; font-weight: 800; line-height: 1.15; }
            .kpi-detail { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.35; }
            .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
            .panel { margin: 0 0 16px; padding: 14px; border: 1px solid var(--line); background: var(--surface); }
            .panel h2 { margin: 0 0 10px; font-size: 17px; line-height: 1.3; }
            .panel h3 { margin: 14px 0 8px; font-size: 14px; }
            .summary { color: #202a36; font-size: 16px; line-height: 1.65; }
            .list { margin: 0; padding-left: 20px; line-height: 1.65; }
            .list li { margin: 4px 0; }
            .risk-list { display: grid; gap: 8px; }
            .risk { padding: 9px 10px; border: 1px solid var(--line); background: #f8fafc; }
            .risk strong { display: inline-flex; min-width: 58px; color: #344054; }
            .video-list { display: grid; gap: 10px; }
            .video { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; align-items: start; }
            .video-rank { width: 38px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); background: #f8fafc; color: #344054; font-weight: 800; }
            .video-title { display: block; color: #202a36; font-weight: 700; line-height: 1.35; }
            .video-meta { margin-top: 4px; color: var(--muted); font-size: 12px; line-height: 1.4; }
            .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: var(--surface); }
            table { width: 100%; min-width: 680px; border-collapse: collapse; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }
            th { background: #eef2f6; color: #344054; font-size: 12px; font-weight: 700; white-space: nowrap; }
            .number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
            .empty { padding: 22px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            @media (max-width: 880px) {
                .layout { grid-template-columns: 1fr; }
                .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            }
            @media (max-width: 560px) {
                .kpis { grid-template-columns: 1fr; }
                .video { grid-template-columns: 44px minmax(0, 1fr); }
            }
</style>
@endpush

@section('content')
<div class="person-shell">
@php
                $query = request()->query();
                unset($query['date']);
                $typeQuery = $query;
                unset($typeQuery['type']);
                $routeFor = fn (string $targetPerson, string $targetDate = null, array $extra = []) => $targetDate
                    ? route('mayor.people.date', ['city' => $city['key'], 'person' => $targetPerson, 'date' => $targetDate] + ($query + $extra))
                    : route('mayor.people.show', ['city' => $city['key'], 'person' => $targetPerson] + ($query + $extra));
                $formatMetric = fn (mixed $value, int $decimals = 0): string => is_numeric($value) ? number_format((float) $value, $decimals) : 'n/a';
                $actions = $ai['actions_today'] !== [] ? $ai['actions_today'] : $recommendations;
            @endphp

            <nav class="switcher" aria-label="候選人">
                @foreach ($candidate_links as $candidate)
                    <a class="{{ $candidate === $person ? 'active' : '' }}" href="{{ $routeFor($candidate, $date) }}">{{ $candidate }}</a>
                @endforeach
            </nav>

            <nav class="switcher" aria-label="日期">
                <a href="{{ $routeFor($person, $prev_date) }}">{{ $prev_date }}</a>
                <a class="active" href="{{ $routeFor($person, $date) }}">{{ $date }}</a>
                <a href="{{ $routeFor($person, $next_date) }}">{{ $next_date }}</a>
            </nav>

            <nav class="switcher" aria-label="指標">
                @foreach ($types as $typeKey => $typeLabel)
                    <a class="{{ $type === $typeKey ? 'active' : '' }}" href="{{ route('mayor.people.date', ['city' => $city['key'], 'person' => $person, 'date' => $date] + $typeQuery + ['type' => $typeKey]) }}">{{ $typeLabel }}</a>
                @endforeach
            </nav>

            <div class="facts" aria-label="資料狀態">
                <span>city={{ $city['key'] }}</span>
                <span>person={{ $person }}</span>
                <span>source={{ $video_source }}</span>
                <span>generated {{ $generated_at }}</span>
                <span class="status-chip">{{ $ai['available'] ? 'AI ready' : 'AI pending' }}</span>
            </div>

            @if (! $candidate_found)
                <p class="notice">這個姓名不在 {{ $city['label'] }} 的系統候選人清單中；請使用上方候選人切換。</p>
            @endif

            @if (! $ai['available'])
                <p class="notice">這一天尚未產生 mayor/person AI row。可用 <code>php artisan ai:mayor-person --execute --city={{ $city['key'] }} --person={{ $person }} --date={{ $date }} --ai-call-limit=1</code> 產生。</p>
            @endif

            <section class="kpis" aria-label="今日摘要">
                <div class="kpi">
                    <div class="kpi-label">AI 狀態</div>
                    <div class="kpi-value">{{ $ai['available'] ? 'Ready' : 'Pending' }}</div>
                    <div class="kpi-detail">{{ $ai['ai_type'] ?? 'waiting for ai:mayor-person' }}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-label">支持度</div>
                    <div class="kpi-value">{{ $summary['support_percentage'] === null ? 'n/a' : number_format((float) $summary['support_percentage'], 1).'%' }}</div>
                    <div class="kpi-detail">weighted raw {{ $summary['support_raw'] === null ? 'n/a' : number_format((float) $summary['support_raw'], 0) }}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-label">{{ $type_name }}</div>
                    <div class="kpi-value">{{ $formatMetric($summary['selected_total'] ?? 0) }}</div>
                    <div class="kpi-detail">delta {{ $formatMetric($summary['selected_delta'] ?? 0) }}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-label">代表影片</div>
                    <div class="kpi-value">{{ number_format(count($videos)) }}</div>
                    <div class="kpi-detail">views {{ $formatMetric($summary['views_total'] ?? 0) }} / videos {{ $formatMetric($summary['videos_total'] ?? 0) }}</div>
                </div>
            </section>

            <div class="layout">
                <main>
                    <section class="panel">
                        <h2>每日 AI 摘要</h2>
                        @if ($ai['summary'])
                            <p class="summary">{{ $ai['summary'] }}</p>
                        @else
                            <p class="summary">目前尚未有 AI 摘要，以下先顯示來源資料推導的每日紀錄。</p>
                        @endif

                        <h3>當天發生什麼</h3>
                        <ol class="list">
                            @foreach ($observations as $item)
                                <li>{{ $item }}</li>
                            @endforeach
                        </ol>
                    </section>

                    <section class="panel">
                        <h2>今天可以做什麼</h2>
                        <ol class="list">
                            @foreach ($actions as $item)
                                <li>{{ $item }}</li>
                            @endforeach
                        </ol>
                    </section>

                    @if ($ai['risks'] !== [])
                        <section class="panel">
                            <h2>風險與調整</h2>
                            <div class="risk-list">
                                @foreach ($ai['risks'] as $risk)
                                    <div class="risk">
                                        <strong>{{ $risk['level'] ?? 'risk' }}</strong>
                                        {{ $risk['item'] ?? '' }}
                                        @if (($risk['reason'] ?? '') !== '')
                                            <div class="video-meta">{{ $risk['reason'] }}</div>
                                        @endif
                                    </div>
                                @endforeach
                            </div>
                        </section>
                    @endif

                    <section class="panel">
                        <h2>代表影片</h2>
                        @if ($videos !== [])
                            <div class="video-list">
                                @foreach ($videos as $video)
                                    <div class="video">
                                        <span class="video-rank">{{ $video['rank'] }}</span>
                                        <div>
                                            @if ($video['video_id'] !== '')
                                                <a class="video-title" href="{{ route('videos.show', ['videoId' => $video['video_id']]) }}">{{ $video['title'] }}</a>
                                            @else
                                                <span class="video-title">{{ $video['title'] }}</span>
                                            @endif
                                            <div class="video-meta">{{ $video['channel_title'] }} · {{ $video['published_at'] }} · {{ number_format($video['view_count']) }} views · {{ number_format($video['comment_count']) }} comments</div>
                                        </div>
                                    </div>
                                @endforeach
                            </div>
                        @else
                            <div class="empty">這一天沒有代表影片資料。</div>
                        @endif
                    </section>
                </main>

                <aside>
                    <section class="panel">
                        <h2>追蹤指標</h2>
                        @if ($ai['follow_up_metrics'] !== [])
                            <ul class="list">
                                @foreach ($ai['follow_up_metrics'] as $item)
                                    <li>{{ $item }}</li>
                                @endforeach
                            </ul>
                        @else
                            <ul class="list">
                                <li>明日同一人物的 {{ $type_name }} delta</li>
                                <li>代表影片數與留言數是否增加</li>
                                <li>最高聲量 tag 是否連續兩天集中</li>
                            </ul>
                        @endif
                    </section>

                    <section class="panel">
                        <h2>關聯關鍵字</h2>
                        @if ($related_keywords !== [])
                            <div class="facts">
                                @foreach ($related_keywords as $keyword => $value)
                                    <span>{{ $keyword }} {{ number_format((float) $value) }}</span>
                                @endforeach
                            </div>
                        @else
                            <div class="empty">沒有關聯關鍵字。</div>
                        @endif
                    </section>

                    <section class="panel">
                        <h2>Tag 訊號</h2>
                        <div class="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>tag</th>
                                        <th class="number">{{ $type_name }}</th>
                                        <th class="number">views</th>
                                        <th class="number">videos</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @forelse ($summary['tag_rows'] as $row)
                                        <tr>
                                            <th>{{ $row['tag_name'] }}</th>
                                            <td class="number">{{ number_format((float) $row['selected'], 0) }}</td>
                                            <td class="number">{{ number_format((float) $row['views'], 0) }}</td>
                                            <td class="number">{{ number_format((float) $row['videos'], 0) }}</td>
                                        </tr>
                                    @empty
                                        <tr><td class="empty" colspan="4">沒有 tag 訊號。</td></tr>
                                    @endforelse
                                </tbody>
                            </table>
                        </div>
                    </section>
                </aside>
            </div>
</div>
@endsection
