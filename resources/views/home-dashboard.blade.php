@extends('layouts.report')

@section('title')
總覽
@endsection

@section('meta')
{{ $categoriesAvailable ? number_format($categorySummary['visible_tags']) : 0 }} 分類 · {{ count($keywordRows) }} 關鍵字 · {{ $categoryGeneratedAt }}
@endsection

@push('styles')
<style>
:root { color-scheme: light; --bg: #f7f8fa; --surface: #fff; --text: #18202a; --muted: #667085; --line: #d7dde6; --accent: #0f766e; --accent-bg: #e6f4f1; --link: #0b5cad; --warn: #b54708; --warn-bg: #fff8e6; }
            * { box-sizing: border-box; }
            body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
            a { color: var(--link); text-decoration: none; }
            a:hover { text-decoration: underline; }
            main { max-width: 1280px; margin: 0 auto; padding: 24px; }
            h2 { margin: 0 0 10px; font-size: 16px; line-height: 1.3; }
            h3 { margin: 0; font-size: 14px; line-height: 1.35; }
            p { margin: 0; }
            .intro { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); gap: 16px; margin-bottom: 18px; }
            .intro-text, .metric, .panel, .route-card { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
            .intro-text { padding: 18px; }
            .intro-text p { max-width: 760px; color: #344054; font-size: 15px; line-height: 1.7; }
            .actions, .route-grid, .row-actions { display: flex; flex-wrap: wrap; gap: 8px; }
            .actions { margin-top: 14px; }
            .action, .row-actions a { display: inline-flex; align-items: center; min-height: 32px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: #344054; font-weight: 650; line-height: 1.2; }
            .action.primary { border-color: #8ccfbe; background: var(--accent-bg); color: var(--accent); }
            .metrics { display: grid; grid-template-columns: 1fr; gap: 10px; }
            .metric { padding: 13px; }
            .metric-label { color: var(--muted); font-size: 12px; }
            .metric-value { margin-top: 4px; font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
            .route-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 18px; }
            .route-card { display: grid; align-content: start; gap: 8px; min-height: 136px; padding: 14px; color: var(--text); }
            .route-card:hover { text-decoration: none; border-color: #8ccfbe; }
            .route-card p { color: var(--muted); line-height: 1.45; }
            .panels { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
            .panel { min-width: 0; padding: 14px; }
            .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
            .panel-head a { font-size: 12px; font-weight: 700; }
            .list { display: grid; gap: 8px; }
            .list-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); }
            .list-row:first-child { border-top: 0; padding-top: 0; }
            .primary-text { font-weight: 800; overflow-wrap: anywhere; }
            .secondary-text { margin-top: 3px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
            .row-actions { justify-content: flex-end; }
            .row-actions a { min-height: 26px; padding: 3px 8px; font-size: 12px; white-space: nowrap; }
            .notice { padding: 10px 12px; border: 1px solid #f7d58b; border-radius: 6px; background: var(--warn-bg); color: var(--warn); }
            @media (max-width: 980px) { .intro, .panels { grid-template-columns: 1fr; } .route-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
            @media (max-width: 620px) { main { padding: 16px; } .route-grid { grid-template-columns: 1fr; } .list-row { grid-template-columns: 1fr; } .row-actions { justify-content: flex-start; } }
</style>
@endpush

@section('content')
<section class="intro" aria-label="網站總覽">
                <div class="intro-text">
                    <h2>YouTube Board 在做什麼</h2>
                    <p>這裡把公開 YouTube 頻道、直播、影片、關鍵字和主題群組整理成即時 YouTube 資料儀表板。先看即時直播熱度，再用分類或關鍵字追到頻道、影片、留言、趨勢和 AI 摘要。</p>
                    <div class="actions">
                        <a class="action primary" href="{{ route('live.current', ['or' => '1,2,12,13,14,81']) }}">看目前直播</a>
                        <a class="action" href="{{ route('tags.index') }}">瀏覽分類</a>
                        <a class="action" href="{{ route('keywords.index') }}">查關鍵字</a>
                        <a class="action" href="{{ route('ai.days.index') }}">看 AI 摘要</a>
                    </div>
                </div>
                <div class="metrics" aria-label="資料摘要">
                    <div class="metric">
                        <div class="metric-label">分類數</div>
                        <div class="metric-value">{{ number_format($categorySummary['visible_tags']) }}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">分類頻道筆數</div>
                        <div class="metric-value">{{ number_format($categorySummary['total_channels']) }}</div>
                    </div>
                    <div class="metric">
                        <div class="metric-label">週觀看總量</div>
                        <div class="metric-value">{{ number_format($categorySummary['weekly_views']) }}</div>
                    </div>
                </div>
            </section>

            <section class="route-grid" aria-label="主要入口">
                <a class="route-card" href="{{ route('live.current', ['or' => '1,2,12,13,14,81']) }}">
                    <h3>直播</h3>
                    <p>目前直播排行、帶狀直播、單日與期間排行。</p>
                </a>
                <a class="route-card" href="{{ route('tags.index') }}">
                    <h3>分類</h3>
                    <p>從分類進到頻道、影片、留言、文字雲和趨勢。</p>
                </a>
                <a class="route-card" href="{{ route('keywords.index') }}">
                    <h3>關鍵字</h3>
                    <p>用人物、事件或詞彙追影片、文字雲和群組趨勢。</p>
                </a>
                <a class="route-card" href="{{ route('groups.index') }}">
                    <h3>群組</h3>
                    <p>查看主題群組的排名、直播表現和長期趨勢。</p>
                </a>
                <a class="route-card" href="{{ route('ai.days.index') }}">
                    <h3>AI</h3>
                    <p>每日、每小時、期間事件與頻道重點摘要。</p>
                </a>
                <a class="route-card" href="{{ route('mayor.index') }}">
                    <h3>市長</h3>
                    <p>縣市候選人與地方政治關鍵字報表。</p>
                </a>
            </section>

            <section class="panels" aria-label="熱門入口">
                <div class="panel">
                    <div class="panel-head">
                        <h2>熱門分類</h2>
                        <a href="{{ route('tags.index') }}">全部分類</a>
                    </div>
                    @if (! $categoriesAvailable)
                        <p class="notice">本機尚未匯入 legacy tag/count tables。<br><x-ingestion-portal job="youtube.channels.stats" /></p>
                    @else
                        <div class="list">
                            @foreach ($categoryRows as $row)
                                <div class="list-row">
                                    <div>
                                        <a class="primary-text" href="{{ route('tags.channels', ['tagId' => $row['tag_id']]) }}">{{ $row['name'] }}</a>
                                        <div class="secondary-text">{{ number_format($row['num']) }} channels · {{ number_format($row['total']) }} weekly views</div>
                                    </div>
                                    <div class="row-actions">
                                        <a href="{{ route('tags.videos', ['tagId' => $row['tag_id']]) }}">影片</a>
                                        <a href="{{ route('tags.cloud', ['tagId' => $row['tag_id']]) }}">文字雲</a>
                                        <a href="{{ route('tags.trends', ['tagId' => $row['tag_id']]) }}">趨勢</a>
                                    </div>
                                </div>
                            @endforeach
                        </div>
                    @endif
                </div>

                <div class="panel">
                    <div class="panel-head">
                        <h2>熱門關鍵字</h2>
                        <a href="{{ route('keywords.index') }}">全部關鍵字</a>
                    </div>
                    @if (! $keywordsAvailable)
                        <p class="notice">本機尚未匯入 legacy tags table。<br><x-ingestion-portal job="youtube.channels.stats" /></p>
                    @else
                        <div class="list">
                            @foreach ($keywordRows as $row)
                                <div class="list-row">
                                    <div>
                                        <a class="primary-text" href="{{ route('keywords.days', ['keyword' => $row['tag']]) }}">{{ $row['tag'] }}</a>
                                        <div class="secondary-text">
                                            weight {{ number_format($row['weight_score']) }}
                                            @if ($row['views'] !== null)
                                                · {{ number_format($row['views']) }} views
                                            @endif
                                        </div>
                                    </div>
                                    <div class="row-actions">
                                        <a href="{{ route('keywords.videos', ['keyword' => $row['tag']]) }}">影片</a>
                                        <a href="{{ route('keywords.cloud', ['keyword' => $row['tag'], 'days' => 3]) }}">文字雲</a>
                                        <a href="{{ route('keywords.live.trends', ['keyword' => $row['tag']]) }}">直播趨勢</a>
                                    </div>
                                </div>
                            @endforeach
                        </div>
                    @endif
                    @unless ($cachedMetricsAvailable)
                        <p class="secondary-text">`urt_show_data.tags_all` 尚無快取，觀看數可能暫時空白。</p>
                    @endunless
                </div>
            </section>
@endsection
