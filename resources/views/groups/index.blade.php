@extends('layouts.report')

@section('title')
{{ $title }}
@endsection

@section('meta')
{{ $generated_at }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --ok: #0f766e; --ok-bg: #e6f4f1; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: #0b5cad; text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1120px; margin: 0 auto; padding: 24px; }
            header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 28px; line-height: 1.2; }
            .nav, .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
            .stat, .badge { display: inline-flex; align-items: center; min-height: 26px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-size: 12px; }
            .badge.present { border-color: #8ccfbe; background: var(--ok-bg); color: var(--ok); }
            .meta { color: var(--muted); text-align: right; }
            table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); }
            th, td { padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left; }
            th { background: #eef2f6; color: #344054; font-size: 12px; }
            td.number { text-align: right; white-space: nowrap; }
            .empty { padding: 28px; color: var(--muted); text-align: center; border: 1px solid var(--line); background: var(--surface); }
            @media (max-width: 720px) { main { padding: 16px; } header { display: block; } .meta { margin-top: 8px; text-align: left; } }
</style>
@endpush

@section('content')
<section class="stats" aria-label="Group stats">
                <div class="stat">groups {{ number_format(count($groups)) }}</div>
                @foreach ($dependencies as $dependency)
                    <div class="stat">{{ $dependency['table'] }} {{ $dependency['rows'] === null ? '-' : number_format($dependency['rows']) }}</div>
                @endforeach
                <div class="stat">live membership</div>
            </section>

            @if (! $available && $groups === [])
                <div class="empty">本機尚未匯入 `tag_group`。<br><x-ingestion-portal job="reports.groups.build" /></div>
            @else
                <table>
                    <thead>
                        <tr>
                            <th>Group</th>
                            <th>Source</th>
                            <th>Tags</th>
                            <th>Latest</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($groups as $group)
                            <tr>
                                <td><a href="{{ route('groups.show', ['groupName' => $group['name']]) }}">{{ $group['label'] }}</a></td>
                                <td><span class="badge present">{{ $group['source'] }}</span></td>
                                <td class="number">{{ number_format($group['tags_count']) }}</td>
                                <td>{{ $group['latest_time'] ?: '-' }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            @endif
@endsection
