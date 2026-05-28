@extends('layouts.report')

@section('title')
{{ $title }} 人物觀點
@endsection

@section('meta')
aipk={{ $aipk }} · {{ $generated_at }}
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
            h2 { margin: 24px 0 10px; font-size: 20px; }
            h3 { margin: 0 0 8px; font-size: 16px; }
            .nav, .tabs, .chips { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .tabs { margin: 0 0 16px; }
            .tabs a, .chip { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border-radius: 6px; background: var(--chip); color: #344054; }
            .tabs a { border: 1px solid var(--line); background: var(--surface); }
            .tabs a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .meta, .desc { color: var(--muted); }
            .notice, .empty { margin: 0 0 16px; padding: 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
            .person, .media { padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .person p, .media p { margin: 8px 0 0; line-height: 1.6; }
            .videos { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
            .videos a { font-size: 12px; }
            @media (max-width: 820px) { main { padding: 16px; } header { display: block; } .grid { grid-template-columns: 1fr; } }
</style>
@endpush

@section('content')
<nav class="tabs" aria-label="事件頁面">
                <a href="{{ route('ai.events.show', ['id' => $aipk, 'event' => $event]) }}">事件分析</a>
                <a class="active" href="{{ route('ai.events.people', ['id' => $aipk, 'event' => $event]) }}">人物觀點</a>
                <a href="{{ route('ai.events.wall', ['id' => $aipk, 'event' => $event]) }}">影片牆</a>
            </nav>

            @if (! $history_available)
                <p class="notice">逐日人物演變需要 `urt_ai_period`；{{ $history['blocked_reason'] ?? 'Laravel AI period workflow 會補齊 cached people/media JSON' }}。</p>
            @endif

            @if ($people)
                <h2>人物 @if ($people['main_subject'] !== '') <span class="desc">主體：{{ $people['main_subject'] }}</span> @endif</h2>
                @foreach (['supporting' => '支持者', 'opposing' => '反對者', 'other' => '其他觀點'] as $section => $label)
                    @if ($people[$section] !== [])
                        <h2>{{ $label }}</h2>
                        <div class="grid">
                            @foreach ($people[$section] as $person)
                                <article class="person">
                                    <h3>{{ $person['person'] }}</h3>
                                    <div class="chips">
                                        @if ($person['role'] !== '') <span class="chip">{{ $person['role'] }}</span> @endif
                                        @if ($person['stance'] !== '') <span class="chip">{{ $person['stance'] }}</span> @endif
                                        @if ($person['strength'] !== '') <span class="chip">{{ $person['strength'] }}</span> @endif
                                    </div>
                                    @if ($person['description'] !== '') <p>{{ $person['description'] }}</p> @endif
                                    @if ($person['videos'] !== [])
                                        <div class="videos">
                                            @foreach ($person['videos'] as $video)
                                                <a href="https://youtu.be/{{ $video['video_id'] }}" target="_blank" rel="noreferrer">{{ $video['media'] ?: 'YouTube' }} · {{ $video['video_id'] }}</a>
                                            @endforeach
                                        </div>
                                    @endif
                                </article>
                            @endforeach
                        </div>
                    @endif
                @endforeach
            @else
                <p class="empty">目前沒有 people prompt JSON。</p>
            @endif

            @if ($media)
                <h2>媒體 @if ($media['main_subject'] !== '') <span class="desc">主體：{{ $media['main_subject'] }}</span> @endif</h2>
                @foreach (['supporting' => '支持媒體', 'opposing' => '反對媒體', 'other' => '其他媒體'] as $section => $label)
                    @if ($media[$section] !== [])
                        <h2>{{ $label }}</h2>
                        <div class="grid">
                            @foreach ($media[$section] as $row)
                                <article class="media">
                                    <h3>{{ $row['media'] }}</h3>
                                    <div class="chips">
                                        @if ($row['stance'] !== '') <span class="chip">{{ $row['stance'] }}</span> @endif
                                        @if ($row['strength'] !== '') <span class="chip">{{ $row['strength'] }}</span> @endif
                                    </div>
                                    @if ($row['description'] !== '') <p>{{ $row['description'] }}</p> @endif
                                </article>
                            @endforeach
                        </div>
                    @endif
                @endforeach
            @endif
@endsection
