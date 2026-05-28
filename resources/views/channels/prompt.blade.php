@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $period['from'] }} - {{ $period['to'] }} · {{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1180px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            h2 { margin: 22px 0 10px; font-size: 18px; }
            .nav, .switcher, .stats { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .stat { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .prompt { width: 100%; min-height: 360px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
            .video { display: grid; grid-template-columns: 96px 1fr auto; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
            .video img { width: 96px; aspect-ratio: 4 / 3; object-fit: cover; background: #eef2f6; }
            .video-title { font-weight: 700; }
            .video-meta { color: var(--muted); margin-top: 4px; }
            .number { font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } .video { grid-template-columns: 72px 1fr; } .video img { width: 72px; } .number { grid-column: 2; text-align: left; } }
</style>
@endpush

@section('content')
@if ($channel)
                <nav class="switcher" aria-label="日期">
                    <a href="{{ route('channels.prompt', ['u_id' => $channel['u_id'], 'date' => $period['previous']] + request()->except('date', 'from', 'to')) }}">{{ $period['previous'] }}</a>
                    <a class="active" href="{{ route('channels.prompt', ['u_id' => $channel['u_id'], 'date' => substr($period['from'], 0, 10)] + request()->except('date', 'from', 'to')) }}">{{ $period['date'] }}</a>
                    <a href="{{ route('channels.prompt', ['u_id' => $channel['u_id'], 'date' => $period['next']] + request()->except('date', 'from', 'to')) }}">{{ $period['next'] }}</a>
                </nav>
            @endif

            <section class="stats" aria-label="Prompt stats">
                <div class="stat">影片 {{ number_format(count($videos)) }} 部</div>
                <div class="stat">事件數 {{ $prompt_bounds['min'] }} - {{ $prompt_bounds['max'] }}</div>
                <div class="stat">AI prompt builder</div>
            </section>

            @if (! $available)
                <div class="empty">本機尚未匯入 `urt_video` 或 `urt_channel`。<br><x-ingestion-portal job="youtube.channels.videos.general" /></div>
            @elseif ($videos === [])
                <div class="empty">這個日期範圍沒有可用影片。<br><x-ingestion-portal job="youtube.channels.videos.general" /></div>
            @else
                <h2>Prompt</h2>
                <textarea class="prompt" readonly>{{ $prompt }}</textarea>

                <h2>影片來源</h2>
                @foreach ($videos as $video)
                    <article class="video">
                        <a href="{{ $video['watch_url'] }}" target="_blank" rel="noreferrer"><img src="{{ $video['thumbnail'] }}" alt="{{ $video['title'] }}"></a>
                        <div>
                            <a class="video-title" href="{{ $video['watch_url'] }}" target="_blank" rel="noreferrer">{{ $video['title'] }}</a>
                            <div class="video-meta">{{ $video['video_id'] }} · {{ $video['published_at'] }}</div>
                        </div>
                        <div class="number">{{ number_format($video['view_count']) }} views<br>{{ number_format($video['comment_count']) }} comments</div>
                    </article>
                @endforeach
            @endif
@endsection
