<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionTelemetry;
use App\Services\Ingestion\OpenCodeChatClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use RuntimeException;
use Tests\TestCase;

class AiProviderProbeCommandTest extends TestCase
{
    public function test_ai_provider_probe_can_validate_fallback_without_primary_provider(): void
    {
        config()->set('services.opencode_go.api_key', null);
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.fallback_model', 'gpt-4o-mini');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');

        Http::fake([
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => 'OK',
                        ],
                    ],
                ],
                'usage' => ['prompt_tokens' => 4, 'completion_tokens' => 1, 'total_tokens' => 5],
            ]),
        ]);
        Http::preventStrayRequests();
        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'fallback',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('probe', $payload['mode']);
        $this->assertSame('not_printed', $payload['secrets']);
        $this->assertSame(['ok' => 1, 'failed' => 0], $payload['summary']);
        $this->assertSame('fallback', $payload['providers'][0]['provider']);
        $this->assertTrue($payload['providers'][0]['ok']);
        $this->assertSame('gpt-4o-mini', $payload['providers'][0]['model']);
        $this->assertSame(['prompt_tokens' => 4, 'completion_tokens' => 1, 'total_tokens' => 5], $payload['providers'][0]['usage']);
        $this->assertStringNotContainsString('fallback-key', Artisan::output());

        Http::assertSentCount(1);
        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://api.openai.test/v1/chat/completions'
                && $request->hasHeader('Authorization', 'Bearer fallback-key')
                && $request['model'] === 'gpt-4o-mini'
                && $request['max_tokens'] === 16;
        });
    }

    public function test_ai_provider_probe_uses_completion_token_limit_for_gpt_five_models(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');

        Http::fake([
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
        ]);
        Http::preventStrayRequests();
        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'primary',
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertNull($telemetry->snapshot()['ai_requests'][0]['response_model']);
        Http::assertSent(function ($request): bool {
            return $request->url() === 'https://api.openai.test/v1/chat/completions'
                && $request['model'] === 'gpt-5.4-mini'
                && $request['max_completion_tokens'] === 16
                && ! isset($request['max_tokens']);
        });
    }

    public function test_ai_provider_probe_reports_the_response_model_separately_from_configuration(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');

        Http::fake([
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-06-15',
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
        ]);
        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'primary',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('gpt-5.4-mini-2026-06-15', $payload['providers'][0]['model']);
        $this->assertSame('gpt-5.4-mini', $payload['providers'][0]['configured_model']);
        $this->assertSame('gpt-5.4-mini', $telemetry->snapshot()['ai_requests'][0]['model']);
        $this->assertSame('gpt-5.4-mini-2026-06-15', $telemetry->snapshot()['ai_requests'][0]['response_model']);
    }

    public function test_openai_provider_alias_probes_the_primary_endpoint_and_model(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-openai-key');
        config()->set('services.opencode_go.base_url', 'https://primary.openai.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-opencode-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.opencode.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');

        Http::fake([
            'https://primary.openai.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
            'https://fallback.opencode.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'fallback']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:provider:probe', [
            '--provider' => 'openai',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['ok' => 1, 'failed' => 0], $payload['summary']);
        $this->assertSame('primary', $payload['providers'][0]['provider']);
        $this->assertSame('gpt-5.4-mini', $payload['providers'][0]['model']);
        $this->assertStringNotContainsString('primary-openai-key', Artisan::output());
        $this->assertStringNotContainsString('fallback-opencode-key', Artisan::output());

        Http::assertSentCount(1);
        Http::assertSent(function (Request $request): bool {
            return $request->url() === 'https://primary.openai.test/v1/chat/completions'
                && $request->hasHeader('Authorization', 'Bearer primary-openai-key')
                && $request['model'] === 'gpt-5.4-mini'
                && $request['max_completion_tokens'] === 16
                && ! isset($request['max_tokens']);
        });
    }

    public function test_ai_connection_failure_is_sanitized_and_falls_back(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-super-secret');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'primary-model');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-super-secret');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'fallback-model');

        $attempts = 0;
        Http::fake(function (Request $request) use (&$attempts) {
            $attempts++;

            if (str_starts_with($request->url(), 'https://primary.test/')) {
                throw new ConnectionException(
                    'failed https://primary.test/v1/chat/completions?token=primary-super-secret Bearer primary-super-secret',
                );
            }

            return Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]);
        });

        $result = app(OpenCodeChatClient::class)->complete('Reply OK');

        $this->assertSame('fallback', $result['provider']);
        $this->assertCount(1, $result['provider_failures']);
        $this->assertStringContainsString('<redacted>', $result['provider_failures'][0]);
        $this->assertStringNotContainsString('primary-super-secret', $result['provider_failures'][0]);
        $this->assertStringNotContainsString('fallback-super-secret', json_encode($result));
        $this->assertSame(2, $attempts);
        Http::assertSentCount(1);
    }

    public function test_truncated_chat_completion_is_rejected_and_falls_back_without_exposing_content(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-secret-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-secret-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');
        $prompt = 'private prompt content must not appear';

        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-07-15',
                'choices' => [[
                    'finish_reason' => 'length',
                    'message' => ['content' => '{"partial":"private prompt content must not appear"}'],
                ]],
                'usage' => ['completion_tokens' => 4096],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'choices' => [[
                    'finish_reason' => 'stop',
                    'message' => ['content' => '{"complete":true}'],
                ]],
            ]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $result = app(OpenCodeChatClient::class)->complete($prompt);
        $snapshot = $telemetry->snapshot();
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);

        $this->assertSame('fallback', $result['provider']);
        $this->assertSame('{"complete":true}', $result['content']);
        $this->assertSame(
            ['primary: truncated_response endpoint_style=chat finish_reason=length'],
            $result['provider_failures'],
        );
        $this->assertCount(2, $snapshot['ai_requests']);
        $this->assertFalse($snapshot['ai_requests'][0]['ok']);
        $this->assertSame('length', $snapshot['ai_requests'][0]['termination_reason']);
        $this->assertSame('length', $snapshot['ai_requests'][0]['finish_reason']);
        $this->assertNull($snapshot['ai_requests'][0]['stop_reason']);
        $this->assertSame(0, $snapshot['ai_requests'][0]['completion_chars']);
        $this->assertStringNotContainsString($prompt, $encoded);
        $this->assertStringNotContainsString('primary-secret-key', $encoded);
        $this->assertStringNotContainsString('fallback-secret-key', $encoded);
        Http::assertSentCount(2);
    }

    public function test_messages_max_tokens_stop_reason_is_rejected_and_falls_back(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'minimax-m2.7');
        config()->set('services.opencode_go.endpoint_style', 'messages');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'gpt-4o-mini');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');

        Http::fake([
            'https://primary.test/v1/messages' => Http::response([
                'stop_reason' => 'max_tokens',
                'content' => [['type' => 'text', 'text' => '{"partial":true}']],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => '{"complete":true}']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $result = app(OpenCodeChatClient::class)->complete('Reply with complete JSON.');
        $snapshot = $telemetry->snapshot();

        $this->assertSame('fallback', $result['provider']);
        $this->assertSame(
            ['primary: truncated_response endpoint_style=messages stop_reason=max_tokens'],
            $result['provider_failures'],
        );
        $this->assertSame('max_tokens', $snapshot['ai_requests'][0]['termination_reason']);
        $this->assertSame('max_tokens', $snapshot['ai_requests'][0]['stop_reason']);
        $this->assertNull($snapshot['ai_requests'][0]['finish_reason']);
        Http::assertSentCount(2);
    }

    public function test_rate_limit_response_retries_same_provider_with_bounded_retry_after_delay(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', null);
        config()->set('services.opencode_go.transient_retries', 1);
        config()->set('services.opencode_go.retry_delay_ms', 0);
        config()->set('services.opencode_go.retry_after_max_ms', 1);

        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::sequence()
                ->push(['error' => ['message' => 'temporary rate limit']], 429, ['Retry-After' => '120'])
                ->push(['choices' => [['message' => ['content' => 'OK']]]]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $result = app(OpenCodeChatClient::class)->complete('Reply OK');
        $requests = $telemetry->snapshot()['ai_requests'];

        $this->assertSame('primary', $result['provider']);
        $this->assertCount(2, $requests);
        $this->assertSame(1, $requests[0]['attempt']);
        $this->assertTrue($requests[0]['transient_retry']);
        $this->assertSame(1, $requests[0]['retry_delay_ms']);
        $this->assertSame(2, $requests[1]['attempt']);
        Http::assertSentCount(2);
    }

    public function test_server_failures_are_bounded_independently_for_each_provider(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-secret-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-secret-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.transient_retries', 1);
        config()->set('services.opencode_go.retry_delay_ms', 0);
        config()->set('services.opencode_go.retry_after_max_ms', 0);
        $prompt = 'private batch prompt';

        Http::fake(fn (): mixed => Http::response([
            'error' => ['message' => 'temporary failure echoed private batch prompt token=primary-secret-key'],
            'usage' => [
                'prompt_tokens' => 12,
                'debug' => 'private batch prompt',
                'details' => ['completion_tokens' => 4, 'secret' => 'fallback-secret-key'],
            ],
        ], 503));

        try {
            app(OpenCodeChatClient::class)->complete($prompt);
            $this->fail('Expected both providers to exhaust their transient retry.');
        } catch (RuntimeException $exception) {
            $this->assertStringNotContainsString($prompt, $exception->getMessage());
            $this->assertStringNotContainsString('primary-secret-key', $exception->getMessage());
            $this->assertStringNotContainsString('fallback-secret-key', $exception->getMessage());
        }

        $snapshot = app(IngestionTelemetry::class)->snapshot();
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);

        $this->assertSame(['primary', 'primary', 'fallback', 'fallback'], array_column($snapshot['ai_requests'], 'provider'));
        $this->assertSame([1, 2, 1, 2], array_column($snapshot['ai_requests'], 'attempt'));
        $this->assertSame([true, false, true, false], array_column($snapshot['ai_requests'], 'transient_retry'));
        $this->assertSame([
            'prompt_tokens' => 12,
            'details' => ['completion_tokens' => 4],
        ], $snapshot['ai_requests'][0]['usage']);
        $this->assertStringNotContainsString($prompt, $encoded);
        $this->assertStringNotContainsString('primary-secret-key', $encoded);
        $this->assertStringNotContainsString('fallback-secret-key', $encoded);
        Http::assertSentCount(4);
    }

    public function test_provider_attempt_cap_reports_the_configured_chain_bound(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.transient_retries', 1);

        $this->assertSame(4, app(OpenCodeChatClient::class)->providerAttemptCapPerCompletion());

        config()->set('services.opencode_go.fallback_api_key', null);
        config()->set('services.opencode_go.transient_retries', 3);

        $this->assertSame(4, app(OpenCodeChatClient::class)->providerAttemptCapPerCompletion());
    }

    public function test_non_retryable_client_error_advances_to_fallback_after_one_attempt(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.transient_retries', 3);
        $prompt = 'private invalid prompt';

        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::response([
                'error' => ['message' => 'bad request echoed private invalid prompt'],
            ], 400),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'OK']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $result = app(OpenCodeChatClient::class)->complete($prompt);
        $snapshot = $telemetry->snapshot();
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);

        $this->assertSame('fallback', $result['provider']);
        $this->assertFalse($snapshot['ai_requests'][0]['transient_retry']);
        $this->assertStringNotContainsString($prompt, $encoded);
        Http::assertSentCount(2);
    }

    public function test_validated_completion_rejects_primary_payload_and_returns_fallback_validation(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-secret-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-secret-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        $prompt = 'private validation prompt';
        $primaryContent = '[{"event":"undersized-output-secret"}]';
        $fallbackContent = '[{"event":"one"},{"event":"two"}]';

        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-07-15',
                'choices' => [[
                    'finish_reason' => 'provider-controlled-private-reason',
                    'message' => ['content' => $primaryContent],
                ]],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'model' => 'qwen3.6-plus-2026-07-01',
                'choices' => [['finish_reason' => 'stop', 'message' => ['content' => $fallbackContent]]],
            ]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $result = app(OpenCodeChatClient::class)->completeValidated(
            $prompt,
            fn (string $content): array => $content === $fallbackContent
                ? ['valid' => true, 'json' => $fallbackContent, 'item_count' => 2]
                : ['valid' => false, 'failure_reason' => 'callback-reason-secret'],
        );
        $snapshot = $telemetry->snapshot();
        $encoded = json_encode($snapshot, JSON_THROW_ON_ERROR);

        $this->assertSame('fallback', $result['provider']);
        $this->assertSame(['valid' => true, 'json' => $fallbackContent, 'item_count' => 2], $result['validation']);
        $this->assertSame(['primary: validation_rejected'], $result['provider_failures']);
        $this->assertCount(2, $snapshot['ai_requests']);
        $this->assertFalse($snapshot['ai_requests'][0]['ok']);
        $this->assertSame(200, $snapshot['ai_requests'][0]['status']);
        $this->assertSame('validation_rejected', $snapshot['ai_requests'][0]['error']);
        $this->assertSame('gpt-5.4-mini', $snapshot['ai_requests'][0]['model']);
        $this->assertSame('gpt-5.4-mini-2026-07-15', $snapshot['ai_requests'][0]['response_model']);
        $this->assertSame('invalid_ai_payload', $snapshot['ai_requests'][0]['validation_failure_reason']);
        $this->assertSame('qwen3.6-plus', $snapshot['ai_requests'][1]['model']);
        $this->assertSame('qwen3.6-plus-2026-07-01', $snapshot['ai_requests'][1]['response_model']);
        $this->assertSame(mb_strlen($primaryContent, 'UTF-8'), $snapshot['ai_requests'][0]['completion_chars']);
        $this->assertSame('other', $snapshot['ai_requests'][0]['finish_reason']);
        $this->assertStringNotContainsString($primaryContent, $encoded);
        $this->assertStringNotContainsString('provider-controlled-private-reason', $encoded);
        $this->assertStringNotContainsString('callback-reason-secret', $encoded);
        $this->assertStringNotContainsString($prompt, $encoded);
        $this->assertStringNotContainsString('primary-secret-key', $encoded);
        $this->assertStringNotContainsString('fallback-secret-key', $encoded);
        Http::assertSentCount(2);
    }

    public function test_validated_completion_sends_strict_schema_only_to_official_primary_chat(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.fallback_model', 'gpt-4o-mini');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');
        $schema = [
            'type' => 'object',
            'properties' => ['events' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 2, 'items' => ['type' => 'string']]],
            'required' => ['events'],
            'additionalProperties' => false,
        ];

        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::sequence()
                ->push(['choices' => [['message' => ['content' => '{"events":[]}']]]])
                ->push(['choices' => [['message' => ['content' => '{"events":["ok"]}']]]]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $result = app(OpenCodeChatClient::class)->completeValidated(
            'Return an event list as JSON.',
            fn (string $content): array => str_contains($content, '"ok"')
                ? ['valid' => true, 'json' => $content]
                : ['valid' => false, 'failure_reason' => 'invalid_ai_payload_shape'],
            jsonSchema: $schema,
        );
        $requests = Http::recorded()->map(fn (array $record): Request => $record[0])->values();

        $this->assertSame('fallback', $result['provider']);
        $this->assertSame([
            'type' => 'json_schema',
            'json_schema' => [
                'name' => 'validated_event_list',
                'strict' => true,
                'schema' => $schema,
            ],
        ], $requests[0]['response_format']);
        $this->assertFalse(isset($requests[1]['response_format']));
        $this->assertTrue($telemetry->snapshot()['ai_requests'][0]['structured_output']);
        $this->assertFalse($telemetry->snapshot()['ai_requests'][1]['structured_output']);
    }

    public function test_official_structured_output_token_override_is_hard_bounded_and_does_not_raise_fallback_cap(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.max_tokens', 4096);
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_max_tokens', 1200);
        config()->set('services.opencode_go.transient_retries', 0);
        $schema = [
            'type' => 'object',
            'properties' => ['events' => ['type' => 'array', 'items' => ['type' => 'string']]],
            'required' => ['events'],
            'additionalProperties' => false,
        ];

        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => '{"events":[]}']]],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => '{"events":["ok"]}']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $result = app(OpenCodeChatClient::class)->completeValidated(
            'Return an event list as JSON.',
            fn (string $content): array => str_contains($content, '"ok"')
                ? ['valid' => true, 'json' => $content]
                : ['valid' => false, 'failure_reason' => 'invalid_ai_payload_shape'],
            jsonSchema: $schema,
            officialStructuredOutputMaxTokens: 100_000,
        );
        $requests = Http::recorded()->map(fn (array $record): Request => $record[0])->values();

        $this->assertSame('fallback', $result['provider']);
        $this->assertSame(12_288, $requests[0]['max_completion_tokens']);
        $this->assertFalse(isset($requests[0]['max_tokens']));
        $this->assertSame('json_schema', $requests[0]['response_format']['type']);
        $this->assertSame(1200, $requests[1]['max_tokens']);
        $this->assertFalse(isset($requests[1]['max_completion_tokens']));
        $this->assertFalse(isset($requests[1]['response_format']));
    }

    public function test_validated_messages_completion_never_sends_chat_response_format(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'minimax-m2.7');
        config()->set('services.opencode_go.endpoint_style', 'messages');
        config()->set('services.opencode_go.fallback_api_key', null);

        Http::fake([
            'https://api.openai.com/v1/messages' => Http::response([
                'content' => [['type' => 'text', 'text' => '{"events":["ok"]}']],
            ]),
        ]);
        Http::preventStrayRequests();

        app(OpenCodeChatClient::class)->completeValidated(
            'Return JSON.',
            fn (string $content): array => ['valid' => true, 'json' => $content],
            jsonSchema: ['type' => 'object'],
        );

        Http::assertSent(fn (Request $request): bool => $request->url() === 'https://api.openai.com/v1/messages'
            && ! isset($request['response_format']));
    }

    public function test_safe_validation_reason_survives_a_later_fallback_http_failure(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'primary-model');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'fallback-model');
        config()->set('services.opencode_go.transient_retries', 0);
        $privateContent = '{"events":["primary-output-secret"]}';

        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => $privateContent]]],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'error' => ['message' => 'quota token=fallback-body-secret'],
            ], 429),
        ]);
        Http::preventStrayRequests();

        try {
            app(OpenCodeChatClient::class)->completeValidated(
                'Return enough events.',
                fn (): array => [
                    'valid' => false,
                    'failure_reason' => 'ai_payload_item_count_below_minimum',
                ],
            );
            $this->fail('Expected the provider chain to fail.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString(
                'validation_failure_reason=ai_payload_item_count_below_minimum',
                $exception->getMessage(),
            );
            $this->assertStringContainsString('primary: validation_rejected', $exception->getMessage());
            $this->assertStringContainsString('fallback: status=429', $exception->getMessage());
            $this->assertStringNotContainsString('primary-output-secret', $exception->getMessage());
            $this->assertStringNotContainsString('fallback-body-secret', $exception->getMessage());
        }
    }

    public function test_validated_completion_sanitizes_callback_exception_before_fallback(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        $primaryContent = 'primary-model-content-secret';

        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => $primaryContent]]],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => 'fallback-valid']]],
            ]),
        ]);
        Http::preventStrayRequests();

        $result = app(OpenCodeChatClient::class)->completeValidated(
            'Reply with validated content.',
            function (string $content) use ($primaryContent): array {
                if ($content === $primaryContent) {
                    throw new RuntimeException('callback-exception-secret '.$content);
                }

                return ['valid' => true, 'json' => $content];
            },
        );
        $encoded = json_encode(app(IngestionTelemetry::class)->snapshot(), JSON_THROW_ON_ERROR);

        $this->assertSame('fallback', $result['provider']);
        $this->assertSame(['primary: validation_rejected'], $result['provider_failures']);
        $this->assertStringNotContainsString('callback-exception-secret', $encoded);
        $this->assertStringNotContainsString($primaryContent, $encoded);
        $this->assertStringNotContainsString('callback-exception-secret', json_encode($result, JSON_THROW_ON_ERROR));
        Http::assertSentCount(2);
    }

    public function test_all_provider_failures_use_a_generic_sanitized_error(): void
    {
        config()->set('services.opencode_go.api_key', 'primary-super-secret');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-super-secret');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');

        Http::fake(fn (): mixed => Http::response(['error' => ['message' => 'quota token=primary-super-secret']], 429));

        try {
            app(OpenCodeChatClient::class)->complete('Reply OK');
            $this->fail('Expected both configured providers to fail.');
        } catch (RuntimeException $exception) {
            $this->assertStringStartsWith('AI completion failed after 2 provider(s):', $exception->getMessage());
            $this->assertStringContainsString('secrets=not_printed', $exception->getMessage());
            $this->assertStringNotContainsString('primary-super-secret', $exception->getMessage());
            $this->assertStringNotContainsString('fallback-super-secret', $exception->getMessage());
            $this->assertStringNotContainsString('OpenCode completion failed', $exception->getMessage());
        }
    }
}
