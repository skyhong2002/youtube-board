@props(['job' => '', 'label' => ''])
@php
    $jobKey = trim((string) $job);
    $linkLabel = trim((string) $label) !== '' ? trim((string) $label) : ($jobKey !== '' ? $jobKey : 'ingestion');
    $url = $jobKey !== ''
        ? route('ops.ingestion', ['job' => $jobKey])
        : route('ops.ingestion');
@endphp
<a class="yb-ingestion-portal" href="{{ $url }}" title="前往擷取排程執行 {{ $linkLabel }}">{{ $linkLabel }}</a>
