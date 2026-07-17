<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiBusinessKeyLock;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionAiEventCommandTest extends TestCase
{
    public function test_ai_event_fails_only_the_contended_prompt_business_key_without_calling_ai(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        Http::fake();

        $lock = app(AiBusinessKeyLock::class)->acquire('urt_ai_event', [
            'aipk' => 10,
            'event_name' => '黃仁勳的高人氣與活動',
            'prompt_type' => 'summary',
            'condition_type' => 'all',
        ]);
        $this->assertNotNull($lock);

        try {
            $exitCode = Artisan::call('ai:event', [
                '--execute' => true,
                '--date' => '2026-06-03',
                '--condition' => 'all',
                '--prompt-types' => 'summary',
                '--limit' => 1,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

            $this->assertSame(1, $exitCode);
            $this->assertSame(1, $payload['failed_rows']);
            $this->assertSame('business_key_locked', $payload['event_ai']['rows'][0]['skip_reason']);
            $this->assertFalse($payload['event_ai']['rows'][0]['ai_call_attempted']);
            $this->assertSame(0, $payload['ai_call_guard']['used']);
            $this->assertSame(0, DB::table('urt_ai_event')->count());
            Http::assertNothingSent();
        } finally {
            $lock->release();
        }
    }

    public function test_ai_event_execute_generates_summary_people_and_media_rows_for_daily_topics(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        $this->fakeOpenCodeEventResponses();

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--date' => '2026-06-03',
            '--condition' => 'all',
            '--limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(10, $payload['aipk']);
        $this->assertSame(1, $payload['topics']);
        $this->assertSame(3, $payload['event_ai']['attempted']);
        $this->assertSame(3, $payload['event_ai']['inserted']);
        $this->assertSame(3, $payload['ai_call_guard']['used']);

        $this->assertSame(3, DB::table('urt_ai_event')->count());
        $promptTypes = DB::table('urt_ai_event')->pluck('prompt_type')->all();
        sort($promptTypes);
        $this->assertSame(['media', 'people', 'summary'], $promptTypes);

        $summaryRow = DB::table('urt_ai_event')->where('prompt_type', 'summary')->first();
        $this->assertSame(10, (int) $summaryRow->aipk);
        $this->assertSame('黃仁勳的高人氣與活動', $summaryRow->event_name);
        $this->assertSame('2026-06-03 00:00:00', $summaryRow->date_from);
        $this->assertSame('2026-06-03 23:59:59', $summaryRow->date_to);
        $this->assertSame('all', $summaryRow->condition_type);
        $this->assertSame('qwen-test', $summaryRow->ai_type);
        $this->assertSame('qwen-test-2026-07-15', $payload['event_ai']['rows'][0]['model']);
        $this->assertSame('CLI', $summaryRow->user_token);
        $this->assertStringContainsString('黃仁勳COMPUTEX演講', $summaryRow->result_json);

        $response = $this->get('/ai/events/10?event='.urlencode('黃仁勳的高人氣與活動'));

        $response->assertOk();
        $response->assertSee('黃仁勳COMPUTEX演講');
        $response->assertSee('COMPUTEX 現場活動推升黃仁勳討論熱度');
        $response->assertSee('科技產業');
        $response->assertDontSee('目前沒有對應的 `urt_ai_event` summary/people 內容');

        $peopleResponse = $this->get('/ai/events/10/people?event='.urlencode('黃仁勳的高人氣與活動'));
        $peopleResponse->assertOk();
        $peopleResponse->assertSee('黃仁勳');
        $peopleResponse->assertSee('輝達執行長');

        $wallResponse = $this->get('/ai/events/10/wall?event='.urlencode('黃仁勳的高人氣與活動'));
        $wallResponse->assertOk();
        $wallResponse->assertSee('https://i.ytimg.com/vi/nvidia-a/mqdefault.jpg', false);
        Http::assertSentCount(3);
    }

    public function test_ai_event_preview_lists_daily_topic_prompt_rows_without_writing_or_calling_ai(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        Http::fake();

        $exitCode = Artisan::call('ai:event', [
            '--date' => '2026-06-03',
            '--condition' => 'all',
            '--limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(10, $payload['aipk']);
        $this->assertSame(1, $payload['topics']);
        $this->assertSame(3, $payload['would_call_ai_requests']);
        $this->assertSame(['summary', 'people', 'media'], $payload['prompt_types']);
        $this->assertSame(0, DB::table('urt_ai_event')->count());
        Http::assertNothingSent();
    }

    public function test_ai_event_call_cap_exhaustion_fails_eligible_prompt_rows(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        Http::fake();

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--aipk' => 10,
            '--event' => '黃仁勳的高人氣與活動',
            '--prompt-types' => 'summary,people,media',
            '--ai-call-limit' => 0,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(3, $payload['failed_rows']);
        $this->assertSame(3, $payload['event_ai']['skipped']);
        $this->assertSame(3, $payload['event_ai']['failed']);
        $this->assertTrue(collect($payload['event_ai']['rows'])->every(
            fn (array $row): bool => $row['skip_reason'] === 'ai_call_guard_exhausted'
                && $row['failed'] === true
                && $row['ai_call_attempted'] === false,
        ));
        $this->assertSame(['limit' => 0, 'used' => 0, 'remaining' => 0], $payload['ai_call_guard']);
        $this->assertSame(0, DB::table('urt_ai_event')->count());
        Http::assertNothingSent();
    }

    public function test_ai_event_can_target_a_specific_old_aipk_event_and_skip_existing_rows(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();

        DB::table('urt_ai_event')->insert([
            'aipk' => 10,
            'event_name' => '黃仁勳的高人氣與活動',
            'date_from' => '2026-06-03 00:00:00',
            'date_to' => '2026-06-03 23:59:59',
            'condition_type' => 'all',
            'prompt_type' => 'summary',
            'ai_type' => 'existing-model',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'del_flag' => null,
            'result_json' => json_encode(['events' => []], JSON_UNESCAPED_UNICODE),
        ]);

        $this->fakeOpenCodeEventResponses(includeSummary: false);

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--aipk' => 10,
            '--event' => '黃仁勳的高人氣與活動',
            '--condition' => 'all',
            '--prompt-types' => 'summary,people,media',
            '--missing-only' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(3, $payload['event_ai']['attempted']);
        $this->assertSame(2, $payload['event_ai']['inserted']);
        $this->assertSame(1, $payload['event_ai']['skipped']);
        $this->assertSame('existing_row', $payload['event_ai']['rows'][0]['skip_reason']);
        $this->assertSame(2, $payload['ai_call_guard']['used']);
        $this->assertSame(3, DB::table('urt_ai_event')->count());
        Http::assertSentCount(2);
    }

    public function test_ai_event_execute_falls_back_to_topic_evidence_when_ai_returns_invalid_json(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [
                    [
                        'message' => [
                            'content' => '這不是 JSON',
                        ],
                    ],
                ],
                'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 12],
            ]),
        ]);

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--aipk' => 10,
            '--event' => '黃仁勳的高人氣與活動',
            '--condition' => 'all',
            '--prompt-types' => 'summary',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['event_ai']['inserted']);
        $this->assertTrue($payload['event_ai']['rows'][0]['fallback_used']);
        $this->assertSame('invalid_json_response', $payload['event_ai']['rows'][0]['fallback_reason']);

        $row = DB::table('urt_ai_event')->first();
        $decoded = json_decode($row->result_json, true);

        $this->assertSame('黃仁勳的高人氣與活動', $decoded['events'][0]['event']);
        $this->assertSame('黃仁勳COMPUTEX演講', $decoded['events'][0]['fact'][0]['headline']);
        $this->assertSame('nvidia-a', $decoded['events'][0]['fact'][0]['video_id']);
        Http::assertSentCount(1);
    }

    public function test_ai_event_wrong_shape_does_not_overwrite_or_expose_provider_payload(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        $original = json_encode(['events' => [['event' => 'existing']]], JSON_UNESCAPED_UNICODE);
        DB::table('urt_ai_event')->insert([
            'aipk' => 10,
            'event_name' => '黃仁勳的高人氣與活動',
            'date_from' => '2026-06-03 00:00:00',
            'date_to' => '2026-06-03 23:59:59',
            'prompt_type' => 'summary',
            'condition_type' => 'all',
            'result_json' => $original,
            'del_flag' => null,
        ]);
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [[
                    'message' => ['content' => '{"unexpected":"token=event-payload-secret"}'],
                ]],
            ]),
        ]);

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--aipk' => 10,
            '--event' => '黃仁勳的高人氣與活動',
            '--condition' => 'all',
            '--prompt-types' => 'summary',
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame('invalid_ai_payload_shape', $payload['event_ai']['rows'][0]['skip_reason']);
        $this->assertSame($original, DB::table('urt_ai_event')->value('result_json'));
        $this->assertStringNotContainsString('event-payload-secret', $output);
        Http::assertSentCount(1);
    }

    public function test_ai_event_provider_failure_is_isolated_and_command_returns_nonzero(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('services.opencode_go.fallback_api_key', null);

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push(['error' => ['message' => 'token=event-provider-secret']], 500)
                ->push($this->chatPayload([
                    'main_subject' => '黃仁勳',
                    'supporting_persons' => [],
                    'opposing_persons' => [],
                    'other_opinions_persons' => [],
                ])),
        ]);

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--aipk' => 10,
            '--event' => '黃仁勳的高人氣與活動',
            '--condition' => 'all',
            '--prompt-types' => 'summary,people',
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['event_ai']['failed']);
        $this->assertTrue($payload['event_ai']['rows'][0]['failed']);
        $this->assertFalse($payload['event_ai']['rows'][1]['failed']);
        $this->assertSame(1, $payload['event_ai']['inserted']);
        $this->assertSame('people', DB::table('urt_ai_event')->value('prompt_type'));
        $this->assertStringNotContainsString('event-provider-secret', $output);
        $this->assertStringContainsString('status=500', $payload['event_ai']['rows'][0]['skip_reason']);
        $this->assertStringContainsString('secrets=not_printed', $payload['event_ai']['rows'][0]['skip_reason']);
        $this->assertStringNotContainsString('token=', $payload['event_ai']['rows'][0]['skip_reason']);
        Http::assertSentCount(2);
    }

    public function test_ai_event_isolates_prompt_write_failures_and_returns_nonzero(): void
    {
        $this->createTables();
        $this->seedDailyTopicRows();
        $this->fakeOpenCodeEventResponses();
        DB::statement("CREATE TRIGGER fail_event_people BEFORE INSERT ON urt_ai_event WHEN NEW.prompt_type = 'people' BEGIN SELECT RAISE(ABORT, 'token=event-super-secret'); END");

        $exitCode = Artisan::call('ai:event', [
            '--execute' => true,
            '--date' => '2026-06-03',
            '--condition' => 'all',
            '--limit' => 1,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(2, $payload['event_ai']['inserted']);
        $this->assertSame(1, $payload['event_ai']['failed']);
        $this->assertSame(['summary', 'media'], DB::table('urt_ai_event')->orderBy('pk')->pluck('prompt_type')->all());
        $this->assertStringNotContainsString('event-super-secret', $output);
        Http::assertSentCount(3);
    }

    private function createTables(): void
    {
        foreach (['urt_ai_period', 'urt_ai_event', 'urt_ai_date', 'urt_channel_ai', 'urt_channel', 'urt_count', 'urt_video'] as $table) {
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

        Schema::create('urt_video', function ($table): void {
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
        });

        Schema::create('urt_ai_event', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('aipk');
            $table->string('event_name');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->string('prompt_type')->nullable();
            $table->string('ai_type')->nullable();
            $table->string('data_type')->nullable();
            $table->string('user_token')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_ai_period', function ($table): void {
            $table->increments('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
            $table->text('data_json')->nullable();
        });
    }

    private function seedDailyTopicRows(): void
    {
        DB::table('urt_channel')->insert([
            ['u_id' => 15, 'title' => '頭條開講'],
            ['u_id' => 20, 'title' => '政論頻道'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 15, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
        ]);

        DB::table('urt_ai_date')->insert([
            'pk' => 10,
            'date_from' => '2026-06-03 00:00:00',
            'date_to' => '2026-06-03 23:59:59',
            'condition_type' => 'all',
            'data_type' => 'oneday',
            'del_flag' => null,
            'channel_id' => json_encode([
                15 => '頭條開講',
                20 => '政論頻道',
            ], JSON_UNESCAPED_UNICODE),
            'result_json' => json_encode([
                [
                    '標題' => '黃仁勳的高人氣與活動',
                    '媒體事件' => [
                        '頭條開講' => ['黃仁勳COMPUTEX演講'],
                        '政論頻道' => ['黃仁勳夜市活動'],
                    ],
                ],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        DB::table('urt_channel_ai')->insert([
            [
                'u_id' => 15,
                'date_from' => '2026-06-03 00:00:00',
                'date_to' => '2026-06-03 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '黃仁勳COMPUTEX演講',
                        '描述' => 'COMPUTEX 現場活動推升黃仁勳討論熱度。',
                        '角度' => '台灣',
                        '陣營' => '科技產業',
                        '關鍵字' => ['黃仁勳', 'COMPUTEX', 'AI'],
                        '人物' => ['黃仁勳'],
                        'videoId' => ['nvidia-a', 'nvidia-b'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
            [
                'u_id' => 20,
                'date_from' => '2026-06-03 00:00:00',
                'date_to' => '2026-06-03 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => '黃仁勳夜市活動',
                        '描述' => '黃仁勳公開活動延伸到夜市與民眾互動。',
                        '角度' => '台灣',
                        '陣營' => '產業',
                        '關鍵字' => ['黃仁勳', '夜市', 'AI'],
                        '人物' => ['黃仁勳'],
                        'videoId' => ['nvidia-c'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ],
        ]);

        foreach ([15 => 'nvidia-a', 20 => 'nvidia-c'] as $uId => $videoId) {
            DB::table('urt_video')->insert([
                'u_id' => $uId,
                'videoId' => $videoId,
                'publishedAt' => '2026-06-03 12:00:00',
                'title' => '黃仁勳活動 '.$videoId,
            ]);
        }
    }

    private function fakeOpenCodeEventResponses(bool $includeSummary = true): void
    {
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        $sequence = Http::sequence();

        if ($includeSummary) {
            $sequence->push($this->chatPayload([
                'events' => [
                    [
                        'event' => '黃仁勳的高人氣與活動',
                        'description' => 'COMPUTEX 現場活動推升黃仁勳討論熱度。',
                        'keywords' => ['黃仁勳', 'COMPUTEX', 'AI'],
                        'media' => ['頭條開講', '政論頻道'],
                        'fact' => [
                            ['media' => '頭條開講', 'headline' => '黃仁勳COMPUTEX演講', 'video_id' => 'nvidia-a'],
                        ],
                        'opinion' => [
                            ['media' => '政論頻道', 'stance' => '關注科技產業', 'intensity' => '中', 'content' => '夜市活動展現高人氣', 'video_id' => 'nvidia-c'],
                        ],
                    ],
                ],
            ]));
        }

        $sequence->push($this->chatPayload([
            'main_subject' => '黃仁勳',
            'supporting_persons' => [
                [
                    'person' => '黃仁勳',
                    'role' => '輝達執行長',
                    'support_or_opposition' => '支持',
                    'strength' => '高',
                    'description' => '活動主角並帶動 AI 產業討論。',
                    'videos' => [['media' => '頭條開講', 'video_id' => 'nvidia-a']],
                ],
            ],
            'opposing_persons' => [],
            'other_opinions_persons' => [],
        ]));

        $sequence->push($this->chatPayload([
            'main_subject' => '黃仁勳',
            'supporting_medias' => [
                [
                    'media' => '頭條開講',
                    'support_or_opposition' => '支持',
                    'strength' => '高',
                    'description' => '強調 COMPUTEX 與 AI 產業聲量。',
                ],
            ],
            'opposing_medias' => [],
            'other_opinions_medias' => [
                [
                    'media' => '政論頻道',
                    'support_or_opposition' => '其他',
                    'strength' => '中',
                    'description' => '聚焦夜市活動與群眾反應。',
                ],
            ],
            'all_medias' => ['頭條開講', '政論頻道'],
        ]));

        Http::fake([
            'https://opencode.test/v1/chat/completions' => $sequence,
        ]);
    }

    /**
     * @param  array<string, mixed>  $content
     * @return array<string, mixed>
     */
    private function chatPayload(array $content): array
    {
        return [
            'model' => 'qwen-test-2026-07-15',
            'choices' => [
                [
                    'message' => [
                        'content' => json_encode($content, JSON_UNESCAPED_UNICODE),
                    ],
                ],
            ],
            'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 40],
        ];
    }
}
