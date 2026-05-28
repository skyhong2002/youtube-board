@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $row['date_from'] ?? '-' }} - {{ $row['date_to'] ?? '-' }} · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --chip: #f2f4f7; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 0 0 8px; font-size: 19px; }
            .nav, .switcher, .chips, .thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .chip { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); max-width: 320px; text-align: right; }
            .topic { margin: 0 0 14px; padding: 15px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .desc { color: var(--muted); line-height: 1.6; }
            .chip { background: var(--chip); border-color: transparent; margin: 0 4px 4px 0; }
            .chip.hot { background: var(--accent-bg); color: var(--accent); }
            .thumbs { margin-top: 10px; }
            .thumb { display: block; width: 120px; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid var(--line); background: #eef2f6; }
            .notice, .empty { margin: 0 0 14px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 760px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; max-width: none; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                $dateForNav = $date ?: now('Asia/Taipei')->format('Y-m-d');
                $prevDate = \Carbon\CarbonImmutable::parse($dateForNav, 'Asia/Taipei')->subDay()->format('Y-m-d');
                $nextDate = \Carbon\CarbonImmutable::parse($dateForNav, 'Asia/Taipei')->addDay()->format('Y-m-d');
            @endphp



            @if ($channel && $date)
                <nav class="switcher" aria-label="日期">
                    <a href="{{ route('channels.ai.days.date', ['u_id' => $channel['u_id'], 'date' => $prevDate] + $query) }}">{{ $prevDate }}</a>
                    <a class="active" href="{{ route('channels.ai.days.date', ['u_id' => $channel['u_id'], 'date' => $date] + $query) }}">{{ $date }}</a>
                    <a href="{{ route('channels.ai.days.date', ['u_id' => $channel['u_id'], 'date' => $nextDate] + $query) }}">{{ $nextDate }}</a>
                </nav>
            @endif

            @if (! $available)
                <p class="notice">本機尚未匯入 `urt_channel_ai`。<br><x-ingestion-portal job="ai.daily" /></p>
            @endif

            @forelse ($topics as $topic)
                <article class="topic">
                    <h2>{{ $topic['event'] }} <span class="desc">(影片數：{{ number_format($topic['video_count']) }})</span></h2>
                    @if ($topic['description'] !== '')
                        <p class="desc">{{ $topic['description'] }}</p>
                    @endif
                    <div class="chips">
                        @if ($topic['category'] !== '') <span class="chip hot">{{ $topic['category'] }}</span> @endif
                        @if ($topic['camp'] !== '') <span class="chip">{{ $topic['camp'] }}</span> @endif
                        @if ($topic['angle'] !== '') <span class="chip">{{ $topic['angle'] }}</span> @endif
                        @foreach (array_slice($topic['keywords'], 0, 8) as $keyword)
                            <span class="chip">{{ $keyword }}</span>
                        @endforeach
                        @foreach (array_slice(array_merge($topic['people'], $topic['places']), 0, 8) as $name)
                            <span class="chip">{{ $name }}</span>
                        @endforeach
                    </div>
                    @if ($topic['video_ids'] !== [])
                        <div class="thumbs">
                            @foreach (array_slice($topic['video_ids'], 0, 7) as $videoId)
                                <a href="https://www.youtube.com/watch?v={{ $videoId }}" target="_blank" rel="noreferrer">
                                    <img class="thumb" src="https://i.ytimg.com/vi/{{ $videoId }}/default.jpg" alt="{{ $topic['event'] }}">
                                </a>
                            @endforeach
                        </div>
                    @endif
                </article>
            @empty
                <div class="empty">{{ $available ? '目前沒有這天的頻道 AI 重點整理。' : '本機尚未匯入 `urt_channel_ai`。' }}<br><x-ingestion-portal job="ai.daily" /></div>
            @endforelse
@endsection
