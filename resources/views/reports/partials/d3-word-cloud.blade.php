@php
    $cloudRows = collect($rows ?? [])->values();
    $cloudMaxScore = (float) ($maxScore ?? $max_score ?? $cloudRows->max('score') ?? 0);
    $cloudLabel = $label ?? 'Word cloud';

    $cloudWords = $cloudRows
        ->map(function (array $row, int $index) use ($cloudMaxScore): array {
            $score = max(0.0, (float) ($row['score'] ?? 0));
            $normalized = $cloudMaxScore > 0 ? ($score * 100 / $cloudMaxScore) : 0;
            $size = (int) ceil(pow($normalized, 0.9) + 6);
            $word = (string) ($row['word'] ?? '');

            return [
                'text' => $word,
                'size' => max(6, $size),
                'score' => $score,
                'url' => route('keywords.days', ['keyword' => $word]),
                'rank' => $index + 1,
            ];
        })
        ->filter(fn (array $word): bool => $word['text'] !== '')
        ->values()
        ->all();
@endphp

@once
    @push('scripts')
        <script src="https://d3js.org/d3.v3.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/d3-cloud/1.2.5/d3.layout.cloud.min.js"></script>
        <script>
            (function () {
                function renderCloud(container) {
                    if (!window.d3 || !d3.layout || !d3.layout.cloud) {
                        return;
                    }

                    var words = JSON.parse(container.getAttribute('data-words') || '[]');
                    if (!words.length) {
                        return;
                    }

                    var width = Math.max(320, container.clientWidth || 800);
                    var isMobile = window.matchMedia('(max-width: 760px)').matches;
                    var height = isMobile
                        ? Math.max(300, Math.min(360, width * 0.82))
                        : Math.max(380, Math.min(480, width * 0.42));
                    var fill = d3.scale.category20();

                    container.innerHTML = '';
                    container.className += ' is-rendered';
                    container.style.height = height + 'px';

                    d3.layout.cloud()
                        .size([width, height])
                        .words(words)
                        .padding(3)
                        .rotate(0)
                        .font('"Microsoft JhengHei","微軟正黑體",Impact')
                        .fontSize(function (d) { return d.size; })
                        .on('end', function (laidOutWords) {
                            var svg = d3.select(container)
                                .append('svg')
                                .attr('viewBox', '0 0 ' + width + ' ' + height)
                                .attr('role', 'img')
                                .attr('aria-label', container.getAttribute('aria-label') || 'Word cloud');
                            var group = svg.append('g')
                                .attr('transform', 'translate(' + (width / 2) + ',' + (height / 2) + ')')
                            group.selectAll('text')
                                .data(laidOutWords)
                                .enter()
                                .append('text')
                                .style('font-size', function (d) { return d.size + 'px'; })
                                .style('font-family', '"Microsoft JhengHei","微軟正黑體",Impact')
                                .style('cursor', 'pointer')
                                .style('fill', function (d, i) { return fill(i); })
                                .attr('text-anchor', 'middle')
                                .attr('transform', function (d) {
                                    return 'translate(' + [d.x, d.y] + ')rotate(' + d.rotate + ')';
                                })
                                .text(function (d) { return d.text; })
                                .on('click', function (d) {
                                    window.location.href = d.url;
                                });

                            var box = group.node().getBBox();
                            var padding = isMobile ? 18 : 28;
                            var viewWidth = Math.max(1, box.width + padding * 2);
                            var viewHeight = Math.max(1, box.height + padding * 2);
                            var fittedHeight = Math.round(Math.max(isMobile ? 260 : 300, Math.min(isMobile ? 360 : 460, width * (viewHeight / viewWidth))));

                            svg.attr('viewBox', [
                                box.x + (width / 2) - padding,
                                box.y + (height / 2) - padding,
                                viewWidth,
                                viewHeight,
                            ].join(' '));
                            container.style.height = fittedHeight + 'px';
                        })
                        .start();
                }

                function renderAllClouds() {
                    var containers = document.querySelectorAll('[data-d3-word-cloud]');
                    for (var i = 0; i < containers.length; i += 1) {
                        renderCloud(containers[i]);
                    }
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', renderAllClouds);
                } else {
                    renderAllClouds();
                }
            }());
        </script>
    @endpush
@endonce

<section class="d3-word-cloud" data-d3-word-cloud data-words='@json($cloudWords)' aria-label="{{ $cloudLabel }}">
    <div class="d3-word-cloud-fallback">
        @foreach ($cloudWords as $index => $word)
            @php
                $hue = (int) (($index * 47) % 360);
            @endphp
            <a href="{{ $word['url'] }}" style="font-size: {{ $word['size'] }}px; --hue: {{ $hue }};">{{ $word['text'] }}</a>
        @endforeach
    </div>
</section>
