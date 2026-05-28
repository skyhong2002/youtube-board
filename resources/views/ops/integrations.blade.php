@extends('layouts.report')

@section('title')
整合檢查
@endsection

@section('meta', $meta)

@push('styles')
<style>
        .integration-note {
            max-width: 820px;
            margin: 0 0 16px;
            color: #5f6b7a;
            line-height: 1.55;
        }

        .checks-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 14px;
        }

        .check-card {
            padding: 20px;
            background: #fff;
            border: 1px solid #d8dde5;
            border-radius: 8px;
        }

        .check-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 10px;
        }

        .check-card h2 {
            margin: 0;
            font-size: 18px;
            line-height: 1.3;
        }

        .check-description {
            min-height: 38px;
            margin: 0 0 16px;
            color: #5f6b7a;
            line-height: 1.45;
        }

        .status {
            display: inline-flex;
            align-items: center;
            min-height: 26px;
            padding: 3px 8px;
            border-radius: 6px;
            border: 1px solid #d8dde5;
            background: #f8fafc;
            color: #344054;
            font-size: 12px;
            font-weight: 800;
            white-space: nowrap;
        }

        .status.ok,
        .status.configured {
            border-color: #98d4b2;
            background: #ecfdf3;
            color: #0c7a43;
        }

        .status.missing,
        .status.failed {
            border-color: #fda29b;
            background: #fff1f0;
            color: #b42318;
        }

        .status.not_checked {
            border-color: #f3c46b;
            background: #fff8e6;
            color: #8a5a00;
        }

        dl {
            display: grid;
            grid-template-columns: minmax(118px, 0.42fr) 1fr;
            gap: 10px 16px;
            margin: 0;
            padding: 0;
        }

        dt {
            color: #5f6b7a;
            font-weight: 600;
        }

        dd {
            margin: 0;
            word-break: break-word;
        }

        @media (max-width: 720px) {
            .checks-grid {
                grid-template-columns: 1fr;
            }

            .check-card {
                padding: 18px;
            }

            dl {
                grid-template-columns: 1fr;
                gap: 4px;
            }

            dd {
                margin-bottom: 10px;
            }
        }
</style>
@endpush

@section('content')
    <p class="integration-note">
        @if ($liveProbe)
            Local live probe 已啟用；標示為 live probe 的檢查可能會呼叫外部 API。新文易數 tag.analysis.tw 會使用快取的公開端點 probe。
        @else
            公開 ops 頁面預設只做 config-only checks，不會主動呼叫 YouTube、AI 或 Dokploy。新文易數 tag.analysis.tw 會使用快取的公開端點 probe，不寫資料庫或檔案。
        @endif
    </p>

    <section class="checks-grid" aria-label="整合檢查項目">
        @foreach ($checks as $check)
            <article class="check-card">
                <div class="check-head">
                    <h2>{{ $check['name'] }}</h2>
                    <span class="status {{ $check['state'] }}">{{ $check['status'] }}</span>
                </div>

                <p class="check-description">{{ $check['description'] }}</p>

                <dl>
                    @foreach ($check['details'] as $detail)
                        <dt>{{ $detail['label'] }}</dt>
                        <dd>{{ $detail['value'] }}</dd>
                    @endforeach
                </dl>
            </article>
        @endforeach
    </section>
@endsection
