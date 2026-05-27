@extends('layouts.report')

@section('title')
Legacy Writeback Disabled
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --blocked: #b42318; --blocked-bg: #fee4e2; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 980px; margin: 0 auto; padding: 24px; }
            h1 { margin: 0 0 10px; font-size: 28px; line-height: 1.2; }
            h2 { margin: 24px 0 10px; font-size: 18px; }
            .nav { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
            .panel { border: 1px solid var(--line); background: var(--surface); padding: 14px; margin-bottom: 14px; }
            .blocked { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
            dl { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; gap: 0; margin: 0; border: 1px solid var(--line); background: var(--surface); }
            dt, dd { margin: 0; padding: 10px 12px; border-bottom: 1px solid var(--line); }
            dt { color: #344054; background: #eef2f6; font-weight: 700; }
            dd { min-width: 0; }
            ul { margin: 0; padding-left: 18px; }
            .muted { color: var(--muted); }
            @media (max-width: 720px) { main { padding: 16px; } dl { grid-template-columns: 1fr; } dt { border-bottom: 0; } }
</style>
@endpush

@section('content')
<div class="panel blocked">{{ $blocked_reason }}</div>

            <dl>
                <dt>Legacy endpoint</dt>
                <dd><code>{{ $legacy_path }}</code></dd>
                <dt>Request method</dt>
                <dd>{{ $method }}</dd>
                <dt>Legacy action</dt>
                <dd>{{ $label }}</dd>
                <dt>Writes performed</dt>
                <dd>{{ $writes }}</dd>
                <dt>External calls</dt>
                <dd>{{ $external_calls }}</dd>
                <dt>Safe alternative</dt>
                <dd>{{ $safe_alternative }}</dd>
            </dl>

            <h2>Blocked Side Effects</h2>
            <div class="panel">
                <ul>
                    @foreach ($side_effects as $effect)
                        <li>{{ $effect }}</li>
                    @endforeach
                </ul>
            </div>

            @if ($query !== [])
                <h2>Query</h2>
                <div class="panel"><code>{{ json_encode($query, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) }}</code></div>
            @endif

            <p class="muted">This compatibility endpoint exists to make legacy forms and admin links fail safely while the Laravel rebuild remains read-only.</p>
@endsection
