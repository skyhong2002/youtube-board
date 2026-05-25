@extends('layouts.report')

@section('title')
{{ $group['label'] }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --ok: #0f766e; --ok-bg: #e6f4f1; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1120px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .stats, .tag-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .stat, .tag, .badge { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; }
            .tag { gap: 6px; }
            .badge { min-height: 22px; font-size: 12px; }
            .badge.present { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); }
            .meta { color: var(--muted); text-align: right; }
            .empty { padding: 28px; color: var(--warn); text-align: center; border: 1px solid #f7d58b; background: var(--warn-bg); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; } }
</style>
@endpush

@section('content')
<section class="stats" aria-label="Group detail stats">
                <div class="stat">tags {{ number_format(count($tags)) }}</div>
                <div class="stat">{{ $group['source'] }}</div>
                <div class="stat">read-only membership</div>
            </section>

            @if (! $available)
                <div class="empty">本機沒有這個 group 的 tag membership。Legacy group trend pages still need generated caches.</div>
            @else
                <section class="tag-grid" aria-label="Group tags">
                    @foreach ($tags as $row)
                        <a class="tag" href="{{ route('keywords.days', ['keyword' => $row['tag']]) }}">
                            <span>{{ $row['tag'] }}</span>
                            @if ($row['latest_time'] !== '')
                                <span class="badge present">{{ $row['latest_time'] }}</span>
                            @endif
                        </a>
                    @endforeach
                </section>
            @endif
@endsection
