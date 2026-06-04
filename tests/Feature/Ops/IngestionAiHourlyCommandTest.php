<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionAiHourlyCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        config()->set('app.env', 'testing');
        app()->detectEnvironment(fn () => 'testing');

        parent::tearDown();
    }

    public function test_ai_hourly_previews_default_cron_window_as_ai_preview(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();

        DB::table('urt_ai_hour')->insert([
            'ctime' => '2026-05-25 10:05:00',
            'mtime' => null,
            'date_from' => '2026-05-25 09:00:00',
            'date_to' => '2026-05-25 09:59:59',
            'condition_type' => 'all',
            'ai_type' => 'gpt-4o-mini',
            'data_type' => 'each',
            'user_token' => 'cli',
            'del_flag' => null,
            'result_json' => '[]',
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('legacy_ai_hour_prompt', $payload['source']);
        $this->assertSame('all', $payload['condition_type']);
        $this->assertFalse($payload['explicit_condition']);
        $this->assertSame([31, 41], $payload['filters']['not']);
        $this->assertSame('2026-05-25 09:00:00', $payload['date_from']);
        $this->assertSame('2026-05-25 09:59:59', $payload['date_to']);
        $this->assertSame(3, $payload['matching_channels']);
        $this->assertSame(3, $payload['video_rows']);
        $this->assertSame(['min' => 3, 'max' => 7], $payload['prompt_bounds']);
        $this->assertSame(1, $payload['existing_ai_hour_rows']);
        $this->assertSame(1, $payload['would_call_ai_requests']);
        $this->assertSame(1, $payload['would_insert_ai_hour_rows']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('blue-video', $payload['rows'][0]['video_id']);
        $this->assertSame(1, DB::table('urt_ai_hour')->count());
    }

    public function test_ai_hourly_preserves_legacy_condition_filter_branches(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();

        $exitCode = Artisan::call('ai:hourly', [
            '--condition' => 'blue',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('blue', $payload['condition_type']);
        $this->assertTrue($payload['explicit_condition']);
        $this->assertSame([3, 13], $payload['filters']['tagid']);
        $this->assertSame(1, $payload['matching_channels']);
        $this->assertSame(1, $payload['video_rows']);
        $this->assertSame('blue-video', $payload['rows'][0]['video_id']);

        $exitCode = Artisan::call('ai:hourly', [
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame([102], $payload['filters']['tagid']);
        $this->assertSame(1, $payload['matching_channels']);
        $this->assertSame(1, $payload['video_rows']);
        $this->assertSame('explicit-all-video', $payload['rows'][0]['video_id']);
    }

    public function test_ingestion_scheduler_respects_scheduled_write_off_gate_for_ai_hourly(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:10:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.hourly',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
        $this->assertSame(0, DB::table('urt_ai_hour')->count());
    }

    public function test_ai_hourly_execute_calls_opencode_and_upserts_hour_row_idempotently(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"測試事件","描述":"測試描述","videoId":["blue-video"]}]',
                        ],
                    ],
                ],
                'usage' => [
                    'prompt_tokens' => 123,
                    'completion_tokens' => 45,
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--condition' => 'blue',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame('blue', $payload['condition_type']);
        $this->assertSame('qwen-test', $payload['model']);
        $this->assertSame('primary', $payload['provider']);
        $this->assertSame([], $payload['provider_failures']);
        $this->assertTrue($payload['inserted']);
        $this->assertFalse($payload['updated']);
        $this->assertSame('not_printed', $payload['secrets']);
        $this->assertSame(1, DB::table('urt_ai_hour')->count());
        $this->assertDatabaseHas('urt_ai_hour', [
            'date_from' => '2026-05-25 09:00:00',
            'date_to' => '2026-05-25 09:59:59',
            'condition_type' => 'blue',
            'ai_type' => 'qwen-test',
            'data_type' => 'each',
            'user_token' => 'cli',
            'result_json' => '[{"事件":"測試事件","描述":"測試描述","videoId":["blue-video"]}]',
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--condition' => 'blue',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertFalse($payload['inserted']);
        $this->assertTrue($payload['updated']);
        $this->assertSame(1, DB::table('urt_ai_hour')->count());
        Http::assertSentCount(2);
        Http::assertSent(function ($request): bool {
            return $request->hasHeader('Authorization', 'Bearer test-key')
                && $request['model'] === 'qwen-test'
                && str_contains($request['messages'][0]['content'], 'blue-video');
        });
    }

    public function test_ai_hourly_execute_supports_opencode_messages_endpoint_models(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'minimax-m2.7');
        config()->set('services.opencode_go.endpoint_style', 'auto');

        Http::fake([
            'https://opencode.test/v1/messages' => Http::response([
                'content' => [
                    [
                        'type' => 'text',
                        'text' => '[{"事件":"messages endpoint","videoId":["blue-video"]}]',
                    ],
                ],
                'usage' => [
                    'input_tokens' => 22,
                    'output_tokens' => 11,
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--condition' => 'blue',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('minimax-m2.7', $payload['model']);
        $this->assertTrue($payload['inserted']);
        $this->assertDatabaseHas('urt_ai_hour', [
            'date_from' => '2026-05-25 09:00:00',
            'date_to' => '2026-05-25 09:59:59',
            'condition_type' => 'blue',
            'ai_type' => 'minimax-m2.7',
            'result_json' => '[{"事件":"messages endpoint","videoId":["blue-video"]}]',
        ]);
        Http::assertSent(function ($request): bool {
            return (string) $request->url() === 'https://opencode.test/v1/messages'
                && $request['model'] === 'minimax-m2.7'
                && str_contains($request['messages'][0]['content'], 'blue-video');
        });
    }

    public function test_ai_hourly_execute_falls_back_to_secondary_provider_after_primary_failure(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://api.openai.test/v1');
        config()->set('services.opencode_go.fallback_model', 'gpt-4o-mini');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([], 524),
            'https://api.openai.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"fallback ok","videoId":["blue-video"]}]',
                        ],
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--condition' => 'blue',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('gpt-4o-mini', $payload['model']);
        $this->assertSame('fallback', $payload['provider']);
        $this->assertSame(['primary: status=524 endpoint_style=chat'], $payload['provider_failures']);
        $this->assertTrue($payload['inserted']);
        $this->assertDatabaseHas('urt_ai_hour', [
            'date_from' => '2026-05-25 09:00:00',
            'date_to' => '2026-05-25 09:59:59',
            'condition_type' => 'blue',
            'ai_type' => 'gpt-4o-mini',
            'result_json' => '[{"事件":"fallback ok","videoId":["blue-video"]}]',
        ]);
        Http::assertSentCount(2);
        Http::assertSent(function ($request): bool {
            return (string) $request->url() === 'https://api.openai.test/v1/chat/completions'
                && $request->hasHeader('Authorization', 'Bearer fallback-key')
                && $request['model'] === 'gpt-4o-mini';
        });
    }

    public function test_ai_hourly_execute_accepts_chat_content_arrays_and_reasoning_fallback(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'deepseek-v4-flash');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => [
                                [
                                    'type' => 'text',
                                    'text' => '[{"事件":"array content","videoId":["blue-video"]}]',
                                ],
                            ],
                        ],
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--condition' => 'blue',
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertDatabaseHas('urt_ai_hour', [
            'ai_type' => 'deepseek-v4-flash',
            'result_json' => '[{"事件":"array content","videoId":["blue-video"]}]',
        ]);

    }

    public function test_ai_hourly_execute_accepts_chat_reasoning_fallback(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'deepseek-v4-pro');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '',
                            'reasoning_content' => '[{"事件":"reasoning fallback","videoId":["blue-video"]}]',
                        ],
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--condition' => 'blue',
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertDatabaseHas('urt_ai_hour', [
            'ai_type' => 'deepseek-v4-pro',
            'result_json' => '[{"事件":"reasoning fallback","videoId":["blue-video"]}]',
        ]);
    }

    public function test_ai_hourly_dry_run_uses_preview_mode_until_execute(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"production gate","videoId":["include-default"]}]',
                        ],
                    ],
                ],
            ]),
            '*' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"production gate","videoId":["include-default"]}]',
                        ],
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--condition' => 'blue',
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertSame(0, DB::table('urt_ai_hour')->count());
        Http::assertNothingSent();
    }

    public function test_ai_hourly_execute_skips_empty_source_window_with_empty_window_skip(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"production gate","videoId":["include-default"]}]',
                        ],
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('ai:hourly', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertTrue($payload['skipped']);
        $this->assertSame('no_source_videos', $payload['skip_reason']);
        $this->assertFalse($payload['upserted']);
        $this->assertSame([], $payload['write_targets']);
        $this->assertSame(0, DB::table('urt_ai_hour')->count());
        Http::assertNothingSent();
    }

    public function test_ingestion_scheduler_can_run_allowlisted_ai_hourly_execute_when_due(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['ai.hourly']);

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"排程事件","videoId":["include-default"]}]',
                        ],
                    ],
                ],
            ]),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.hourly',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
        $this->assertSame('ai:hourly --execute --limit=20', $result['jobs'][0]['effective_command']);
        $this->assertSame(1, DB::table('urt_ai_hour')->count());
        Http::assertSentCount(1);
    }

    public function test_production_scheduler_requires_production_polling_gate_for_ai_hourly(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDefaultFixtures();
        config()->set('app.env', 'production');
        app()->detectEnvironment(fn () => 'production');
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', false);
        config()->set('ingestion.scheduled_write_allowlist', ['ai.hourly']);
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[{"事件":"production gate","videoId":["include-default"]}]',
                        ],
                    ],
                ],
            ]),
        ]);

        $blocked = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.hourly',
        );

        $this->assertSame('skip:controlled-execution-guardrail', $blocked['jobs'][0]['action']);
        $this->assertSame('ai:hourly', $blocked['jobs'][0]['effective_command']);
        $this->assertFalse($blocked['jobs'][0]['scheduled_write']['allowed']);
        $this->assertContains('Production polling is not explicitly enabled.', $blocked['jobs'][0]['scheduled_write']['blocks']);
        $this->assertSame(0, DB::table('urt_ai_hour')->count());
        Http::assertNothingSent();

        config()->set('ingestion.production_polling_enabled', true);

        $allowed = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 10:10:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.hourly',
        );

        $this->assertSame('executed:local-polling', $allowed['jobs'][0]['action'], json_encode($allowed['jobs'][0], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->assertSame('ai:hourly --execute --limit=20', $allowed['jobs'][0]['effective_command']);
        $this->assertTrue($allowed['jobs'][0]['scheduled_write']['allowed']);
        $this->assertSame(1, DB::table('urt_ai_hour')->count());
        Http::assertSentCount(1);
    }

    private function createTables(): void
    {
        foreach (['urt_ai_hour', 'urt_video', 'urt_count'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('likeCount')->nullable();
            $table->integer('commentCount')->nullable();
        });

        Schema::create('urt_ai_hour', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
            $table->string('condition_type');
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });
    }

    private function seedDefaultFixtures(): void
    {
        DB::table('urt_count')->insert([
            ['u_id' => 1, 'tags' => '[13]'],
            ['u_id' => 2, 'tags' => '[31]'],
            ['u_id' => 3, 'tags' => '[102]'],
            ['u_id' => 4, 'tags' => '[3],[13]'],
        ]);

        DB::table('urt_video')->insert([
            $this->videoRow(1, 'include-default', '2026-05-25 09:10:00', 1000, 'Default Included'),
            $this->videoRow(2, 'finance-excluded', '2026-05-25 09:20:00', 3000, 'Finance Excluded'),
            $this->videoRow(3, 'explicit-all-video', '2026-05-25 09:30:00', 2000, 'Explicit All'),
            $this->videoRow(4, 'blue-video', '2026-05-25 09:40:00', 2500, 'Blue Included'),
            $this->videoRow(1, 'too-old', '2026-05-25 08:59:59', 900, 'Too Old'),
            $this->videoRow(1, 'too-new', '2026-05-25 10:00:00', 900, 'Too New'),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function videoRow(int $uId, string $videoId, string $publishedAt, int $views, string $title): array
    {
        return [
            'u_id' => $uId,
            'videoId' => $videoId,
            'publishedAt' => $publishedAt,
            'title' => $title,
            'channelTitle' => 'Channel '.$uId,
            'viewCount' => $views,
            'likeCount' => 10,
            'commentCount' => 5,
        ];
    }
}
