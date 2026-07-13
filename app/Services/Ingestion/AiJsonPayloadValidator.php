<?php

namespace App\Services\Ingestion;

use JsonException;

class AiJsonPayloadValidator
{
    private const LIST_KEYS = [
        'events',
        '事件',
        '事件列表',
        '主要事件',
        'topics',
        '議題',
        '議題列表',
        'result',
        'results',
        'data',
        'items',
        'hourly_events',
    ];

    /**
     * @return array{valid: bool, json: string|null, item_count: int, failure_reason: string|null}
     */
    public function validateEventList(string $content, string $shape): array
    {
        $decodedAnyJson = false;

        foreach ($this->jsonCandidates($content) as $candidate) {
            try {
                $decoded = json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                continue;
            }

            $decodedAnyJson = true;
            $items = $this->items($decoded);

            if (! $this->validItems($items, $shape)) {
                continue;
            }

            try {
                $json = json_encode(
                    $items,
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
                );
            } catch (JsonException) {
                continue;
            }

            return [
                'valid' => true,
                'json' => $json,
                'item_count' => count($items),
                'failure_reason' => null,
            ];
        }

        return [
            'valid' => false,
            'json' => null,
            'item_count' => 0,
            'failure_reason' => $decodedAnyJson ? 'invalid_ai_payload_shape' : 'invalid_ai_json',
        ];
    }

    /**
     * @return list<mixed>
     */
    private function items(mixed $decoded): array
    {
        if (! is_array($decoded)) {
            return [];
        }

        if (array_is_list($decoded)) {
            return $decoded;
        }

        foreach (self::LIST_KEYS as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                return array_is_list($decoded[$key])
                    ? $decoded[$key]
                    : array_values($decoded[$key]);
            }
        }

        return $this->eventTitle($decoded) !== '' ? [$decoded] : [];
    }

    /**
     * @param  list<mixed>  $items
     */
    private function validItems(array $items, string $shape): bool
    {
        if ($items === [] || ! in_array($shape, ['channel', 'daily', 'hourly'], true)) {
            return false;
        }

        foreach ($items as $item) {
            if (! is_array($item) || $this->eventTitle($item) === '') {
                return false;
            }

            if ($shape === 'daily' && ! $this->hasMediaEvents($item)) {
                return false;
            }

            if (in_array($shape, ['channel', 'hourly'], true) && $this->videoIds($item) === []) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function eventTitle(array $item): string
    {
        foreach (['事件', '議題', '標題', 'event', 'topic', 'title'] as $key) {
            if (isset($item[$key]) && is_scalar($item[$key]) && trim((string) $item[$key]) !== '') {
                return trim((string) $item[$key]);
            }
        }

        return '';
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function hasMediaEvents(array $item): bool
    {
        foreach (['媒體事件', 'media_events', 'mediaEvents'] as $key) {
            if (! isset($item[$key]) || ! is_array($item[$key])) {
                continue;
            }

            foreach ($item[$key] as $channel => $events) {
                if (! is_scalar($channel) || trim((string) $channel) === '' || ! is_array($events)) {
                    continue;
                }

                if (collect($events)->contains(fn (mixed $event): bool => is_scalar($event) && trim((string) $event) !== '')) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $item
     * @return list<string>
     */
    private function videoIds(array $item): array
    {
        foreach (['videoId', 'video_id', 'video_ids', 'videos'] as $key) {
            if (! isset($item[$key])) {
                continue;
            }

            $values = is_array($item[$key]) ? $item[$key] : [$item[$key]];

            return collect($values)
                ->flatten()
                ->filter(fn (mixed $value): bool => is_scalar($value) && trim((string) $value) !== '')
                ->map(fn (mixed $value): string => trim((string) $value))
                ->values()
                ->all();
        }

        return [];
    }

    /**
     * @return list<string>
     */
    private function jsonCandidates(string $content): array
    {
        $content = trim($content);
        $candidates = [$content];

        if (preg_match('/```(?:json)?\s*([\s\S]*?)\s*```/i', $content, $match) === 1) {
            $candidates[] = trim($match[1]);
        }

        $embedded = $this->firstJsonBlock($content);

        if ($embedded !== null) {
            $candidates[] = $embedded;
        }

        return collect($candidates)
            ->filter(fn (string $candidate): bool => $candidate !== '')
            ->unique()
            ->values()
            ->all();
    }

    private function firstJsonBlock(string $text): ?string
    {
        $length = strlen($text);

        for ($start = 0; $start < $length; $start++) {
            $opening = $text[$start];

            if ($opening !== '[' && $opening !== '{') {
                continue;
            }

            $stack = [];
            $inString = false;
            $escape = false;

            for ($index = $start; $index < $length; $index++) {
                $char = $text[$index];

                if ($inString) {
                    if ($escape) {
                        $escape = false;
                    } elseif ($char === '\\') {
                        $escape = true;
                    } elseif ($char === '"') {
                        $inString = false;
                    }

                    continue;
                }

                if ($char === '"') {
                    $inString = true;

                    continue;
                }

                if ($char === '[' || $char === '{') {
                    $stack[] = $char;

                    continue;
                }

                if ($char !== ']' && $char !== '}') {
                    continue;
                }

                $expected = $char === ']' ? '[' : '{';

                if (array_pop($stack) !== $expected) {
                    break;
                }

                if ($stack === []) {
                    return substr($text, $start, $index - $start + 1);
                }
            }
        }

        return null;
    }
}
