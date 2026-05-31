@if (! empty($lineage))
    <section class="lineage" aria-labelledby="lineage-title">
        <div class="lineage-head">
            <div>
                <h2 id="lineage-title">資料來源與更新狀態</h2>
                <p>{{ $lineage['summary'] }}</p>
            </div>
            <a class="lineage-ops" href="{{ route('ops.ingestion') }}">擷取排程</a>
        </div>

        <div class="lineage-graph" aria-label="資料流程圖">
            @foreach ($lineage['graph'] as $node)
                <div class="lineage-node lineage-node-{{ $node['kind'] }}">
                    <span>{{ $node['label'] }}</span>
                    <small>{{ $node['kind'] }}</small>
                </div>
                @if (! $loop->last)
                    @php
                        $edge = $lineage['edges'][$loop->index] ?? null;
                    @endphp
                    <div class="lineage-edge" aria-hidden="true">
                        <span>{{ $edge['label'] ?? 'flow' }}</span>
                    </div>
                @endif
            @endforeach
        </div>

        <div class="lineage-grid">
            <div class="lineage-panel">
                <h3>更新工作</h3>
                @foreach ($lineage['jobs'] as $job)
                    <article class="lineage-job">
                        <strong>{{ $job['label'] }}</strong>
                        <code>{{ $job['command'] }}</code>
                        <p>{{ $job['summary'] }}</p>
                        <dl>
                            <div>
                                <dt>呼叫 API</dt>
                                <dd>
                                    @forelse ($job['api_calls'] as $api)
                                        <code>{{ $api }}</code>
                                    @empty
                                        不呼叫外部 API
                                    @endforelse
                                </dd>
                            </div>
                            <div>
                                <dt>讀取</dt>
                                <dd>{{ ($job['reads'] ?? []) !== [] ? implode('、', $job['reads']) : '外部來源或無' }}</dd>
                            </div>
                            <div>
                                <dt>寫入</dt>
                                <dd>{{ ($job['writes'] ?? []) !== [] ? implode('、', $job['writes']) : '不寫入' }}</dd>
                            </div>
                            <div>
                                <dt>最近觸發</dt>
                                <dd>{{ $job['latest_run_at'] ?? '尚無成功 execute 記錄' }}</dd>
                            </div>
                        </dl>
                    </article>
                @endforeach
            </div>

            <div class="lineage-panel">
                <h3>頁面產生</h3>
                <dl>
                    <div>
                        <dt>Controller</dt>
                        <dd><code>{{ $lineage['render']['controller'] }}</code></dd>
                    </div>
                    <div>
                        <dt>Report service</dt>
                        <dd><code>{{ $lineage['render']['service'] }}</code></dd>
                    </div>
                    <div>
                        <dt>頁面讀取</dt>
                        <dd>{{ implode('、', $lineage['render']['reads']) }}</dd>
                    </div>
                </dl>
                <ol class="lineage-steps">
                    @foreach ($lineage['render']['transforms'] as $step)
                        <li>{{ $step }}</li>
                    @endforeach
                </ol>

                <h3>資料最後更新</h3>
                <dl>
                    @foreach ($lineage['sources'] as $source)
                        <div>
                            <dt>{{ $source['label'] }}</dt>
                            <dd>{{ $source['latest_at'] ?? '未記錄或欄位不存在' }}</dd>
                        </div>
                    @endforeach
                </dl>
            </div>
        </div>

        <div class="lineage-fixed">
            <h3>固定資料，不會由排程更新</h3>
            <div class="lineage-fixed-list">
                @foreach ($lineage['fixed_sources'] as $source)
                    <div>
                        <strong>{{ $source['label'] }}</strong>
                        <code>{{ $source['location'] }}</code>
                        <span>{{ $source['status'] }}</span>
                    </div>
                @endforeach
            </div>
        </div>
    </section>
@endif
