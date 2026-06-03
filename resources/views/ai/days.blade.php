@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ count($topics) }} topics · {{ $channels_count }} channels · {{ $generated_at }}
@endsection

@push('styles')
<style>
            :root { color-scheme: light; --daily-muted: #5f6b7a; --daily-line: #a8afb8; --daily-soft: #f8fafc; --warn: #b54708; --warn-bg: #fff8e6; }
            .ai-day-shell { max-width: 980px; margin: 0 auto; }
            .switcher { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
            .switcher a, .filters span { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
            .filters span { color: var(--muted); }
            .coverage { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 20px; }
            .coverage-item { min-width: 0; padding: 9px 10px; border: 1px solid var(--line); background: var(--surface); }
            .coverage-label { color: var(--muted); font-size: 12px; }
            .coverage-value { margin-top: 2px; color: #202a36; font-size: 18px; font-weight: 700; line-height: 1.2; }
            .coverage-detail { margin-top: 3px; color: var(--muted); font-size: 12px; line-height: 1.35; }
            .topic { margin: 0 0 26px; padding: 0 0 6px; }
            .topic h2 { margin: 0 0 12px; font-size: 23px; line-height: 1.3; }
            .media-events { margin: 0 0 10px 24px; padding: 0; line-height: 1.6; }
            .media-events li { margin: 1px 0; color: #273442; break-inside: avoid; }
            .media-events a { font-weight: 700; }
            .media-count { color: var(--daily-muted); white-space: nowrap; }
            .summary-box { margin: 10px 0 0 24px; padding: 8px 12px 12px; border: 1px solid var(--daily-line); background: #fff; }
            .summary-list { margin: 0 0 10px 18px; padding: 0; line-height: 1.65; }
            .summary-list li { color: #202a36; }
            .empty-value { color: var(--daily-muted); }
            .video-embeds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
            .video-card { min-width: 0; }
            .video-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: #0f172a; }
            .video-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
            .video-title { display: block; margin-top: 4px; overflow: hidden; color: #344054; font-size: 12px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            .notice { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 780px) {
                .ai-day-shell { max-width: none; }
                .topic h2 { font-size: 20px; }
                .coverage { grid-template-columns: 1fr; }
                .summary-box, .media-events { margin-left: 0; }
                .video-embeds { grid-template-columns: 1fr; }
            }
</style>
@endpush

@section('content')
<div class="ai-day-shell">
@php
                $query = request()->query();
                $dateForNav = $date ?: now('Asia/Taipei')->format('Y-m-d');
                $prevDate = \Carbon\CarbonImmutable::parse($dateForNav, 'Asia/Taipei')->subDay()->format('Y-m-d');
                $nextDate = \Carbon\CarbonImmutable::parse($dateForNav, 'Asia/Taipei')->addDay()->format('Y-m-d');
                $conditionQuery = $query;
                unset($conditionQuery['condition'], $conditionQuery['pk']);
                $dayRoute = fn (string $targetDate, string $targetCondition = null) => $targetCondition
                    ? route('ai.days.condition', ['date' => $targetDate, 'condition' => $targetCondition] + $conditionQuery)
                    : route('ai.days.date', ['date' => $targetDate] + $conditionQuery);
                $formatCounts = fn (array $counts): string => collect($counts)
                    ->map(fn (int $count, string $label): string => $label.'('.number_format($count).')')
                    ->implode(', ');
            @endphp


            <nav class="switcher" aria-label="日期">
                <a href="{{ $dayRoute($prevDate, $condition) }}">{{ $prevDate }}</a>
                @if ($date)
                    <a class="active" href="{{ $dayRoute($date, $condition) }}">{{ $date }}</a>
                @endif
                <a href="{{ $dayRoute($nextDate, $condition) }}">{{ $nextDate }}</a>
            </nav>

            <nav class="switcher" aria-label="條件">
                @foreach (['all' => '全部', 'green' => '泛綠', 'blue' => '泛藍', 'neutral' => '較無偏', 'finance' => '財經', 'world' => '世界'] as $conditionKey => $label)
                    <a class="{{ $condition === $conditionKey ? 'active' : '' }}" href="{{ $date ? $dayRoute($date, $conditionKey) : route('ai.days.index', $conditionQuery + ['condition' => $conditionKey]) }}">{{ $label }}</a>
                @endforeach
            </nav>

            <div class="filters" aria-label="Legacy filters">
                <span>condition={{ $condition }}</span>
                @if ($date)
                    <span>date={{ $date }}</span>
                @endif
                @if ($row)
                    <span>pk={{ $row['pk'] }}</span>
                    <span>type={{ $row['data_type'] }}</span>
                @endif
            </div>

            <section class="coverage" aria-label="AI coverage">
                <div class="coverage-item">
                    <div class="coverage-label">Raw 收錄</div>
                    <div class="coverage-value">{{ $coverage['raw_video_rows'] === null ? 'n/a' : number_format($coverage['raw_video_rows']) }}</div>
                    <div class="coverage-detail">urt_video rows</div>
                </div>
                <div class="coverage-item">
                    <div class="coverage-label">AI source</div>
                    <div class="coverage-value">{{ number_format($coverage['ai_source_video_refs']) }}</div>
                    <div class="coverage-detail">{{ number_format($coverage['ai_source_channels_with_events']) }} / {{ number_format($coverage['ai_source_channels']) }} channels · {{ number_format($coverage['ai_source_event_rows']) }} events</div>
                </div>
                <div class="coverage-item">
                    <div class="coverage-label">Daily summary</div>
                    <div class="coverage-value">{{ number_format($coverage['summary_video_refs']) }}</div>
                    <div class="coverage-detail">{{ number_format($coverage['summary_topics']) }} topics</div>
                </div>
            </section>

            @if (! $available)
                <p class="notice">本機尚未匯入 legacy AI daily tables。<br><x-ingestion-portal job="ai.daily" /></p>
            @endif

            @forelse ($topics as $index => $topic)
                <article class="topic">
                    <h2>
                        {{ $index + 1 }}.
                        @if (($row['pk'] ?? 0) > 0)
                            <a href="{{ route('ai.events.show', ['id' => $row['pk'], 'event' => $topic['title']]) }}">{{ $topic['title'] }}</a>
                        @else
                            {{ $topic['title'] }}
                        @endif
                    </h2>

                    <ul class="media-events">
                        @foreach (($topic['media_event_rows'] ?? []) as $mediaEvent)
                            <li>
                                @if ($mediaEvent['u_id'])
                                    <a href="{{ route('channels.show', ['u_id' => $mediaEvent['u_id']]) }}">{{ $mediaEvent['channel'] }}</a>
                                @else
                                    <strong>{{ $mediaEvent['channel'] }}</strong>
                                @endif
                                =&gt; {{ $mediaEvent['event'] }}
                                @if (($mediaEvent['video_count'] ?? 0) > 1)
                                    <span class="media-count">({{ number_format($mediaEvent['video_count']) }} 則)</span>
                                @endif
                            </li>
                        @endforeach
                    </ul>

                    <div class="summary-box">
                        <ul class="summary-list">
                            <li>媒體數：{{ number_format($topic['media_count']) }} 個 / 影片數：{{ number_format($topic['video_count']) }} 則</li>
                            <li>關鍵字：{!! $topic['keywords'] === [] ? '<span class="empty-value">無</span>' : e($formatCounts($topic['keywords'])) !!}</li>
                            <li>人物：{!! $topic['people'] === [] ? '<span class="empty-value">無</span>' : e($formatCounts($topic['people'])) !!}</li>
                            <li>泛綠媒體：{{ number_format($topic['party']['green']) }} 則 / 泛藍媒體：{{ number_format($topic['party']['blue']) }} 則</li>
                            <li>台灣角度：{{ number_format($topic['angle']['台灣']) }} 則 / 中國角度：{{ number_format($topic['angle']['中國']) }} 則</li>
                            <li>民進黨觀點：{{ number_format($topic['camp']['民進黨']) }} 則 / 國民黨觀點：{{ number_format($topic['camp']['國民黨']) }} 則</li>
                        </ul>

                        @if ($topic['videos'] !== [])
                        <div class="video-embeds" aria-label="代表影片">
                            @foreach ($topic['videos'] as $video)
                                <div class="video-card">
                                    <div class="video-frame">
                                        <iframe src="https://www.youtube.com/embed/{{ $video['video_id'] }}" title="{{ $video['channel'] }} - {{ $video['event'] }}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                                    </div>
                                    <a class="video-title" href="https://www.youtube.com/watch?v={{ $video['video_id'] }}" target="_blank" rel="noreferrer">{{ $video['channel'] }} · {{ $video['event'] }}</a>
                                </div>
                            @endforeach
                        </div>
                        @endif
                    </div>
                </article>
            @empty
                <div class="empty">{{ $available ? '目前沒有符合條件的 AI daily summary。' : '本機尚未匯入 legacy AI daily tables。' }}<br><x-ingestion-portal job="ai.daily" /></div>
            @endforelse
</div>
@endsection
