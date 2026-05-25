@php
    $width = 900;
    $height = 180;
    $padding = 24;
    $max = $series === [] ? 1 : max(1, max(array_column($series, 'value')));
    $count = max(1, count($series) - 1);
    $points = [];

    foreach ($series as $index => $point) {
        $x = $padding + (($width - $padding * 2) * $index / $count);
        $y = $height - $padding - (($height - $padding * 2) * $point['value'] / $max);
        $points[] = [round($x, 1), round($y, 1), $point['label'], $point['value']];
    }

    $path = collect($points)->map(fn ($point, $index) => ($index === 0 ? 'M' : 'L').$point[0].' '.$point[1])->implode(' ');
@endphp

@if ($series !== [])
    <svg viewBox="0 0 {{ $width }} {{ $height }}" role="img" aria-label="{{ $label }}">
        <line class="axis" x1="{{ $padding }}" y1="{{ $height - $padding }}" x2="{{ $width - $padding }}" y2="{{ $height - $padding }}"></line>
        <line class="axis" x1="{{ $padding }}" y1="{{ $padding }}" x2="{{ $padding }}" y2="{{ $height - $padding }}"></line>
        <path class="line" d="{{ $path }}"></path>
        @foreach ($points as $point)
            <circle class="dot" cx="{{ $point[0] }}" cy="{{ $point[1] }}" r="3">
                <title>{{ $point[2] }} {{ number_format($point[3]) }}</title>
            </circle>
        @endforeach
    </svg>
@else
    <div class="muted">沒有可繪製的資料。</div>
@endif
