@php
    use App\Support\ReportFreshness;
    use App\Support\ReportNavigation;

    $sectionTitle = trim($__env->yieldContent('title'));
    $pageTitle = $sectionTitle !== '' ? $sectionTitle : ($title ?? '');
    $pageTitle = $pageTitle === '' ? 'YouTube Board' : $pageTitle;
    $pageMeta = $meta ?? trim($__env->yieldContent('meta'));
    $freshness = app(ReportFreshness::class);
    $pageMeta = $freshness->replaceMetaTimestamp($pageMeta, $freshness->forRequest(request()));
    $mainNav = $mainNav ?? ReportNavigation::main(request());
    $systemNav = $systemNav ?? ReportNavigation::system(request());
    $breadcrumbs = $breadcrumbs ?? ReportNavigation::breadcrumbs(request());
    $sectionNav = $sectionNav ?? ReportNavigation::section(request());
    $legacyPublicSiteUrl = rtrim((string) config('legacy.public_site_url', 'https://youtube.board.tw'), '/');
    $routeName = (string) (request()->route()?->getName() ?? '');
    $footerLinks = [
        ['label' => '擷取排程', 'url' => route('ops.ingestion'), 'active' => str_starts_with($routeName, 'ops.ingestion')],
        ['label' => '整合檢查', 'url' => route('ops.integrations'), 'active' => $routeName === 'ops.integrations' || str_starts_with($routeName, 'dev.')],
    ];

    if ($legacyPublicSiteUrl !== '') {
        $footerLinks[] = ['label' => '現行站台', 'url' => $legacyPublicSiteUrl, 'external' => true, 'active' => false];
    }

    if (count($sectionNav) === 1 && ($sectionNav[0]['active'] ?? false)) {
        $sectionNav = [];
    }
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

            .yb-footer {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 18px;
                margin-top: 34px;
                padding-top: 18px;
                border-top: 1px solid var(--line);
                color: var(--muted);
                font-size: 12px;
                line-height: 1.6;
            }

            .yb-footer-summary {
                max-width: 640px;
            }

            .yb-footer-summary strong {
                display: block;
                color: #344054;
                font-size: 13px;
            }

            .yb-footer-nav {
                display: flex;
                flex: 0 1 560px;
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 8px 12px;
            }

            .yb-footer-nav a {
                color: var(--muted);
                font-weight: 650;
                white-space: nowrap;
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

            .report-table {
                width: 100%;
                min-width: var(--report-table-min-width, 960px);
                border-collapse: collapse;
                table-layout: fixed;
            }

            .report-table th,
            .report-table td {
                overflow-wrap: anywhere;
            }

            .report-table .report-col-rank {
                width: var(--report-col-rank, 56px);
            }

            .report-table .report-col-thumb {
                width: var(--report-col-thumb, 88px);
            }

            .report-table .report-col-name,
            .report-table .report-col-keyword,
            .report-table .report-col-channel {
                width: var(--report-col-label, 180px);
            }

            .report-table .report-col-time {
                width: var(--report-col-time, 150px);
            }

            .report-table .report-col-date {
                width: var(--report-col-date, 118px);
            }

            .report-table .report-col-number {
                width: var(--report-col-number, 104px);
            }

            .report-table .report-col-actions {
                width: var(--report-col-actions, 360px);
            }

            .report-table .report-col-trend {
                width: var(--report-col-trend, 180px);
            }

            .report-table .report-col-fill {
                width: auto;
            }

            .report-table .rank,
            .report-table .number {
                text-align: right;
                font-variant-numeric: tabular-nums;
                white-space: nowrap;
            }

            .report-table .time,
            .report-table .trend {
                white-space: nowrap;
            }

            .report-table .tag-name,
            .report-table .keyword,
            .report-table .name,
            .report-table .channel {
                min-width: 0;
            }

            .report-table .title-cell {
                min-width: 0;
                line-height: 1.45;
            }

            .report-table .row-actions {
                min-width: 0;
                gap: 6px;
            }

            .yb-ingestion-portal {
                display: inline-flex;
                align-items: center;
                min-height: 24px;
                margin-top: 6px;
                padding: 3px 9px;
                border: 1px solid #b7ded6;
                border-radius: 6px;
                background: var(--accent-bg);
                color: var(--accent);
                font-size: 12px;
                font-weight: 650;
                text-decoration: none;
            }

            .yb-ingestion-portal:hover {
                background: #d1ebe6;
                text-decoration: none;
            }

            .d3-word-cloud {
                position: relative;
                min-height: 420px;
                padding: 0;
                overflow: hidden;
                border: 1px solid var(--line);
                border-radius: 8px;
                background: var(--surface);
            }

            .d3-word-cloud svg {
                display: block;
                width: 100%;
                height: 100%;
                min-height: 420px;
            }

            .d3-word-cloud text {
                font-family: "Microsoft JhengHei", "微軟正黑體", Impact, ui-sans-serif, system-ui, sans-serif;
                font-weight: 700;
                cursor: pointer;
            }

            .d3-word-cloud-fallback {
                position: absolute;
                inset: 0;
                display: flex;
                flex-wrap: wrap;
                align-content: center;
                justify-content: center;
                gap: 9px 14px;
                padding: 20px;
            }

            .d3-word-cloud.is-rendered .d3-word-cloud-fallback {
                display: none;
            }

            .d3-word-cloud-fallback a {
                display: inline-flex;
                align-items: center;
                color: hsl(var(--hue), 62%, 34%);
                font-weight: 700;
                line-height: 1.05;
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

                .yb-footer {
                    display: block;
                }

                .yb-footer-nav {
                    justify-content: flex-start;
                    margin-top: 10px;
                }

                .d3-word-cloud { min-height: 360px; }
                .d3-word-cloud svg { min-height: 360px; }
                .d3-word-cloud-fallback { padding: 14px; }
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
                @if ($systemNav !== [])
                    <nav class="yb-system-nav" aria-label="系統頁面">
                        @foreach ($systemNav as $item)
                            <a href="{{ $item['url'] }}" @if ($item['active']) aria-current="page" @endif>{{ $item['label'] }}</a>
                        @endforeach
                    </nav>
                @endif
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

            <footer class="yb-footer" aria-label="頁尾">
                <div class="yb-footer-summary">
                    <strong>YouTube Board</strong>
                    <span>即時 YouTube 資料擷取儀表板；報表瀏覽、快取重建、排程與 AI 工作流由 ops 工作台控管。</span>
                </div>
                <nav class="yb-footer-nav" aria-label="頁尾連結">
                    @foreach ($footerLinks as $item)
                        <a href="{{ $item['url'] }}" @if ($item['active'] ?? false) aria-current="page" @endif @if ($item['external'] ?? false) rel="noopener noreferrer" target="_blank" @endif>{{ $item['label'] }}</a>
                    @endforeach
                </nav>
            </footer>
        </div>
        @stack('scripts')
    </body>
</html>
