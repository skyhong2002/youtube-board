@extends('layouts.report')

@section('title')
{{ $subject }} {{ $section['title'] }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --warn: #b54708; --warn-bg: #fff8e6; --blocked: #b42318; --blocked-bg: #fee4e2; --ok: #0f766e; --ok-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1040px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .filters, .tabs { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .tabs a, .filters li, .badge { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .tabs a.active { border-color: #f7d58b; background: var(--warn-bg); color: var(--warn); font-weight: 700; }
            .filters { margin: 0 0 16px; padding: 0; list-style: none; }
            .filters li { color: var(--muted); }
            .badge.empty, .badge.missing { border-color: #fecdca; background: var(--blocked-bg); color: var(--blocked); }
            .badge.present { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); }
            .meta { color: var(--muted); text-align: right; }
            .panel { padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .notice { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; } }
</style>
@endpush

@section('content')
<nav class="tabs" aria-label="Tag unavailable subpages">
                <a class="{{ $section['key'] === 'comments' ? 'active' : '' }}" href="{{ route('tags.comments.index', request()->query()) }}">近期留言</a>
                <a class="{{ $section['key'] === 'tag-cloud' ? 'active' : '' }}" href="{{ route('tags.cloud.index', request()->query()) }}">標籤文字雲</a>
                @if (isset($filters['tag']))
                    <a class="{{ $section['key'] === 'keyword-videos' ? 'active' : '' }}" href="{{ route('keywords.videos', ['keyword' => $filters['tag']] + request()->query()) }}">關鍵字影片</a>
                    <a class="{{ $section['key'] === 'keyword-cloud' ? 'active' : '' }}" href="{{ route('keywords.cloud', ['keyword' => $filters['tag']] + request()->query()) }}">關鍵字文字雲</a>
                @endif
            </nav>

            @if ($filters !== [])
                <ul class="filters" aria-label="Legacy filters">
                    @foreach ($filters as $name => $value)
                        <li>{{ $name }}={{ $value }}</li>
                    @endforeach
                </ul>
            @endif

            <section class="panel">
                <p class="notice">Data unavailable locally. {{ $section['reason'] }}</p>
                <p>{{ $section['next_step'] }}</p>
                <table>
                    <thead>
                        <tr>
                            <th>Dependency</th>
                            <th>Rows</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($dependencies as $dependency)
                            <tr>
                                <td><code>{{ $dependency['table'] }}</code></td>
                                <td>{{ $dependency['rows'] === null ? '-' : number_format($dependency['rows']) }}</td>
                                <td><span class="badge {{ $dependency['status'] }}">{{ $dependency['status'] }}</span></td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
                <p class="meta">Legacy source: {{ $section['legacy_file'] }}</p>
            </section>
@endsection
