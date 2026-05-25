@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ count($topics) }} topics · {{ $channels_count }} channels · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #f2f4f7; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 0 0 10px; font-size: 20px; line-height: 1.25; }
            .nav, .switcher, .filters, .chips, .media-events, .thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters span, .chip { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); max-width: 260px; text-align: right; }
            .filters { margin: 0 0 16px; }
            .filters span { color: var(--muted); }
            .topic { margin: 0 0 16px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .topic-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: start; }
            .stats { display: grid; grid-template-columns: repeat(4, minmax(86px, auto)); gap: 8px; }
            .stat { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: #f9fbfd; text-align: right; }
            .stat strong { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
            .stat span { color: var(--muted); font-size: 12px; }
            .section-title { margin: 14px 0 7px; color: #344054; font-size: 12px; font-weight: 700; }
            .media-events { display: block; columns: 2 320px; }
            .media-events li { break-inside: avoid; margin-bottom: 6px; color: var(--muted); }
            .media-events a { font-weight: 700; }
            .chip { background: var(--chip); border-color: transparent; margin: 0 4px 4px 0; }
            .chip.hot { background: var(--accent-bg); color: var(--accent); }
            .thumbs { margin-top: 10px; }
            .thumb { display: block; width: 168px; aspect-ratio: 16 / 9; object-fit: cover; border: 1px solid var(--line); background: #eef2f6; }
            .video-link { display: inline-flex; flex-direction: column; gap: 5px; width: 168px; color: #344054; }
            .video-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
            .empty { padding: 28px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); text-align: center; }
            .notice { margin: 0 0 16px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 980px) { main { padding: 16px; } header, .topic-head { display: block; } .meta, .stats { margin-top: 10px; text-align: left; } .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
@endpush

@section('content')
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

            @if (! $available)
                <p class="notice">本機尚未匯入 legacy AI daily tables。</p>
            @endif

            @forelse ($topics as $index => $topic)
                <article class="topic">
                    <div class="topic-head">
                        <div>
                            <h2>{{ $index + 1 }}. <a href="{{ route('ai.events.show', ['id' => $row['pk'] ?? 0, 'event' => $topic['title']]) }}">{{ $topic['title'] }}</a></h2>
                            <div class="chips">
                                @foreach ($topic['keywords'] as $keyword => $count)
                                    <span class="chip hot">{{ $keyword }}({{ $count }})</span>
                                @endforeach
                                @foreach ($topic['people'] as $person => $count)
                                    <span class="chip">{{ $person }}({{ $count }})</span>
                                @endforeach
                            </div>
                        </div>
                        <div class="stats">
                            <div class="stat"><strong>{{ number_format($topic['media_count']) }}</strong><span>媒體數</span></div>
                            <div class="stat"><strong>{{ number_format($topic['video_count']) }}</strong><span>影片數</span></div>
                            <div class="stat"><strong>{{ number_format($topic['party']['green']) }} / {{ number_format($topic['party']['blue']) }}</strong><span>泛綠 / 泛藍</span></div>
                            <div class="stat"><strong>{{ number_format($topic['angle']['台灣']) }} / {{ number_format($topic['angle']['中國']) }}</strong><span>台灣 / 中國角度</span></div>
                        </div>
                    </div>

                    <div class="section-title">媒體事件</div>
                    <ul class="media-events">
                        @foreach ($topic['media_events'] as $channel => $events)
                            <li>
                                <strong>{{ $channel }}</strong>:
                                {{ implode('、', $events) }}
                            </li>
                        @endforeach
                    </ul>

                    @if ($topic['videos'] !== [])
                        <div class="section-title">代表影片</div>
                        <div class="thumbs">
                            @foreach ($topic['videos'] as $video)
                                <a class="video-link" href="https://www.youtube.com/watch?v={{ $video['video_id'] }}" target="_blank" rel="noreferrer">
                                    <img class="thumb" src="https://i.ytimg.com/vi/{{ $video['video_id'] }}/mqdefault.jpg" alt="{{ $video['event'] }}">
                                    <span>{{ $video['channel'] }} · {{ $video['event'] }}</span>
                                </a>
                            @endforeach
                        </div>
                    @endif
                </article>
            @empty
                <div class="empty">{{ $available ? '目前沒有符合條件的 AI daily summary。' : '本機尚未匯入 legacy AI daily tables。' }}</div>
            @endforelse
@endsection
