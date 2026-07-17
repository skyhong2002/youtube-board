<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiBusinessKeyLock;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionChannelAiCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->createTables();
        $this->seedChannelVideos();
    }

    public function test_channel_ai_defaults_to_capped_preview_without_writes(): void
    {
        $exitCode = Artisan::call('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('preview', $payload['mode']);
        $this->assertSame(2, $payload['source_video_rows']);
        $this->assertSame(1, $payload['prompt_video_rows']);
        $this->assertSame(['min' => 3, 'max' => 7], $payload['prompt_bounds']);
        $this->assertSame(1, $payload['video_limit']);
        $this->assertTrue($payload['would_call_ai']);
        $this->assertSame(['urt_channel_ai'], $payload['would_write']);
        $this->assertSame(0, DB::table('urt_channel_ai')->count());
        Http::assertNothingSent();
    }

    public function test_channel_ai_requires_explicit_from_date(): void
    {
        $this->artisan('ai:channel', ['u_id' => 77])
            ->expectsOutputToContain('--from=YYYY-MM-DD is required')
            ->assertExitCode(1);

        $this->assertSame(0, DB::table('urt_channel_ai')->count());
    }

    public function test_channel_ai_execute_requires_configured_provider(): void
    {
        config()->set('services.opencode_go.api_key', null);
        config()->set('services.opencode_go.fallback_api_key', null);

        $this->artisan('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--execute' => true,
        ])->expectsOutputToContain('secrets=not_printed')->assertExitCode(1);

        $this->assertSame(0, DB::table('urt_channel_ai')->count());
    }

    public function test_channel_ai_execute_updates_the_logical_row_when_the_provider_model_changes(): void
    {
        $this->configureProvider();
        Log::spy();
        Http::fake(['https://opencode.test/v1/chat/completions' => Http::sequence()
            ->push([
                'model' => 'qwen-test-2026-07-15',
                'choices' => [['message' => ['content' => '```json'."\n".$this->channelPayload('第一版')."\n".'```']]],
                'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 8],
            ])
            ->push([
                'model' => 'replacement-model-2026-07-15',
                'choices' => [['message' => ['content' => $this->channelPayload('更新版')]]],
                'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 9],
            ])]);

        $first = Artisan::call('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--to' => '2026-05-25',
            '--type' => 'todate',
            '--execute' => true,
            '--json' => true,
        ]);
        $firstPayload = json_decode(trim(Artisan::output()), true);
        config()->set('services.opencode_go.model', 'replacement-model');
        $second = Artisan::call('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--to' => '2026-05-25',
            '--type' => 'todate',
            '--execute' => true,
            '--json' => true,
        ]);
        $secondPayload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $first);
        $this->assertSame('execute', $firstPayload['mode']);
        $this->assertSame('qwen-test-2026-07-15', $firstPayload['model']);
        $this->assertTrue($firstPayload['inserted']);
        $this->assertFalse($firstPayload['updated']);
        $this->assertSame(0, $second);
        $this->assertSame('execute', $secondPayload['mode']);
        $this->assertSame('replacement-model-2026-07-15', $secondPayload['model']);
        $this->assertFalse($secondPayload['inserted']);
        $this->assertTrue($secondPayload['updated']);
        $this->assertSame(1, DB::table('urt_channel_ai')->count());
        $this->assertSame('replacement-model', DB::table('urt_channel_ai')->value('ai_type'));
        $this->assertStringContainsString('更新版', (string) DB::table('urt_channel_ai')->value('result_json'));
        Http::assertSentCount(2);
        Log::shouldHaveReceived('info')->withArgs(
            fn (string $message, array $context): bool => $message === 'Channel AI generation completed.'
                && $context['u_id'] === 77,
        )->twice();
    }

    public function test_channel_ai_uses_official_structured_output_and_stores_configured_model_alias(): void
    {
        config()->set('services.opencode_go.api_key', 'official-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', null);
        $events = json_decode($this->structuredChannelPayload('結構化事件'), true, 512, JSON_THROW_ON_ERROR);

        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-07-15',
                'choices' => [['message' => ['content' => json_encode([
                    'events' => $events,
                ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]]],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--to' => '2026-05-25',
            '--type' => 'todate',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('gpt-5.4-mini-2026-07-15', $payload['model']);
        $this->assertSame('gpt-5.4-mini', DB::table('urt_channel_ai')->value('ai_type'));
        Http::assertSent(function (Request $request): bool {
            $format = $request['response_format'] ?? [];
            $events = $format['json_schema']['schema']['properties']['events'] ?? [];

            return $request->url() === 'https://api.openai.com/v1/chat/completions'
                && ($format['type'] ?? null) === 'json_schema'
                && ($format['json_schema']['strict'] ?? null) === true
                && ($events['minItems'] ?? null) === 3
                && ($events['maxItems'] ?? null) === 7
                && str_contains((string) data_get($request->data(), 'messages.0.content'), '{"events":[...]}');
        });
    }

    public function test_channel_ai_invalid_or_wrong_shape_json_and_existing_lock_do_not_write(): void
    {
        $this->configureProvider();
        Http::fake(['https://opencode.test/v1/chat/completions' => Http::sequence()
            ->push(['choices' => [['message' => ['content' => 'not-json']]]])
            ->push(['choices' => [['message' => ['content' => '{"status":"ok"}']]]])]);

        $this->artisan('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--type' => 'oneday',
            '--execute' => true,
        ])->expectsOutputToContain('invalid_ai_json')->assertExitCode(1);
        $this->artisan('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--type' => 'oneday',
            '--execute' => true,
        ])->expectsOutputToContain('invalid_ai_payload_shape')->assertExitCode(1);
        $this->assertSame(0, DB::table('urt_channel_ai')->count());

        $lock = app(AiBusinessKeyLock::class)->acquire('urt_channel_ai', [
            'u_id' => 77,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
        ]);
        $this->assertNotNull($lock);

        try {
            $exitCode = Artisan::call('ai:channel', [
                'u_id' => 77,
                '--from' => '2026-05-24',
                '--type' => 'oneday',
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('execute', $payload['mode']);
            $this->assertTrue($payload['skipped']);
            $this->assertSame('business_key_locked', $payload['skip_reason']);
            $this->assertSame(0, DB::table('urt_channel_ai')->count());
            Http::assertSentCount(2);
        } finally {
            $lock->release();
        }
    }

    public function test_channel_ai_rejects_undersized_completion_without_overwriting_existing_cache(): void
    {
        $this->configureProvider();
        DB::table('urt_channel_ai')->insert([
            'u_id' => 77,
            'ctime' => '2026-05-26 00:00:00',
            'mtime' => null,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-25 23:59:59',
            'ai_type' => 'existing-model',
            'data_type' => 'todate',
            'user_token' => 'CLI',
            'del_flag' => null,
            'result_json' => $this->channelPayload('既有完整事件'),
        ]);
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => '[{"事件":"不完整事件","videoId":["video-3"]}]']]],
            ]),
        ]);

        $this->artisan('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--to' => '2026-05-25',
            '--type' => 'todate',
            '--execute' => true,
        ])->expectsOutputToContain('ai_payload_item_count_below_minimum')->assertExitCode(1);

        $this->assertSame(1, DB::table('urt_channel_ai')->count());
        $this->assertSame('existing-model', DB::table('urt_channel_ai')->value('ai_type'));
        $this->assertSame($this->channelPayload('既有完整事件'), DB::table('urt_channel_ai')->value('result_json'));
    }

    public function test_channel_ai_propagates_safe_validation_reason_before_fallback_connection_failure(): void
    {
        $this->configureProvider();
        config()->set('services.opencode_go.fallback_api_key', 'fallback-secret-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'fallback-model');
        config()->set('services.opencode_go.transient_retries', 0);
        Http::fake(function (Request $request): mixed {
            if (str_starts_with($request->url(), 'https://opencode.test/')) {
                return Http::response([
                    'choices' => [['message' => ['content' => '[{"事件":"不完整事件","videoId":["video-3"]}]']]],
                ]);
            }

            throw new ConnectionException(
                'fallback connection failed token=fallback-connection-secret',
            );
        });

        $exitCode = Artisan::call('ai:channel', [
            'u_id' => 77,
            '--from' => '2026-05-24',
            '--to' => '2026-05-25',
            '--type' => 'todate',
            '--execute' => true,
        ]);
        $output = Artisan::output();

        $this->assertSame(1, $exitCode);
        $this->assertStringContainsString('ai_payload_item_count_below_minimum', $output);
        $this->assertStringNotContainsString('fallback-connection-secret', $output);
        $this->assertSame(0, DB::table('urt_channel_ai')->count());
    }

    private function configureProvider(): void
    {
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('services.opencode_go.fallback_api_key', null);
    }

    private function createTables(): void
    {
        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
        });
        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->bigInteger('viewCount')->nullable();
        });
        Schema::create('urt_channel_ai', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });
    }

    private function seedChannelVideos(): void
    {
        DB::table('urt_channel')->insert(['u_id' => 77, 'title' => 'Reviewed channel']);
        DB::table('urt_video')->insert([
            ['u_id' => 77, 'videoId' => 'video-1', 'publishedAt' => '2026-05-24 08:00:00', 'title' => 'Video one', 'viewCount' => 100],
            ['u_id' => 77, 'videoId' => 'video-2', 'publishedAt' => '2026-05-24 09:00:00', 'title' => 'Video two', 'viewCount' => 300],
            ['u_id' => 77, 'videoId' => 'video-3', 'publishedAt' => '2026-05-25 10:00:00', 'title' => 'Video three', 'viewCount' => 500],
        ]);
    }

    private function channelPayload(string $prefix): string
    {
        return json_encode(collect(range(1, 3))->map(fn (int $index): array => [
            '事件' => $prefix.' '.$index,
            'videoId' => ['video-'.$index],
        ])->all(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    private function structuredChannelPayload(string $prefix): string
    {
        return json_encode(collect(range(1, 3))->map(fn (int $index): array => [
            '事件' => $prefix.' '.$index,
            '描述' => $prefix.'描述 '.$index,
            '角度' => '台灣',
            '陣營' => '中立',
            '分類' => '政治',
            '關鍵字' => ['測試'],
            '人物' => [],
            '地名' => [],
            '類型' => ['政治'],
            'videoId' => ['video-'.$index],
        ])->all(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
