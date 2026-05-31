@if (! empty($lineage))
    @php
        $graphPayload = [
            'nodes' => $lineage['graph'] ?? [],
            'edges' => $lineage['edges'] ?? [],
        ];
    @endphp

    @once
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
                        var nodeWidth = 142;
                        var nodeHeight = 72;
                        var margin = { top: 28, right: 24, bottom: 42, left: 24 };
                        var edgeGaps = edges.map(function (edge) {
                            var label = String(edge.label || '');

                            return Math.max(118, (label.length * 8) + 76);
                        });
                        var chartWidth = margin.left + margin.right + (nodes.length * nodeWidth)
                            + edgeGaps.reduce(function (sum, gap) { return sum + gap; }, 0);
                        var width = Math.max(container.clientWidth || 760, chartWidth);
                        var height = 220;
                        var color = {
                            api: ['#edf6ff', '#7fb4df'],
                            table: ['#f5faec', '#b7cf87'],
                            cache: ['#fff7e8', '#e6bd75'],
                            service: ['#e6f4f1', '#8ccfbe'],
                            page: ['#f5f0ff', '#bba8df'],
                        };

                        container.classList.add('is-rendered');
                        if (fallback) {
                            fallback.hidden = true;
                        }
                        container.innerHTML = '';

                        nodes.forEach(function (node, index) {
                            var previousGaps = edgeGaps.slice(0, index).reduce(function (sum, gap) { return sum + gap; }, 0);
                            node.x = margin.left + (index * nodeWidth) + previousGaps;
                            node.y = margin.top + 34;
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

                                var x1 = source.x + nodeWidth;
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

                                return (source.x + nodeWidth + target.x) / 2;
                            })
                            .attr('y', function (edge) {
                                var source = byId.get(edge.from);
                                var target = byId.get(edge.to);
                                if (!source || !target) {
                                    return 0;
                                }

                                return source.y + 23;
                            })
                            .attr('text-anchor', 'middle')
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
                                selectNode(node);
                            })
                            .on('click', function (event, node) {
                                selectNode(node);
                            })
                            .on('keydown', function (event, node) {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    selectNode(node);
                                }
                            });

                        item.append('rect')
                            .attr('width', nodeWidth)
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
                                return wrapWords(node.label, 15).slice(0, 3);
                            })
                            .enter()
                            .append('tspan')
                            .attr('x', 12)
                            .attr('dy', function (_word, index) { return index === 0 ? 0 : 16; })
                            .text(function (word) { return word; });

                        item.append('text')
                            .attr('x', 12)
                            .attr('y', 62)
                            .attr('fill', '#667085')
                            .attr('font-size', 10)
                            .attr('font-weight', 700)
                            .text(function (node) { return String(node.kind || '').toUpperCase(); });

                        function selectNode(node) {
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

                        function wrapWords(text, maxLength) {
                            var words = String(text || '').split(/\\s+/);
                            var lines = [];
                            var current = '';

                            words.forEach(function (word) {
                                var next = current ? current + ' ' + word : word;
                                if (next.length > maxLength && current) {
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
                            renderLineage(container);
                        });
                    }

                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', renderAll);
                    } else {
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

    <section class="lineage" aria-labelledby="lineage-title">
        <div class="lineage-head">
            <div>
                <h2 id="lineage-title">資料來源與更新狀態</h2>
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
    </section>
@endif
