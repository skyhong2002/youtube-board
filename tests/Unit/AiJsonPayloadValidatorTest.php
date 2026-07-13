<?php

namespace Tests\Unit;

use App\Services\Ingestion\AiJsonPayloadValidator;
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

    public function test_daily_shape_requires_a_title_and_nonempty_media_event_mapping(): void
    {
        $valid = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"標題":"每日事件","媒體事件":{"News":["事件 A"]}}]',
            'daily',
        );
        $invalid = app(AiJsonPayloadValidator::class)->validateEventList(
            '[{"標題":"空摘要","媒體事件":{}}]',
            'daily',
        );

        $this->assertTrue($valid['valid']);
        $this->assertFalse($invalid['valid']);
        $this->assertSame('invalid_ai_payload_shape', $invalid['failure_reason']);
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
