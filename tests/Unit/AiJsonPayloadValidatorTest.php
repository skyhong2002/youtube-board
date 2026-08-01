<?php

namespace Tests\Unit;

use App\Services\Ingestion\AiJsonPayloadValidator;
use App\Support\AiDailyContract;
use Tests\TestCase;

class AiJsonPayloadValidatorTest extends TestCase
{
    public function test_it_extracts_fenced_wrapped_json_and_normalizes_the_event_list(): void
    {
        $result = app(AiJsonPayloadValidator::class)->validateEventList(
            "AI output:\n```json\n{\"events\":[{\"事件\":\"測試事件\",\"video_id\":[\"video-1\"]}]}\n```",
            'hourly',
        );

        $this->assertTrue($result['valid']);
        $this->assertSame(1, $result['item_count']);
        $this->assertSame('[{"事件":"測試事件","video_id":["video-1"]}]', $result['json']);
        $this->assertNull($result['failure_reason']);
    }

    public function test_it_accepts_a_single_event_object_and_rejects_missing_video_ids(): void
    {
        $valid = app(AiJsonPayloadValidator::class)->validateEventList(
            '{"event":"Single event","videoId":"video-1"}',
            'channel',
        );
        $invalid = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"event":"Missing linkage"}]',
            'channel',
        );

        $this->assertTrue($valid['valid']);
        $this->assertSame('[{"event":"Single event","videoId":"video-1"}]', $valid['json']);
        $this->assertFalse($invalid['valid']);
        $this->assertSame('invalid_ai_payload_shape', $invalid['failure_reason']);
    }

    public function test_daily_shape_requires_a_title_and_two_distinct_media_sources(): void
    {
        $valid = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"標題":"每日事件","媒體事件":{"News A":["事件 A"],"News B":["事件 B"]}}]',
            'daily',
        );
        $singleMedia = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"標題":"單一來源摘要","媒體事件":{"News A":["事件 A"]}}]',
            'daily',
        );
        $listShapedMedia = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"標題":"錯誤來源格式","媒體事件":[["事件 A"],["事件 B"]]}]',
            'daily',
        );
        $numericMediaKeys = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"標題":"數字來源名稱","媒體事件":{"0":["事件 A"],"1":["事件 B"]}}]',
            'daily',
        );

        $this->assertTrue($valid['valid']);
        $this->assertFalse($singleMedia['valid']);
        $this->assertSame('invalid_ai_payload_shape', $singleMedia['failure_reason']);
        $this->assertFalse($listShapedMedia['valid']);
        $this->assertSame('invalid_ai_payload_shape', $listShapedMedia['failure_reason']);
        $this->assertFalse($numericMediaKeys['valid']);
        $this->assertSame('invalid_ai_payload_shape', $numericMediaKeys['failure_reason']);
    }

    public function test_daily_structured_media_rows_are_normalized_to_the_legacy_media_map(): void
    {
        $result = app(AiJsonPayloadValidator::class)->validateEventList(json_encode([
            'events' => [[
                '標題' => '每日事件',
                '媒體事件' => [
                    ['媒體' => 'News A', '事件' => ['事件 A']],
                    ['媒體' => 'News B', '事件' => ['事件 B']],
                    ['媒體' => 'News A', '事件' => ['事件 A2']],
                ],
            ]],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'daily');

        $this->assertTrue($result['valid']);
        $this->assertSame([[
            '標題' => '每日事件',
            '媒體事件' => [
                'News A' => ['事件 A', '事件 A2'],
                'News B' => ['事件 B'],
            ],
        ]], json_decode((string) $result['json'], true, 512, JSON_THROW_ON_ERROR));
    }

    public function test_daily_generation_representation_caps_are_optional_for_historical_payloads(): void
    {
        $validator = app(AiJsonPayloadValidator::class);
        $atMediaCap = json_encode([[
            '標題' => '六個代表媒體的生成事件',
            '媒體事件' => collect(range(1, 6))->mapWithKeys(fn (int $index): array => [
                'News '.$index => ['事件 '.$index],
            ])->all(),
        ]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $tooManyMedia = json_encode([[
            '標題' => '七個媒體的歷史事件',
            '媒體事件' => collect(range(1, 7))->mapWithKeys(fn (int $index): array => [
                'News '.$index => ['事件 '.$index],
            ])->all(),
        ]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $tooManyEvents = json_encode([[
            '標題' => '每個媒體多個歷史事件',
            '媒體事件' => [
                'News A' => ['事件 A1', '事件 A2'],
                'News B' => ['事件 B1', '事件 B2'],
            ],
        ]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $duplicateStructuredMedia = json_encode(['events' => [[
            '標題' => '重複媒體的結構化事件',
            '媒體事件' => [
                ['媒體' => 'News A', '事件' => ['事件 A1']],
                ['媒體' => 'News A', '事件' => ['事件 A2']],
                ['媒體' => 'News B', '事件' => ['事件 B1']],
            ],
        ]]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $singleDistinctStructuredMedia = json_encode(['events' => [[
            '標題' => '去重後只有一個媒體的結構化事件',
            '媒體事件' => [
                ['媒體' => 'News A', '事件' => ['事件 A1']],
                ['媒體' => 'News A', '事件' => ['事件 A2']],
            ],
        ]]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $this->assertTrue($validator->validateEventList($tooManyMedia, 'daily')['valid']);
        $this->assertTrue($validator->validateEventList($tooManyEvents, 'daily')['valid']);
        $this->assertTrue($validator->validateEventList($duplicateStructuredMedia, 'daily')['valid']);
        $this->assertTrue($validator->validateEventList(
            $atMediaCap,
            'daily',
            dailyMaxMediaSources: AiDailyContract::MAX_REPRESENTATIVE_MEDIA_PER_TOPIC,
            dailyMaxEventsPerMedia: AiDailyContract::REPRESENTATIVE_EVENTS_PER_MEDIA,
        )['valid']);
        $normalizedDuplicate = $validator->validateEventList(
            $duplicateStructuredMedia,
            'daily',
            dailyMaxMediaSources: AiDailyContract::MAX_REPRESENTATIVE_MEDIA_PER_TOPIC,
            dailyMaxEventsPerMedia: AiDailyContract::REPRESENTATIVE_EVENTS_PER_MEDIA,
        );

        $this->assertTrue($normalizedDuplicate['valid']);
        $this->assertSame([[
            '標題' => '重複媒體的結構化事件',
            '媒體事件' => [
                'News A' => ['事件 A1'],
                'News B' => ['事件 B1'],
            ],
        ]], json_decode((string) $normalizedDuplicate['json'], true, 512, JSON_THROW_ON_ERROR));

        foreach ([$tooManyMedia, $tooManyEvents, $singleDistinctStructuredMedia] as $content) {
            $result = $validator->validateEventList(
                $content,
                'daily',
                dailyMaxMediaSources: AiDailyContract::MAX_REPRESENTATIVE_MEDIA_PER_TOPIC,
                dailyMaxEventsPerMedia: AiDailyContract::REPRESENTATIVE_EVENTS_PER_MEDIA,
            );

            $this->assertFalse($result['valid']);
            $this->assertSame('invalid_ai_payload_shape', $result['failure_reason']);
        }
    }

    public function test_event_list_schema_is_strict_and_carries_runtime_bounds(): void
    {
        $validator = app(AiJsonPayloadValidator::class);
        $channel = $validator->eventListJsonSchema('channel', 3, 7);
        $daily = $validator->eventListJsonSchema(
            'daily',
            5,
            40,
            dailyMaxMediaSources: AiDailyContract::MAX_REPRESENTATIVE_MEDIA_PER_TOPIC,
            dailyMaxEventsPerMedia: AiDailyContract::REPRESENTATIVE_EVENTS_PER_MEDIA,
        );

        $this->assertSame('object', $channel['type']);
        $this->assertFalse($channel['additionalProperties']);
        $this->assertSame(['events'], $channel['required']);
        $this->assertSame(3, $channel['properties']['events']['minItems']);
        $this->assertSame(7, $channel['properties']['events']['maxItems']);
        $this->assertFalse($channel['properties']['events']['items']['additionalProperties']);
        $this->assertContains('videoId', $channel['properties']['events']['items']['required']);
        $this->assertSame(['type' => 'string'], $channel['properties']['events']['items']['properties']['事件']);
        $this->assertSame(1, $channel['properties']['events']['items']['properties']['videoId']['minItems']);

        $mediaRows = $daily['properties']['events']['items']['properties']['媒體事件'];
        $this->assertSame(5, $daily['properties']['events']['minItems']);
        $this->assertSame(40, $daily['properties']['events']['maxItems']);
        $this->assertSame(2, $mediaRows['minItems']);
        $this->assertSame(6, $mediaRows['maxItems']);
        $this->assertFalse($mediaRows['items']['additionalProperties']);
        $this->assertSame(['媒體', '事件'], $mediaRows['items']['required']);
        $this->assertSame(1, $mediaRows['items']['properties']['事件']['minItems']);
        $this->assertSame(1, $mediaRows['items']['properties']['事件']['maxItems']);
    }

    public function test_daily_generation_discards_invalid_topics_then_enforces_final_bounds(): void
    {
        $validator = app(AiJsonPayloadValidator::class);
        $validTopics = collect(range(1, 8))->map(fn (int $index): array => [
            '標題' => '有效事件 '.$index,
            '媒體事件' => [
                ['媒體' => 'News A', '事件' => ['事件 A'.$index]],
                ['媒體' => 'News B', '事件' => ['事件 B'.$index]],
            ],
        ])->all();
        $invalidTopic = [
            '標題' => '去重後只有一個媒體',
            '媒體事件' => [
                ['媒體' => 'News A', '事件' => ['事件 A1']],
                ['媒體' => 'News A', '事件' => ['事件 A2']],
            ],
        ];
        $withinBounds = json_encode([
            'events' => [...$validTopics, $invalidTopic],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $belowBounds = json_encode([
            'events' => [...array_slice($validTopics, 0, 4), $invalidTopic],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $valid = $validator->validateEventList(
            $withinBounds,
            'daily',
            expectedMinItems: 5,
            expectedMaxItems: 40,
            dailyMaxMediaSources: AiDailyContract::MAX_REPRESENTATIVE_MEDIA_PER_TOPIC,
            dailyMaxEventsPerMedia: AiDailyContract::REPRESENTATIVE_EVENTS_PER_MEDIA,
        );
        $invalid = $validator->validateEventList(
            $belowBounds,
            'daily',
            expectedMinItems: 5,
            expectedMaxItems: 40,
            dailyMaxMediaSources: AiDailyContract::MAX_REPRESENTATIVE_MEDIA_PER_TOPIC,
            dailyMaxEventsPerMedia: AiDailyContract::REPRESENTATIVE_EVENTS_PER_MEDIA,
        );

        $this->assertTrue($valid['valid']);
        $this->assertSame(8, $valid['item_count']);
        $this->assertCount(8, json_decode((string) $valid['json'], true, 512, JSON_THROW_ON_ERROR));
        $this->assertFalse($invalid['valid']);
        $this->assertSame(4, $invalid['item_count']);
        $this->assertSame('ai_payload_item_count_below_minimum', $invalid['failure_reason']);
    }

    public function test_event_list_enforces_expected_minimum_and_maximum_cardinality(): void
    {
        $validator = app(AiJsonPayloadValidator::class);
        $events = json_encode(collect(range(1, 4))->map(fn (int $index): array => [
            '事件' => '事件 '.$index,
            'videoId' => ['video-'.$index],
        ])->all(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $below = $validator->validateEventList($events, 'channel', expectedMinItems: 5, expectedMaxItems: 7);
        $within = $validator->validateEventList($events, 'channel', expectedMinItems: 3, expectedMaxItems: 5);
        $above = $validator->validateEventList($events, 'channel', expectedMinItems: 1, expectedMaxItems: 3);

        $this->assertFalse($below['valid']);
        $this->assertSame(4, $below['item_count']);
        $this->assertSame('ai_payload_item_count_below_minimum', $below['failure_reason']);
        $this->assertTrue($within['valid']);
        $this->assertFalse($above['valid']);
        $this->assertSame(4, $above['item_count']);
        $this->assertSame('ai_payload_item_count_above_maximum', $above['failure_reason']);
    }

    public function test_invalid_json_has_a_fixed_failure_reason_without_echoing_content(): void
    {
        $result = app(AiJsonPayloadValidator::class)->validateEventList(
            'not json token=provider-output-secret',
            'hourly',
        );

        $this->assertFalse($result['valid']);
        $this->assertSame('invalid_ai_json', $result['failure_reason']);
        $this->assertNull($result['json']);
        $this->assertStringNotContainsString(
            'provider-output-secret',
            json_encode($result, JSON_THROW_ON_ERROR),
        );
    }

    public function test_it_validates_mayor_person_and_event_specific_shapes(): void
    {
        $validator = app(AiJsonPayloadValidator::class);
        $mayor = $validator->validateMayorPersonDashboard(json_encode([
            'summary' => '每日摘要',
            'what_happened' => ['事件'],
            'risks' => [['level' => 'low', 'item' => '風險', 'reason' => '原因']],
            'adjustments' => [],
            'actions_today' => ['行動'],
            'follow_up_metrics' => [],
        ], JSON_UNESCAPED_UNICODE));
        $summary = $validator->validateEventPayload(json_encode([
            'events' => [[
                'event' => '事件',
                'description' => '摘要',
                'keywords' => [],
                'media' => [],
                'fact' => [['media' => '媒體', 'headline' => '事實', 'video_id' => '']],
                'opinion' => [['media' => '媒體', 'stance' => '角度', 'intensity' => '中', 'content' => '重點', 'video_id' => '']],
            ]],
        ], JSON_UNESCAPED_UNICODE), 'summary');
        $people = $validator->validateEventPayload(json_encode([
            'main_subject' => '主體',
            'supporting_persons' => [],
            'opposing_persons' => [],
            'other_opinions_persons' => [],
        ], JSON_UNESCAPED_UNICODE), 'people');
        $media = $validator->validateEventPayload(json_encode([
            'main_subject' => '主體',
            'supporting_medias' => [],
            'opposing_medias' => [],
            'other_opinions_medias' => [],
            'all_medias' => [],
        ], JSON_UNESCAPED_UNICODE), 'media');

        $this->assertTrue($mayor['valid']);
        $this->assertTrue($summary['valid']);
        $this->assertTrue($people['valid']);
        $this->assertTrue($media['valid']);
    }

    public function test_specific_shape_failures_use_a_fixed_reason_without_echoing_content(): void
    {
        $validator = app(AiJsonPayloadValidator::class);
        $content = '{"unexpected":"token=provider-shape-secret"}';

        foreach ([
            $validator->validateMayorPersonDashboard($content),
            $validator->validateEventPayload($content, 'summary'),
            $validator->validateEventPayload($content, 'people'),
            $validator->validateEventPayload($content, 'media'),
        ] as $result) {
            $this->assertFalse($result['valid']);
            $this->assertSame('invalid_ai_payload_shape', $result['failure_reason']);
            $this->assertNull($result['json']);
            $this->assertStringNotContainsString(
                'provider-shape-secret',
                json_encode($result, JSON_THROW_ON_ERROR),
            );
        }
    }
}
