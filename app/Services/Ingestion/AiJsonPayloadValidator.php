<?php

namespace App\Services\Ingestion;

use App\Support\AiDailyContract;
use InvalidArgumentException;
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
     * Build the strict root-object schema required by OpenAI Structured Outputs.
     *
     * @return array<string, mixed>
     */
    public function eventListJsonSchema(
        string $shape,
        ?int $expectedMinItems = null,
        ?int $expectedMaxItems = null,
        ?int $dailyMaxMediaSources = null,
        ?int $dailyMaxEventsPerMedia = null,
    ): array {
        if (! in_array($shape, ['channel', 'daily', 'hourly'], true)) {
            throw new InvalidArgumentException('Unsupported AI event-list shape.');
        }

        $minimum = max(1, $expectedMinItems ?? 1);
        $maximum = max($minimum, $expectedMaxItems ?? 100);

        return [
            'type' => 'object',
            'properties' => [
                'events' => [
                    'type' => 'array',
                    'minItems' => $minimum,
                    'maxItems' => $maximum,
                    'items' => $shape === 'daily'
                        ? $this->dailyEventSchema($dailyMaxMediaSources, $dailyMaxEventsPerMedia)
                        : $this->channelEventSchema(),
                ],
            ],
            'required' => ['events'],
            'additionalProperties' => false,
        ];
    }

    /**
     * @return array{valid: bool, json: string|null, item_count: int, failure_reason: string|null}
     */
    public function validateEventList(
        string $content,
        string $shape,
        ?int $expectedMinItems = null,
        ?int $expectedMaxItems = null,
        ?int $dailyMaxMediaSources = null,
        ?int $dailyMaxEventsPerMedia = null,
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
            $items = $this->normalizeEventItems(
                $this->items($decoded),
                $shape,
                $dailyMaxEventsPerMedia,
            );

            if (! $this->validItems(
                $items,
                $shape,
                $dailyMaxMediaSources,
                $dailyMaxEventsPerMedia,
            )) {
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
    private function validItems(
        array $items,
        string $shape,
        ?int $dailyMaxMediaSources = null,
        ?int $dailyMaxEventsPerMedia = null,
    ): bool {
        if ($items === [] || ! in_array($shape, ['channel', 'daily', 'hourly'], true)) {
            return false;
        }

        foreach ($items as $item) {
            if (! is_array($item) || $this->eventTitle($item) === '') {
                return false;
            }

            if ($shape === 'daily') {
                if ($this->mediaSourceCount($item) < AiDailyContract::MIN_MEDIA_PER_TOPIC) {
                    return false;
                }

                if (! $this->validDailyRepresentation(
                    $item,
                    $dailyMaxMediaSources,
                    $dailyMaxEventsPerMedia,
                )) {
                    return false;
                }
            }

            if (in_array($shape, ['channel', 'hourly'], true) && $this->videoIds($item) === []) {
                return false;
            }
        }

        return true;
    }

    /**
     * Structured Outputs cannot represent the legacy dynamic media-name keys.
     * Convert its fixed list shape back before validation and persistence.
     *
     * @param  list<mixed>  $items
     * @return list<mixed>
     */
    private function normalizeEventItems(
        array $items,
        string $shape,
        ?int $dailyMaxEventsPerMedia = null,
    ): array {
        if ($shape !== 'daily') {
            return $items;
        }

        return array_map(function (mixed $item) use ($dailyMaxEventsPerMedia): mixed {
            if (! is_array($item) || array_is_list($item)) {
                return $item;
            }

            foreach (['媒體事件', 'media_events', 'mediaEvents'] as $key) {
                $mediaRows = $item[$key] ?? null;

                if (! is_array($mediaRows) || ! array_is_list($mediaRows)) {
                    continue;
                }

                $mediaMap = [];

                foreach ($mediaRows as $mediaRow) {
                    if (! is_array($mediaRow) || array_is_list($mediaRow)) {
                        if ($dailyMaxEventsPerMedia !== null) {
                            continue;
                        }

                        return $item;
                    }

                    $media = $mediaRow['媒體'] ?? $mediaRow['media'] ?? null;
                    $events = $mediaRow['事件'] ?? $mediaRow['events'] ?? null;

                    if (! is_string($media) || trim($media) === '' || ! is_array($events) || ! array_is_list($events)) {
                        if ($dailyMaxEventsPerMedia !== null) {
                            continue;
                        }

                        return $item;
                    }

                    $normalizedEvents = collect($events)
                        ->filter(fn (mixed $event): bool => is_string($event) && trim($event) !== '')
                        ->map(fn (string $event): string => trim($event))
                        ->values()
                        ->all();

                    if ($normalizedEvents === []) {
                        if ($dailyMaxEventsPerMedia !== null) {
                            continue;
                        }

                        return $item;
                    }

                    $media = trim($media);
                    $mergedEvents = array_values(array_unique([
                        ...($mediaMap[$media] ?? []),
                        ...$normalizedEvents,
                    ]));
                    $mediaMap[$media] = $dailyMaxEventsPerMedia === null
                        ? $mergedEvents
                        : array_slice($mergedEvents, 0, max(1, $dailyMaxEventsPerMedia));
                }

                $item[$key] = $mediaMap;

                return $item;
            }

            return $item;
        }, $items);
    }

    /**
     * @return array<string, mixed>
     */
    private function channelEventSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                '事件' => $this->stringSchema(),
                '描述' => $this->stringSchema(),
                '角度' => $this->stringSchema(),
                '陣營' => $this->stringSchema(),
                '分類' => $this->stringSchema(),
                '關鍵字' => $this->stringListSchema(30),
                '人物' => $this->stringListSchema(30),
                '地名' => $this->stringListSchema(30),
                '類型' => $this->stringListSchema(20),
                'videoId' => $this->stringListSchema(500, minimum: 1),
            ],
            'required' => ['事件', '描述', '角度', '陣營', '分類', '關鍵字', '人物', '地名', '類型', 'videoId'],
            'additionalProperties' => false,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function dailyEventSchema(
        ?int $maxMediaSources = null,
        ?int $maxEventsPerMedia = null,
    ): array {
        $maxMediaSources = max(
            AiDailyContract::MIN_MEDIA_PER_TOPIC,
            $maxMediaSources ?? 100,
        );
        $maxEventsPerMedia = max(1, $maxEventsPerMedia ?? 100);

        return [
            'type' => 'object',
            'properties' => [
                '標題' => $this->stringSchema(),
                '媒體事件' => [
                    'type' => 'array',
                    'minItems' => AiDailyContract::MIN_MEDIA_PER_TOPIC,
                    'maxItems' => $maxMediaSources,
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            '媒體' => $this->stringSchema(),
                            '事件' => $this->stringListSchema($maxEventsPerMedia, minimum: 1),
                        ],
                        'required' => ['媒體', '事件'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            'required' => ['標題', '媒體事件'],
            'additionalProperties' => false,
        ];
    }

    /**
     * @return array{type: string}
     */
    private function stringSchema(): array
    {
        return [
            'type' => 'string',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function stringListSchema(
        int $maximum,
        int $minimum = 0,
    ): array {
        return [
            'type' => 'array',
            'minItems' => $minimum,
            'maxItems' => $maximum,
            'items' => $this->stringSchema(),
        ];
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
     * Generation-only representation limits are optional so historical cache
     * payloads keep their existing validation behavior.
     *
     * @param  array<string, mixed>  $item
     */
    private function validDailyRepresentation(
        array $item,
        ?int $maxMediaSources,
        ?int $maxEventsPerMedia,
    ): bool {
        if ($maxMediaSources === null && $maxEventsPerMedia === null) {
            return true;
        }

        foreach (['媒體事件', 'media_events', 'mediaEvents'] as $key) {
            $mediaEvents = $item[$key] ?? null;

            if (! is_array($mediaEvents) || array_is_list($mediaEvents)) {
                continue;
            }

            if ($maxMediaSources !== null && count($mediaEvents) > max(1, $maxMediaSources)) {
                return false;
            }

            foreach ($mediaEvents as $media => $events) {
                if (! is_string($media) || trim($media) === '' || ! is_array($events) || ! array_is_list($events)) {
                    return false;
                }

                $validEvents = collect($events)
                    ->filter(fn (mixed $event): bool => is_string($event) && trim($event) !== '');

                if (
                    $validEvents->count() !== count($events)
                    || $validEvents->isEmpty()
                    || ($maxEventsPerMedia !== null && $validEvents->count() > max(1, $maxEventsPerMedia))
                ) {
                    return false;
                }
            }

            return true;
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
