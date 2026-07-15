<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiBusinessKeyLock;
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
                'choices' => [['message' => ['content' => '```json'."\n".'[{"事件":"第一版","videoId":["video-3"]}]'."\n".'```']]],
                'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 8],
            ])
            ->push([
                'choices' => [['message' => ['content' => '[{"事件":"更新版","videoId":["video-3","video-2"]}]']]],
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
        config()->set('services.opencode_go.model', 'next-model');
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
        $this->assertTrue($firstPayload['inserted']);
        $this->assertFalse($firstPayload['updated']);
        $this->assertSame(0, $second);
        $this->assertFalse($secondPayload['inserted']);
        $this->assertTrue($secondPayload['updated']);
        $this->assertSame(1, DB::table('urt_channel_ai')->count());
        $this->assertSame('next-model', DB::table('urt_channel_ai')->value('ai_type'));
        $this->assertStringContainsString('更新版', (string) DB::table('urt_channel_ai')->value('result_json'));
        Http::assertSentCount(2);
        Log::shouldHaveReceived('info')->withArgs(
            fn (string $message, array $context): bool => $message === 'Channel AI generation completed.'
                && $context['u_id'] === 77,
        )->twice();
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
            $this->assertTrue($payload['skipped']);
            $this->assertSame('business_key_locked', $payload['skip_reason']);
            $this->assertSame(0, DB::table('urt_channel_ai')->count());
            Http::assertSentCount(2);
        } finally {
            $lock->release();
        }
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
}
