<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionAiPeriodCommandTest extends TestCase
{
    public function test_ai_period_execute_matches_adjacent_daily_topics_and_upserts_period_history(): void
    {
        $this->createTables();
        $this->seedDailyFallbackRows();

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => json_encode([
                                [
                                    '2026-06-03' => ['鄭麗文的高人氣與活動'],
                                    '2026-06-02' => ['鄭麗文訪美'],
                                ],
                                [
                                    '2026-06-03' => ['鄭麗文訪美及兩岸關係'],
                                    '2026-06-02' => ['鄭麗文訪美'],
                                ],
                            ], JSON_UNESCAPED_UNICODE),
                        ],
                    ],
                ],
                'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 20],
            ]),
        ]);

        $exitCode = Artisan::call('ai:period', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['from_pk']);
        $this->assertSame(2, $payload['to_pk']);
        $this->assertTrue($payload['period_ai']['inserted']);
        $this->assertSame(1, $payload['ai_call_guard']['used']);
        $this->assertSame([
            [
                '2026-06-03' => ['鄭麗文訪美及兩岸關係'],
                '2026-06-02' => ['鄭麗文訪美'],
            ],
        ], $payload['period_ai']['rows'][0]['matches']);

        $row = DB::table('urt_ai_period')->first();
        $this->assertSame('2026-06-02 00:00:00', $row->date_from);
        $this->assertSame('2026-06-03 23:59:59', $row->date_to);
        $this->assertSame('all', $row->condition_type);
        $this->assertSame('["1","2"]', $row->data_json);
        $this->assertSame('[{"2026-06-03":["鄭麗文訪美及兩岸關係"],"2026-06-02":["鄭麗文訪美"]}]', $row->result_json);

        $response = $this->getJson('/api/api_event.php?pk=2&event='.urlencode('鄭麗文訪美及兩岸關係'));

        $response->assertOk();
        $response->assertJsonPath('meta.history_available', true);
        $this->assertSame(['鄭麗文訪美及兩岸關係'], $response->json('result.match.2026-06-03'));
        $this->assertSame(['鄭麗文訪美'], $response->json('result.match.2026-06-02'));
        $this->assertSame('1', $response->json('result.pk.2026-06-02'));
        Http::assertSentCount(1);
    }

    public function test_ai_period_preview_uses_daily_fallback_topics_without_writing_or_calling_ai(): void
    {
        $this->createTables();
        $this->seedDailyFallbackRows();
        Http::fake();

        $exitCode = Artisan::call('ai:period', [
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(1, $payload['from_pk']);
        $this->assertSame(2, $payload['to_pk']);
        $this->assertSame(1, $payload['from_topics']);
        $this->assertSame(1, $payload['to_topics']);
        $this->assertSame(1, $payload['would_call_ai_requests']);
        $this->assertSame(0, DB::table('urt_ai_period')->count());
        Http::assertNothingSent();
    }

    public function test_ai_period_execute_adds_deterministic_matches_and_updates_existing_period_row(): void
    {
        $this->createTables();
        $this->seedDailyFallbackRows();

        DB::table('urt_ai_period')->insert([
            'date_from' => '2026-06-02 00:00:00',
            'date_to' => '2026-06-03 23:59:59',
            'data_type' => null,
            'condition_type' => 'all',
            'user_token' => null,
            'del_flag' => null,
            'result_json' => '[]',
            'data_json' => '[]',
        ]);

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '[]',
                        ],
                    ],
                ],
                'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 5],
            ]),
        ]);

        $exitCode = Artisan::call('ai:period', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertFalse($payload['period_ai']['inserted']);
        $this->assertTrue($payload['period_ai']['updated']);
        $this->assertSame([
            [
                '2026-06-03' => ['鄭麗文訪美及兩岸關係'],
                '2026-06-02' => ['鄭麗文訪美'],
            ],
        ], $payload['period_ai']['rows'][0]['matches']);
        $this->assertSame(1, DB::table('urt_ai_period')->count());

        $row = DB::table('urt_ai_period')->first();
        $this->assertSame('CLI', $row->user_token);
        $this->assertSame('[{"2026-06-03":["鄭麗文訪美及兩岸關係"],"2026-06-02":["鄭麗文訪美"]}]', $row->result_json);
    }

    public function test_ai_period_parse_failure_is_sanitized_and_returns_nonzero_without_writing(): void
    {
        $this->createTables();
        $this->seedDailyFallbackRows();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('services.opencode_go.fallback_api_key', null);

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [[
                    'message' => ['content' => 'not-json password=period-parse-secret'],
                ]],
            ]),
        ]);

        $exitCode = Artisan::call('ai:period', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertTrue($payload['period_ai']['failed']);
        $this->assertTrue($payload['period_ai']['rows'][0]['failed']);
        $this->assertSame('invalid_json_response', $payload['period_ai']['rows'][0]['skip_reason']);
        $this->assertSame(0, DB::table('urt_ai_period')->count());
        $this->assertStringNotContainsString('period-parse-secret', $output);
        Http::assertSentCount(1);
    }

    public function test_ai_period_write_failure_returns_sanitized_nonzero_result(): void
    {
        $this->createTables();
        $this->seedDailyFallbackRows();
        DB::statement("CREATE TRIGGER fail_period_insert BEFORE INSERT ON urt_ai_period BEGIN SELECT RAISE(ABORT, 'token=period-super-secret'); END");
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [[
                    'message' => [
                        'content' => json_encode([[
                            '2026-06-03' => ['鄭麗文訪美及兩岸關係'],
                            '2026-06-02' => ['鄭麗文訪美'],
                        ]], JSON_UNESCAPED_UNICODE),
                    ],
                ]],
            ]),
        ]);

        $exitCode = Artisan::call('ai:period', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('failed', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertTrue($payload['period_ai']['failed']);
        $this->assertSame(0, DB::table('urt_ai_period')->count());
        $this->assertStringNotContainsString('period-super-secret', $output);
    }

    private function createTables(): void
    {
        foreach (['urt_ai_period', 'urt_ai_date', 'urt_channel_ai', 'urt_channel', 'urt_count'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_ai_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('channel_id')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_ai_period', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('ai_type')->nullable();
            $table->string('data_type')->nullable();
            $table->string('condition_type')->nullable();
            $table->string('user_token')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
            $table->text('data_json')->nullable();
        });
    }

    private function seedDailyFallbackRows(): void
    {
        DB::table('urt_channel')->insert(['u_id' => 15, 'title' => '新聞頻道']);
        DB::table('urt_count')->insert(['u_id' => 15, 'tags' => '[4]']);

        DB::table('urt_ai_date')->insert([
            [
                'date_from' => '2026-06-02 00:00:00',
                'date_to' => '2026-06-02 23:59:59',
                'condition_type' => 'all',
                'data_type' => 'oneday',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => '{}',
            ],
            [
                'date_from' => '2026-06-03 00:00:00',
                'date_to' => '2026-06-03 23:59:59',
                'condition_type' => 'all',
                'data_type' => 'oneday',
                'del_flag' => null,
                'channel_id' => '{}',
                'result_json' => '{}',
            ],
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'u_id' => 15,
                'date_from' => '2026-06-02 00:00:00',
                'date_to' => '2026-06-02 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '鄭麗文訪美',
                        '描述' => '鄭麗文訪美引起兩岸議題討論。',
                        '關鍵字' => ['鄭麗文', '訪美', '兩岸'],
                        '人物' => ['鄭麗文'],
                        'videoId' => ['from-a', 'from-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'u_id' => 15,
                'date_from' => '2026-06-03 00:00:00',
                'date_to' => '2026-06-03 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '鄭麗文訪美及兩岸關係',
                        '描述' => '鄭麗文訪美後續延伸到兩岸關係。',
                        '關鍵字' => ['鄭麗文', '訪美', '兩岸'],
                        '人物' => ['鄭麗文'],
                        'videoId' => ['to-a', 'to-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);
    }
}
