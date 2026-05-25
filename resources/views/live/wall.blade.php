@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1480px; margin: 0 auto; padding: 20px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .tabs a { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .tabs a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta { color: var(--muted); white-space: nowrap; }
            .wall { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            .slot { border: 1px solid var(--line); background: var(--surface); }
            .slot-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--line); color: #344054; }
            .frame { width: 100%; aspect-ratio: 16 / 9; background: #111827; }
            iframe { display: block; width: 100%; height: 100%; border: 0; }
            @media (max-width: 860px) { main { padding: 14px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } .wall { grid-template-columns: 1fr; } }
</style>
@endpush

@section('content')
@if ($tabs !== [])
                <nav class="tabs" aria-label="四窗類型">
                    @foreach ($tabs as $tabType => $label)
                        <a class="{{ $type === $tabType ? 'active' : '' }}" href="{{ route('live.wall', ['variant' => 'news', 'type' => $tabType]) }}">{{ $label }}</a>
                    @endforeach
                </nav>
            @endif

            <section class="wall" aria-label="Live wall">
                @foreach ($streams as $stream)
                    <article class="slot">
                        <div class="slot-head">
                            <strong>{{ $stream['slot'] }}. {{ $stream['label'] }}</strong>
                            <a href="https://www.youtube.com/watch?v={{ $stream['video_id'] }}" target="_blank" rel="noreferrer">{{ $stream['video_id'] }}</a>
                        </div>
                        <div class="frame">
                            <iframe src="https://www.youtube.com/embed/{{ $stream['video_id'] }}" title="{{ $stream['label'] }}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                        </div>
                    </article>
                @endforeach
            </section>
@endsection
