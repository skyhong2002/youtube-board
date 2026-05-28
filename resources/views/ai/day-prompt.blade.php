@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $period['from'] ?: '-' }} - {{ $period['to'] ?: '-' }} · {{ $generated_at }}
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
            .nav, .switcher, .filters, .stats { display: flex; flex-wrap: wrap; gap: 8px; }
            .nav { gap: 12px; margin-bottom: 10px; }
            .switcher { margin-bottom: 14px; }
            .switcher a, .filters li, .stat { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .switcher a.active { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { min-height: 24px; color: var(--muted); font-size: 12px; }
            .meta { color: var(--muted); white-space: nowrap; }
            .prompt { width: 100%; min-height: 420px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
            .media { margin: 0 0 12px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .media h3 { margin: 0 0 8px; font-size: 17px; }
            .event { margin: 8px 0 0; color: var(--muted); line-height: 1.5; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; white-space: normal; } }
</style>
@endpush

@section('content')
@php
                $query = request()->query();
                $dateQuery = $query;
                unset($dateQuery['date'], $dateQuery['from'], $dateQuery['to']);
                $conditionQuery = $query;
                unset($conditionQuery['condition'], $conditionQuery['tagid'], $conditionQuery['or'], $conditionQuery['not']);
            @endphp



            @if ($date)
                <nav class="switcher" aria-label="日期">
                    <a href="{{ route('ai.days.prompt', ['date' => $period['previous']] + $dateQuery) }}">{{ $period['previous'] }}</a>
                    <a class="active" href="{{ route('ai.days.prompt', ['date' => $date] + $dateQuery) }}">{{ $date }}</a>
                    <a href="{{ route('ai.days.prompt', ['date' => $period['next']] + $dateQuery) }}">{{ $period['next'] }}</a>
                </nav>

                <nav class="switcher" aria-label="條件">
                    @foreach (['all' => '全部', 'green' => '泛綠', 'blue' => '泛藍', 'neutral' => '較無偏', 'finance' => '財經', 'world' => '世界'] as $key => $label)
                        <a class="{{ $condition === $key ? 'active' : '' }}" href="{{ route('ai.days.condition.prompt', ['date' => $date, 'condition' => $key] + $conditionQuery) }}">{{ $label }}</a>
                    @endforeach
                </nav>
            @endif

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            <section class="stats" aria-label="Prompt stats">
                <div class="stat">媒體 {{ number_format(count($rows)) }}</div>
                <div class="stat">事件數 {{ $prompt_bounds['min'] }} - {{ $prompt_bounds['max'] }}</div>
                <div class="stat">AI prompt builder</div>
            </section>

            @if (! $available)
                <div class="empty">本機尚未匯入 `urt_channel_ai` 或相關 channel tables。</div>
            @elseif ($rows === [])
                <div class="empty">這個日期與條件目前沒有可用的每日 AI prompt 來源資料。</div>
            @else
                <h2>Prompt</h2>
                <textarea class="prompt" readonly>{{ $prompt }}</textarea>

                <h2>媒體事件來源</h2>
                @foreach ($rows as $row)
                    <article class="media">
                        <h3><a href="{{ route('channels.show', ['u_id' => $row['u_id']]) }}">{{ $row['title'] }}</a> <span class="meta">影片 {{ number_format($row['video_count']) }}</span></h3>
                        @forelse ($row['events'] as $event)
                            <div class="event">
                                <strong>{{ $event['event'] }}</strong>
                                @if ($event['description'] !== '')
                                    <div>{{ $event['description'] }}</div>
                                @endif
                                <div>新聞數 {{ number_format($event['video_count']) }} · {{ implode(', ', array_slice($event['keywords'], 0, 8)) }}</div>
                            </div>
                        @empty
                            <div class="event">這個媒體沒有符合 legacy prompt 條件的事件。</div>
                        @endforelse
                    </article>
                @endforeach
            @endif
@endsection
