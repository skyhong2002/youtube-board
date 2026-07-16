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
    public function validateEventList(
        string $content,
        string $shape,
        ?int $expectedMinItems = null,
        ?int $expectedMaxItems = null,
    ): array {
        $decodedAnyJson = false;
        $failureReason = null;
        $invalidItemCount = 0;

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

            $itemCount = count($items);

            if ($expectedMinItems !== null && $itemCount < max(0, $expectedMinItems)) {
                $failureReason = 'ai_payload_item_count_below_minimum';
                $invalidItemCount = $itemCount;

                continue;
            }

            if ($expectedMaxItems !== null && $itemCount > max(0, $expectedMaxItems)) {
                $failureReason = 'ai_payload_item_count_above_maximum';
                $invalidItemCount = $itemCount;

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
                'item_count' => $itemCount,
                'failure_reason' => null,
            ];
        }

        return [
            'valid' => false,
            'json' => null,
            'item_count' => $invalidItemCount,
            'failure_reason' => $failureReason ?? ($decodedAnyJson ? 'invalid_ai_payload_shape' : 'invalid_ai_json'),
        ];
    }

    /**
     * @return array{valid: bool, json: string|null, item_count: int, failure_reason: string|null}
     */
    public function validateMayorPersonDashboard(string $content): array
    {
        return $this->validateObject(
            $content,
            fn (array $payload): bool => $this->validMayorPersonDashboard($payload),
        );
    }

    /**
     * @return array{valid: bool, json: string|null, item_count: int, failure_reason: string|null}
     */
    public function validateEventPayload(string $content, string $promptType): array
    {
        return $this->validateObject(
            $content,
            fn (array $payload): bool => match ($promptType) {
                'summary' => $this->validEventSummary($payload),
                'people' => $this->validEventPeople($payload),
                'media' => $this->validEventMedia($payload),
                default => false,
            },
        );
    }

    /**
     * @param  callable(array<string, mixed>): bool  $shapeValidator
     * @return array{valid: bool, json: string|null, item_count: int, failure_reason: string|null}
     */
    private function validateObject(string $content, callable $shapeValidator): array
    {
        $decodedAnyJson = false;

        foreach ($this->jsonCandidates($content) as $candidate) {
            try {
                $decoded = json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                continue;
            }

            $decodedAnyJson = true;

            if (! is_array($decoded) || array_is_list($decoded) || ! $shapeValidator($decoded)) {
                continue;
            }

            try {
                $json = json_encode(
                    $decoded,
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
                );
            } catch (JsonException) {
                continue;
            }

            return [
                'valid' => true,
                'json' => $json,
                'item_count' => 1,
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
     * @param  array<string, mixed>  $payload
     */
    private function validMayorPersonDashboard(array $payload): bool
    {
        if (! $this->nonEmptyString($payload['summary'] ?? null)) {
            return false;
        }

        foreach (['what_happened', 'adjustments', 'actions_today', 'follow_up_metrics'] as $key) {
            if (! $this->validStringList($payload[$key] ?? null)) {
                return false;
            }
        }

        return $this->validObjectList(
            $payload['risks'] ?? null,
            fn (array $risk): bool => $this->nonEmptyString($risk['level'] ?? null)
                && $this->nonEmptyString($risk['item'] ?? null)
                && $this->nonEmptyString($risk['reason'] ?? null),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function validEventSummary(array $payload): bool
    {
        return $this->validObjectList(
            $payload['events'] ?? null,
            function (array $event): bool {
                if (
                    ! $this->nonEmptyString($event['event'] ?? null)
                    || ! $this->nonEmptyString($event['description'] ?? null)
                    || ! $this->validStringList($event['keywords'] ?? null)
                    || ! $this->validStringList($event['media'] ?? null)
                ) {
                    return false;
                }

                $factsValid = $this->validObjectList(
                    $event['fact'] ?? null,
                    fn (array $fact): bool => $this->nonEmptyString($fact['media'] ?? null)
                        && $this->nonEmptyString($fact['headline'] ?? null)
                        && $this->stringValue($fact['video_id'] ?? null),
                    requireItems: true,
                );
                $opinionsValid = $this->validObjectList(
                    $event['opinion'] ?? null,
                    fn (array $opinion): bool => $this->nonEmptyString($opinion['media'] ?? null)
                        && $this->nonEmptyString($opinion['stance'] ?? null)
                        && $this->nonEmptyString($opinion['intensity'] ?? null)
                        && $this->nonEmptyString($opinion['content'] ?? null)
                        && $this->stringValue($opinion['video_id'] ?? null),
                    requireItems: true,
                );

                return $factsValid && $opinionsValid;
            },
            requireItems: true,
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function validEventPeople(array $payload): bool
    {
        if (! $this->nonEmptyString($payload['main_subject'] ?? null)) {
            return false;
        }

        foreach (['supporting_persons', 'opposing_persons', 'other_opinions_persons'] as $key) {
            if (! $this->validObjectList($payload[$key] ?? null, fn (array $person): bool => $this->validEventPerson($person))) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $person
     */
    private function validEventPerson(array $person): bool
    {
        if (
            ! $this->nonEmptyString($person['person'] ?? null)
            || ! $this->nonEmptyString($person['role'] ?? null)
            || ! $this->nonEmptyString($person['support_or_opposition'] ?? null)
            || ! $this->nonEmptyString($person['strength'] ?? null)
            || ! $this->nonEmptyString($person['description'] ?? null)
        ) {
            return false;
        }

        return $this->validObjectList(
            $person['videos'] ?? null,
            fn (array $video): bool => $this->nonEmptyString($video['media'] ?? null)
                && $this->stringValue($video['video_id'] ?? null),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function validEventMedia(array $payload): bool
    {
        if (
            ! $this->nonEmptyString($payload['main_subject'] ?? null)
            || ! $this->validStringList($payload['all_medias'] ?? null)
        ) {
            return false;
        }

        foreach (['supporting_medias', 'opposing_medias', 'other_opinions_medias'] as $key) {
            if (! $this->validObjectList($payload[$key] ?? null, fn (array $media): bool => $this->validEventMediaRow($media))) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $media
     */
    private function validEventMediaRow(array $media): bool
    {
        return $this->nonEmptyString($media['media'] ?? null)
            && $this->nonEmptyString($media['support_or_opposition'] ?? null)
            && $this->nonEmptyString($media['strength'] ?? null)
            && $this->nonEmptyString($media['description'] ?? null);
    }

    private function nonEmptyString(mixed $value): bool
    {
        return is_string($value) && trim($value) !== '';
    }

    private function stringValue(mixed $value): bool
    {
        return is_string($value);
    }

    private function validStringList(mixed $value): bool
    {
        return is_array($value)
            && array_is_list($value)
            && collect($value)->every(fn (mixed $item): bool => $this->nonEmptyString($item));
    }

    /**
     * @param  callable(array<string, mixed>): bool  $itemValidator
     */
    private function validObjectList(mixed $value, callable $itemValidator, bool $requireItems = false): bool
    {
        if (! is_array($value) || ! array_is_list($value) || ($requireItems && $value === [])) {
            return false;
        }

        return collect($value)->every(
            fn (mixed $item): bool => is_array($item) && ! array_is_list($item) && $itemValidator($item),
        );
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

            if ($shape === 'daily' && $this->mediaSourceCount($item) < 2) {
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
    private function mediaSourceCount(array $item): int
    {
        foreach (['媒體事件', 'media_events', 'mediaEvents'] as $key) {
            if (! isset($item[$key]) || ! is_array($item[$key])) {
                continue;
            }

            if (array_is_list($item[$key])) {
                return 0;
            }

            $sources = [];

            foreach ($item[$key] as $channel => $events) {
                if (! is_string($channel) || trim($channel) === '' || ! is_array($events)) {
                    continue;
                }

                if (collect($events)->contains(fn (mixed $event): bool => is_scalar($event) && trim((string) $event) !== '')) {
                    $sources[] = trim($channel);
                }
            }

            return count(array_unique($sources));
        }

        return 0;
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
