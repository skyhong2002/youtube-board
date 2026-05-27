@php
    use App\Support\ReportNavigation;

    $sectionTitle = trim($__env->yieldContent('title'));
    $pageTitle = $sectionTitle !== '' ? $sectionTitle : ($title ?? '');
    $pageTitle = $pageTitle === '' ? 'YouTube Board' : $pageTitle;
    $pageMeta = $meta ?? trim($__env->yieldContent('meta'));
    $mainNav = $mainNav ?? ReportNavigation::main(request());
    $systemNav = $systemNav ?? ReportNavigation::system(request());
    $breadcrumbs = $breadcrumbs ?? ReportNavigation::breadcrumbs(request());
    $sectionNav = $sectionNav ?? ReportNavigation::section(request());
@endphp
<!DOCTYPE html>
<html lang="zh-Hant">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{!! $pageTitle !!} - YouTube Board</title>
        <style>
            :root {
                color-scheme: light;
                --bg: #f7f8fa;
                --surface: #ffffff;
                --surface-2: #eef2f6;
                --text: #18202a;
                --muted: #667085;
                --line: #d7dde6;
                --accent: #0f766e;
                --accent-bg: #e6f4f1;
                --link: #0b5cad;
            }

            * { box-sizing: border-box; }

            body {
                margin: 0;
                background: var(--bg);
                color: var(--text);
                font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 14px;
            }

            a { color: var(--link); text-decoration: none; }
            a:hover { text-decoration: underline; }

            .yb-shell {
                max-width: 1400px;
                margin: 0 auto;
                padding: 18px 24px 28px;
            }

            .yb-topbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
                padding: 12px 0 14px;
                border-bottom: 1px solid var(--line);
                margin-bottom: 14px;
            }

            .yb-brand {
                display: inline-flex;
                align-items: center;
                min-height: 32px;
                color: var(--text);
                font-size: 16px;
                font-weight: 800;
                white-space: nowrap;
            }

            .yb-nav,
            .yb-system-nav,
            .yb-section-nav,
            .yb-breadcrumbs {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }

            .yb-nav {
                flex: 1 1 auto;
            }

            .yb-system-nav {
                justify-content: flex-end;
            }

            .yb-nav a,
            .yb-system-nav a,
            .yb-section-nav a {
                display: inline-flex;
                align-items: center;
                min-height: 30px;
                padding: 5px 9px;
                border: 1px solid transparent;
                border-radius: 6px;
                color: #344054;
                font-weight: 650;
                line-height: 1.2;
            }

            .yb-system-nav a {
                min-height: 28px;
                color: var(--muted);
                font-size: 12px;
                font-weight: 600;
            }

            .yb-nav a[aria-current="page"],
            .yb-system-nav a[aria-current="page"],
            .yb-section-nav a[aria-current="page"] {
                border-color: #8ccfbe;
                background: var(--accent-bg);
                color: var(--accent);
                text-decoration: none;
            }

            .yb-breadcrumbs {
                gap: 6px;
                margin: 0 0 10px;
                color: var(--muted);
                font-size: 12px;
            }

            .yb-breadcrumbs a {
                color: var(--muted);
            }

            .yb-breadcrumbs .yb-separator {
                color: #98a2b3;
            }

            .yb-page-header {
                display: flex;
                align-items: flex-end;
                justify-content: space-between;
                gap: 18px;
                margin-bottom: 16px;
            }

            .yb-page-header h1 {
                margin: 0;
                font-size: 28px;
                line-height: 1.2;
            }

            .yb-page-meta {
                color: var(--muted);
                text-align: right;
                white-space: nowrap;
            }

            .yb-section-nav {
                margin: -2px 0 18px;
            }

            .yb-section-nav a {
                border-color: var(--line);
                background: var(--surface);
                font-size: 13px;
            }

            .yb-content {
                min-width: 0;
            }

            .filters,
            .tabs,
            .switcher,
            .subnav,
            .quick,
            .range-nav,
            .actions,
            .stats {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }

            .table-wrap {
                overflow-x: auto;
            }

            table {
                border-collapse: collapse;
            }

            th {
                background: var(--surface-2);
            }

            @media (max-width: 760px) {
                .yb-shell {
                    padding: 12px 16px 22px;
                }

                .yb-topbar,
                .yb-page-header {
                    display: block;
                }

                .yb-brand {
                    margin-bottom: 8px;
                }

                .yb-system-nav {
                    justify-content: flex-start;
                    margin-top: 8px;
                }

                .yb-page-meta {
                    margin-top: 8px;
                    text-align: left;
                    white-space: normal;
                }
            }
        </style>
        @stack('styles')
    </head>
    <body>
        <div class="yb-shell">
            <div class="yb-topbar">
                <a class="yb-brand" href="{{ route('home') }}">YouTube Board</a>
                <nav class="yb-nav" aria-label="主要頁面">
                    @foreach ($mainNav as $item)
                        <a href="{{ $item['url'] }}" @if ($item['active']) aria-current="page" @endif>{{ $item['label'] }}</a>
                    @endforeach
                </nav>
                <nav class="yb-system-nav" aria-label="系統頁面">
                    @foreach ($systemNav as $item)
                        <a href="{{ $item['url'] }}" @if ($item['active']) aria-current="page" @endif>{{ $item['label'] }}</a>
                    @endforeach
                </nav>
            </div>

            @if ($breadcrumbs !== [])
                <nav class="yb-breadcrumbs" aria-label="麵包屑">
                    @foreach ($breadcrumbs as $crumb)
                        @if (! $loop->first)
                            <span class="yb-separator" aria-hidden="true">/</span>
                        @endif

                        @if (! empty($crumb['url']) && ! $loop->last)
                            <a href="{{ $crumb['url'] }}">{{ $crumb['label'] }}</a>
                        @else
                            <span>{{ $crumb['label'] }}</span>
                        @endif
                    @endforeach
                </nav>
            @endif

            <div class="yb-page-header">
                <div>
                    <h1>{!! $pageTitle !!}</h1>
                </div>
                @if ($pageMeta !== '')
                    <div class="yb-page-meta">{!! $pageMeta !!}</div>
                @endif
            </div>

            @if ($sectionNav !== [])
                <nav class="yb-section-nav" aria-label="相關頁面">
                    @foreach ($sectionNav as $item)
                        <a href="{{ $item['url'] }}" @if ($item['active']) aria-current="page" @endif>{{ $item['label'] }}</a>
                    @endforeach
                </nav>
            @endif

            <div class="yb-content">
                @yield('content')
            </div>
        </div>
    </body>
</html>
