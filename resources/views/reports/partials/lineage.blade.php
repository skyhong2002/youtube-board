@if (! empty($lineage))
    @php
        $graphPayload = [
            'nodes' => $lineage['graph'] ?? [],
            'edges' => $lineage['edges'] ?? [],
        ];
        $lineagePanelId = 'lineage-panel-'.substr(md5((string) ($lineage['title'] ?? 'report-lineage')), 0, 10);
    @endphp

    @once
        @push('styles')
            <style>
                .lineage { margin: 0 0 18px; padding: 0; }
                .lineage h2, .lineage h3, .lineage p { margin: 0; }
                .lineage h2 { font-size: 18px; line-height: 1.25; }
                .lineage h3 { margin-bottom: 10px; color: #344054; font-size: 14px; }
                .lineage p { color: var(--muted); line-height: 1.55; }
                .lineage code { display: inline-block; max-width: 100%; overflow-wrap: anywhere; color: #344054; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
                .lineage-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; }
                .lineage-toggle span { display: block; font-size: 15px; font-weight: 800; line-height: 1.25; }
                .lineage-toggle small { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 600; line-height: 1.35; }
                .lineage-toggle strong { flex: 0 0 auto; color: var(--accent); font-size: 12px; font-weight: 800; }
                .lineage-toggle:hover { border-color: #b7ded6; background: #fbfffe; }
                .lineage-panel { margin-top: 8px; }
                .lineage-panel[hidden] { display: none; }
                .lineage-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
                .lineage-ops { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 30px; padding: 5px 10px; border: 1px solid #b7ded6; border-radius: 6px; background: var(--accent-bg); color: var(--accent); font-size: 12px; font-weight: 700; }
                .lineage-flow { display: grid; gap: 8px; margin-bottom: 0; }
                .lineage-graph { min-height: 158px; overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
                .lineage-graph svg { display: block; min-width: 760px; width: auto; height: auto; }
                .lineage-fallback { display: flex; align-items: stretch; gap: 8px; min-width: 760px; padding: 8px; }
                .lineage-node, .lineage-edge { min-height: 76px; border: 1px solid var(--line); border-radius: 6px; background: #f9fbfd; }
                .lineage-node { display: flex; flex: 0 0 148px; flex-direction: column; justify-content: center; gap: 4px; padding: 8px; }
                .lineage-node span { color: var(--text); font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
                .lineage-node em { color: #475467; font-size: 11px; font-style: normal; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
                .lineage-node small { color: var(--muted); font-size: 11px; text-transform: uppercase; }
                .lineage-node-api { border-color: #a7c7e7; background: #edf6ff; }
                .lineage-node-table { border-color: #c7d7a7; background: #f5faec; }
                .lineage-node-cache { border-color: #e6c58f; background: #fff7e8; }
                .lineage-node-service { border-color: #b7ded6; background: var(--accent-bg); }
                .lineage-node-page { border-color: #c7b7df; background: #f5f0ff; }
                .lineage-node-fixed { border-color: #d0c4a8; background: #f9f4e8; }
                .lineage-edge { display: flex; flex: 0 0 64px; align-items: center; justify-content: center; color: var(--muted); font-size: 11px; font-weight: 700; text-align: center; position: relative; }
                .lineage-edge::before { content: ""; position: absolute; left: 8px; right: 8px; top: 50%; border-top: 1px solid #98a2b3; }
                .lineage-edge::after { content: ""; position: absolute; right: 8px; top: calc(50% - 4px); width: 8px; height: 8px; border-top: 1px solid #98a2b3; border-right: 1px solid #98a2b3; transform: rotate(45deg); background: transparent; }
                .lineage-edge span { position: relative; z-index: 1; padding: 2px 5px; background: #f9fbfd; }
                .lineage-svg-node { cursor: pointer; outline: none; }
                .lineage-svg-node rect { transition: stroke-width .12s ease, filter .12s ease; }
                .lineage-svg-node:hover rect, .lineage-svg-node:focus rect, .lineage-svg-node.is-active rect { filter: drop-shadow(0 2px 3px rgb(16 24 40 / 18%)); stroke-width: 2.4; }
                .lineage-detail { min-height: 128px; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
                .lineage-detail[hidden] { display: none; }
                .lineage-detail h3 { margin-bottom: 6px; font-size: 16px; }
                .lineage-detail p { margin-bottom: 8px; color: #344054; }
                .lineage dl { display: grid; gap: 6px; margin: 8px 0 0; }
                .lineage dl div { display: grid; grid-template-columns: 152px minmax(0, 1fr); gap: 8px; }
                .lineage dt { color: var(--muted); font-size: 12px; font-weight: 700; }
                .lineage dd { margin: 0; min-width: 0; color: #344054; line-height: 1.45; white-space: pre-line; }
                @media (max-width: 720px) { .lineage-toggle { align-items: flex-start; } .lineage-head { display: block; } .lineage-ops { margin-top: 10px; } .lineage dl div { grid-template-columns: 1fr; gap: 2px; } }
            </style>
        @endpush

        @push('scripts')
            <script src="https://d3js.org/d3.v7.min.js"></script>
            <script>
                (function () {
                    function renderLineage(container) {
                        if (!window.d3) {
                            return;
                        }

                        var payload = JSON.parse(container.getAttribute('data-lineage-graph') || '{"nodes":[],"edges":[]}');
                        var nodes = payload.nodes || [];
                        var edges = payload.edges || [];

                        if (!nodes.length) {
                            return;
                        }

                        var detail = container.closest('[data-lineage-flow]').querySelector('[data-lineage-detail]');
                        var fallback = container.querySelector('[data-lineage-fallback]');
                        var minNodeWidth = 150;
                        var maxNodeWidth = 320;
                        var nodeHeight = 76;
                        var nodeTopOffset = 20;
                        var margin = { top: 18, right: 24, bottom: 42, left: 24 };
                        var nodeWidths = nodes.map(function (node) {
                            var label = String(node.label || '');
                            var status = String(node.status || '');

                            return clamp(Math.max(estimateTextWidth(label, 14), estimateTextWidth(status, 11)) + 32, minNodeWidth, maxNodeWidth);
                        });
                        var edgeGaps = edges.map(function (edge) {
                            var label = String(edge.label || '');

                            return Math.max(128, estimateTextWidth(label, 12) + 88);
                        });
                        var chartWidth = margin.left + margin.right
                            + nodeWidths.reduce(function (sum, nodeWidth) { return sum + nodeWidth; }, 0)
                            + edgeGaps.reduce(function (sum, gap) { return sum + gap; }, 0);
                        var width = Math.max(container.clientWidth || 760, chartWidth);
                        var height = margin.top + nodeTopOffset + nodeHeight + margin.bottom;
                        var color = {
                            api: ['#edf6ff', '#7fb4df'],
                            table: ['#f5faec', '#b7cf87'],
                            cache: ['#fff7e8', '#e6bd75'],
                            service: ['#e6f4f1', '#8ccfbe'],
                            page: ['#f5f0ff', '#bba8df'],
                            fixed: ['#f9f4e8', '#d0c4a8'],
                        };

                        container.classList.add('is-rendered');
                        if (fallback) {
                            fallback.hidden = true;
                        }
                        container.innerHTML = '';

                        nodes.forEach(function (node, index) {
                            var previousGaps = edgeGaps.slice(0, index).reduce(function (sum, gap) { return sum + gap; }, 0);
                            var previousWidths = nodeWidths.slice(0, index).reduce(function (sum, nodeWidth) { return sum + nodeWidth; }, 0);
                            node.width = nodeWidths[index];
                            node.statusWidth = node.width + Math.max(0, (edgeGaps[index] || 0) - 24);
                            node.x = margin.left + previousWidths + previousGaps;
                            node.y = margin.top + nodeTopOffset;
                        });

                        if (!container.dataset.wheelScrollBound) {
                            container.addEventListener('wheel', function (event) {
                                if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                                    return;
                                }

                                container.scrollLeft += event.deltaY;
                                event.preventDefault();
                            }, { passive: false });
                            container.dataset.wheelScrollBound = '1';
                        }

                        var svg = d3.select(container)
                            .append('svg')
                            .attr('width', width)
                            .attr('height', height)
                            .attr('viewBox', '0 0 ' + width + ' ' + height)
                            .attr('role', 'img')
                            .attr('aria-label', '資料流程圖');

                        svg.append('defs')
                            .append('marker')
                            .attr('id', 'lineage-arrow')
                            .attr('viewBox', '0 -5 10 10')
                            .attr('refX', 8)
                            .attr('refY', 0)
                            .attr('markerWidth', 7)
                            .attr('markerHeight', 7)
                            .attr('orient', 'auto')
                            .append('path')
                            .attr('d', 'M0,-5L10,0L0,5')
                            .attr('fill', '#98a2b3');

                        var byId = new Map(nodes.map(function (node) { return [node.id, node]; }));

                        var link = svg.append('g')
                            .selectAll('g')
                            .data(edges)
                            .enter()
                            .append('g')
                            .attr('class', 'lineage-link');

                        link.append('path')
                            .attr('d', function (edge) {
                                var source = byId.get(edge.from);
                                var target = byId.get(edge.to);
                                if (!source || !target) {
                                    return '';
                                }

                                var x1 = source.x + source.width;
                                var y1 = source.y + nodeHeight / 2;
                                var x2 = target.x;
                                var y2 = target.y + nodeHeight / 2;
                                var mid = (x1 + x2) / 2;
                                return 'M' + x1 + ',' + y1 + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + (x2 - 10) + ',' + y2;
                            })
                            .attr('fill', 'none')
                            .attr('stroke', '#98a2b3')
                            .attr('stroke-width', 1.4)
                            .attr('marker-end', 'url(#lineage-arrow)');

                        link.append('text')
                            .attr('x', function (edge) {
                                var source = byId.get(edge.from);
                                var target = byId.get(edge.to);
                                if (!source || !target) {
                                    return 0;
                                }

                                return (source.x + source.width + target.x) / 2;
                            })
                            .attr('y', function (edge) {
                                var source = byId.get(edge.from);
                                var target = byId.get(edge.to);
                                if (!source || !target) {
                                    return 0;
                                }

                                return source.y + (nodeHeight / 2) - 12;
                            })
                            .attr('text-anchor', 'middle')
                            .attr('dominant-baseline', 'middle')
                            .attr('fill', '#667085')
                            .attr('font-size', 12)
                            .attr('font-weight', 700)
                            .text(function (edge) { return edge.label || ''; });

                        var item = svg.append('g')
                            .selectAll('g')
                            .data(nodes)
                            .enter()
                            .append('g')
                            .attr('class', 'lineage-svg-node')
                            .attr('tabindex', 0)
                            .attr('role', 'button')
                            .attr('aria-label', function (node) { return node.title || node.label; })
                            .attr('transform', function (node) { return 'translate(' + node.x + ',' + node.y + ')'; })
                            .on('mouseenter focus', function (event, node) {
                                selectNode(eventDatum(this, event, node));
                            })
                            .on('click', function (event, node) {
                                selectNode(eventDatum(this, event, node));
                            })
                            .on('keydown', function (event, node) {
                                var key = event && event.key ? event.key : '';

                                if (key === 'Enter' || key === ' ') {
                                    event.preventDefault();
                                    selectNode(eventDatum(this, event, node));
                                }
                            });

                        item.append('rect')
                            .attr('width', function (node) { return node.width; })
                            .attr('height', nodeHeight)
                            .attr('rx', 6)
                            .attr('fill', function (node) { return (color[node.kind] || color.table)[0]; })
                            .attr('stroke', function (node) { return (color[node.kind] || color.table)[1]; })
                            .attr('stroke-width', 1.2);

                        item.append('text')
                            .attr('x', 12)
                            .attr('y', 24)
                            .attr('fill', '#18202a')
                            .attr('font-size', 14)
                            .attr('font-weight', 800)
                            .selectAll('tspan')
                            .data(function (node) {
                                return wrapWords(node.label, Math.max(10, Math.floor((node.width - 24) / 8))).slice(0, 2);
                            })
                            .enter()
                            .append('tspan')
                            .attr('x', 12)
                            .attr('dy', function (_word, index) { return index === 0 ? 0 : 16; })
                            .text(function (word) { return word; });

                        item.append('text')
                            .attr('x', 12)
                            .attr('y', nodeHeight - 10)
                            .attr('fill', '#667085')
                            .attr('font-size', 10)
                            .attr('font-weight', 700)
                            .text(function (node) { return String(node.kind || '').toUpperCase(); });

                        item.append('text')
                            .attr('class', 'lineage-node-status')
                            .attr('x', 12)
                            .attr('y', nodeHeight + 16)
                            .attr('fill', '#475467')
                            .attr('font-size', 11)
                            .attr('font-weight', 700)
                            .selectAll('tspan')
                            .data(function (node) {
                                return wrapWords(node.status || '上次執行：尚無記錄', Math.max(18, Math.floor((node.statusWidth - 18) / 7))).slice(0, 2);
                            })
                            .enter()
                            .append('tspan')
                            .attr('x', 12)
                            .attr('dy', function (_word, index) { return index === 0 ? 0 : 13; })
                            .text(function (word) { return word; });

                        function selectNode(node) {
                            node = node || {};
                            item.classed('is-active', function (candidate) { return candidate.id === node.id; });
                            if (!detail) {
                                return;
                            }

                            detail.hidden = false;
                            var meta = node.meta || {};
                            var rows = Object.keys(meta).map(function (key) {
                                return '<div><dt>' + escapeHtml(key) + '</dt><dd>' + escapeHtml(meta[key]) + '</dd></div>';
                            }).join('');

                            detail.innerHTML = '<h3>' + escapeHtml(node.title || node.label) + '</h3>'
                                + '<p>' + escapeHtml(node.description || '') + '</p>'
                                + (rows ? '<dl>' + rows + '</dl>' : '');
                        }

                        function eventDatum(element, event, node) {
                            if (node && typeof node === 'object') {
                                return node;
                            }

                            if (event && typeof event === 'object' && (event.id || event.label || event.title)) {
                                return event;
                            }

                            return element && element.__data__ ? element.__data__ : {};
                        }

                        function wrapWords(text, maxLength) {
                            var value = String(text || '');
                            var words = value.indexOf(' ') === -1
                                ? Array.from(value)
                                : value.split(/\\s+/);
                            var lines = [];
                            var current = '';

                            words.forEach(function (word) {
                                var separator = value.indexOf(' ') === -1 ? '' : ' ';
                                var next = current ? current + separator + word : word;
                                if (visualLength(next) > maxLength && current) {
                                    lines.push(current);
                                    current = word;
                                } else {
                                    current = next;
                                }
                            });

                            if (current) {
                                lines.push(current);
                            }

                            return lines.length ? lines : [''];
                        }

                        function estimateTextWidth(text, fontSize) {
                            return Array.from(String(text || '')).reduce(function (sum, char) {
                                if (/[\u3000-\u9fff\uff00-\uffef]/.test(char)) {
                                    return sum + fontSize;
                                }

                                if (/[A-Z0-9_]/.test(char)) {
                                    return sum + (fontSize * 0.68);
                                }

                                if (char === ' ') {
                                    return sum + (fontSize * 0.35);
                                }

                                return sum + (fontSize * 0.58);
                            }, 0);
                        }

                        function visualLength(text) {
                            return Array.from(String(text || '')).reduce(function (sum, char) {
                                return sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1);
                            }, 0);
                        }

                        function clamp(value, min, max) {
                            return Math.max(min, Math.min(max, value));
                        }

                        function escapeHtml(value) {
                            return String(value || '').replace(/[&<>"']/g, function (char) {
                                return {
                                    '&': '&amp;',
                                    '<': '&lt;',
                                    '>': '&gt;',
                                    '"': '&quot;',
                                    "'": '&#039;',
                                }[char];
                            });
                        }
                    }

                    function renderAll() {
                        document.querySelectorAll('[data-d3-lineage]').forEach(function (container) {
                            if (container.closest('[hidden]')) {
                                return;
                            }

                            renderLineage(container);
                        });
                    }

                    function initDisclosures() {
                        document.querySelectorAll('[data-lineage-toggle]').forEach(function (button) {
                            if (button.dataset.bound === '1') {
                                return;
                            }

                            button.dataset.bound = '1';
                            button.addEventListener('click', function () {
                                var panel = document.getElementById(button.getAttribute('aria-controls'));
                                if (!panel) {
                                    return;
                                }

                                var isOpening = panel.hidden;
                                panel.hidden = !isOpening;
                                button.setAttribute('aria-expanded', isOpening ? 'true' : 'false');
                                button.querySelector('[data-lineage-toggle-label]').textContent = isOpening ? '收合' : '查看';

                                if (isOpening) {
                                    renderAll();
                                }
                            });
                        });
                    }

                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', function () {
                            initDisclosures();
                            renderAll();
                        });
                    } else {
                        initDisclosures();
                        renderAll();
                    }

                    window.addEventListener('resize', function () {
                        window.clearTimeout(window.lineageResizeTimer);
                        window.lineageResizeTimer = window.setTimeout(renderAll, 150);
                    });
                }());
            </script>
        @endpush
    @endonce

    <section class="lineage" aria-labelledby="lineage-title-{{ $lineagePanelId }}">
        <button class="lineage-toggle" type="button" data-lineage-toggle aria-expanded="false" aria-controls="{{ $lineagePanelId }}">
            <div>
                <span id="lineage-title-{{ $lineagePanelId }}">資料來源與更新狀態</span>
                <small>查看這個頁面的 API、資料表、更新時間與產生流程</small>
            </div>
            <strong data-lineage-toggle-label>查看</strong>
        </button>

        <div id="{{ $lineagePanelId }}" class="lineage-panel" hidden>
            <div class="lineage-head">
                <div>
                    <p>{{ $lineage['summary'] }}</p>
                </div>
                <a class="lineage-ops" href="{{ route('ops.ingestion') }}">擷取排程</a>
            </div>

            <div class="lineage-disclosure" data-lineage-disclosure>
                <div class="lineage-flow" data-lineage-flow>
                    <div class="lineage-graph" data-d3-lineage data-lineage-graph='@json($graphPayload)' aria-label="資料流程圖">
                        <div class="lineage-fallback" data-lineage-fallback>
                            @foreach ($lineage['graph'] as $node)
                                <div class="lineage-node lineage-node-{{ $node['kind'] }}">
                                    <span>{{ $node['label'] }}</span>
                                    <em>{{ $node['status'] ?? '上次執行：尚無記錄' }}</em>
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
                    </div>
                    <aside class="lineage-detail" data-lineage-detail aria-live="polite" hidden></aside>
                </div>
            </div>
        </div>
    </section>
@endif
