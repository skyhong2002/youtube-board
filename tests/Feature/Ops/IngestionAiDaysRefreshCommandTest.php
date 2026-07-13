<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiDailyIngestion;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Mockery\MockInterface;
use RuntimeException;
use Tests\TestCase;

class IngestionAiDaysRefreshCommandTest extends TestCase
{
    public function test_ai_days_refresh_preview_plans_daily_event_and_period_without_writes(): void
    {
        $this->createTables();
        $this->seedChannelAiRows();
        Http::fake();

        $exitCode = Artisan::call('ai:days:refresh', [
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('ai_days_refresh', $payload['source']);
        $this->assertSame(['2026-06-02', '2026-06-03'], $payload['dates']);
        $this->assertSame(5, $payload['summary']['jobs']);
        $this->assertSame(2, $payload['summary']['daily_jobs']);
        $this->assertSame(2, collect($payload['jobs'])->where('type', 'event-preview')->count());
        $this->assertSame(1, $payload['summary']['period_jobs']);
        $this->assertSame([], $payload['write_targets']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        $this->assertSame(0, DB::table('urt_ai_event')->count());
        $this->assertSame(0, DB::table('urt_ai_period')->count());
        Http::assertNothingSent();
    }

    public function test_ai_days_refresh_execute_runs_daily_events_period_and_final_verification(): void
    {
        $this->createTables();
        $this->seedChannelAiRows();
        $this->fakeOpenCodePipelineResponses();

        $exitCode = Artisan::call('ai:days:refresh', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--daily-channel-limit' => 0,
            '--daily-ai-call-limit' => 1,
            '--event-ai-call-limit' => 6,
            '--period-ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(2, $payload['summary']['daily_ai_inserted']);
        $this->assertSame(6, $payload['summary']['event_rows_inserted']);
        $this->assertSame(0, $payload['summary']['event_missing_after']);
        $this->assertSame(1, $payload['summary']['period_rows_inserted']);
        $this->assertSame(6, $payload['ai_call_guard']['event_used']);
        $this->assertSame('not_printed', $payload['secrets']);

        $this->assertSame(2, DB::table('urt_ai_date')->count());
        $this->assertSame(6, DB::table('urt_ai_event')->count());
        $this->assertSame(1, DB::table('urt_ai_period')->count());

        $period = DB::table('urt_ai_period')->first();
        $this->assertSame('2026-06-02 00:00:00', $period->date_from);
        $this->assertSame('2026-06-03 23:59:59', $period->date_to);
        $this->assertStringContainsString('黃仁勳的高人氣與活動', $period->result_json);
        $this->assertStringContainsString('黃仁勳參加COMPUTEX', $period->result_json);

        $eventPk = DB::table('urt_ai_date')->where('date_from', '2026-06-03 00:00:00')->value('pk');
        $response = $this->getJson('/api/api_event.php?pk='.$eventPk.'&event='.urlencode('黃仁勳的高人氣與活動'));

        $response->assertOk();
        $response->assertJsonPath('meta.history_available', true);
        $this->assertSame(['黃仁勳參加COMPUTEX'], $response->json('result.match.2026-06-02'));
        Http::assertSentCount(9);
    }

    public function test_ai_days_refresh_isolates_child_job_failure_and_continues_next_date(): void
    {
        $calls = 0;
        $this->mock(AiDailyIngestion::class, function (MockInterface $mock) use (&$calls): void {
            $mock->shouldReceive('execute')
                ->twice()
                ->andReturnUsing(function () use (&$calls): array {
                    $calls++;

                    if ($calls === 1) {
                        throw new RuntimeException('token=days-child-secret');
                    }

                    return [
                        'mode' => 'execute',
                        'status' => 'success',
                        'exit_code' => 0,
                        'failed_rows' => 0,
                        'daily_ai' => [
                            'inserted' => 1,
                            'updated' => 0,
                            'skipped' => 0,
                        ],
                    ];
                });
        });

        $exitCode = Artisan::call('ai:days:refresh', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--skip-events' => true,
            '--skip-period' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);
        $dailyJobs = collect($payload['jobs'])->where('type', 'daily')->values();

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['summary']['failed_jobs']);
        $this->assertSame('failed', $dailyJobs[0]['action']);
        $this->assertSame('run', $dailyJobs[1]['action']);
        $this->assertSame(1, $dailyJobs[0]['result']['failed_rows']);
        $this->assertSame(0, $dailyJobs[1]['result']['exit_code']);
        $this->assertSame(1, $payload['summary']['daily_ai_inserted']);
        $this->assertStringNotContainsString('days-child-secret', $output);
        $this->assertStringContainsString('token=<redacted>', $dailyJobs[0]['result']['skip_reason']);
        $this->assertSame(2, $calls);
    }

    public function test_ai_days_refresh_propagates_child_failure_and_continues_later_days(): void
    {
        $this->createTables();
        $this->seedChannelAiRows();
        DB::statement("CREATE TRIGGER fail_first_daily_insert BEFORE INSERT ON urt_ai_date WHEN NEW.date_from = '2026-06-02 00:00:00' BEGIN SELECT RAISE(ABORT, 'token=refresh-super-secret'); END");
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push($this->chatPayload([[
                    '標題' => '第一天事件',
                    '媒體事件' => ['新聞頻道' => ['第一天']],
                ]]))
                ->push($this->chatPayload([[
                    '標題' => '第二天事件',
                    '媒體事件' => ['新聞頻道' => ['第二天']],
                ]])),
        ]);

        $exitCode = Artisan::call('ai:days:refresh', [
            '--execute' => true,
            '--from' => '2026-06-02',
            '--to' => '2026-06-03',
            '--condition' => 'all',
            '--daily-channel-limit' => 0,
            '--daily-ai-call-limit' => 1,
            '--skip-events' => true,
            '--skip-period' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['summary']['failed_jobs']);
        $this->assertSame(1, $payload['summary']['daily_ai_inserted']);
        $this->assertSame(['2026-06-03 00:00:00'], DB::table('urt_ai_date')->pluck('date_from')->all());
        $this->assertStringNotContainsString('refresh-super-secret', $output);
        Http::assertSentCount(2);
    }

    private function createTables(): void
    {
        foreach (['urt_ai_period', 'urt_ai_event', 'urt_ai_date', 'urt_channel_ai', 'urt_channel', 'urt_count', 'urt_video'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_ai_date', function ($table): void {
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
            $table->text('channel_id')->nullable();
            $table->text('result_json')->nullable();
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('ai_type')->nullable();
            $table->string('data_type')->nullable();
            $table->string('user_token')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
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
            $table->string('channelTitle')->nullable();
            $table->integer('viewCount')->default(0);
        });
    }

    private function seedChannelAiRows(): void
    {
        DB::table('urt_channel')->insert(['u_id' => 15, 'title' => '新聞頻道']);
        DB::table('urt_count')->insert(['u_id' => 15, 'tags' => '[4]']);

        foreach ([
            '2026-06-02' => ['event' => '黃仁勳COMPUTEX', 'videos' => ['from-a', 'from-b']],
            '2026-06-03' => ['event' => '黃仁勳高人氣', 'videos' => ['to-a', 'to-b']],
        ] as $date => $row) {
            DB::table('urt_channel_ai')->insert([
                'u_id' => 15,
                'date_from' => $date.' 00:00:00',
                'date_to' => $date.' 23:59:59',
                'data_type' => 'oneday',
                'del_flag' => null,
                'result_json' => json_encode([
                    [
                        '事件' => $row['event'],
                        '描述' => $row['event'].' 描述',
                        '關鍵字' => ['黃仁勳', 'COMPUTEX'],
                        '人物' => ['黃仁勳'],
                        'videoId' => $row['videos'],
                    ],
                ], JSON_UNESCAPED_UNICODE),
            ]);

            foreach ($row['videos'] as $index => $videoId) {
                DB::table('urt_video')->insert([
                    'u_id' => 15,
                    'videoId' => $videoId,
                    'publishedAt' => $date.' '.str_pad((string) ($index + 8), 2, '0', STR_PAD_LEFT).':00:00',
                    'title' => $row['event'].' '.$videoId,
                    'channelTitle' => '新聞頻道',
                    'viewCount' => 100 - $index,
                ]);
            }
        }
    }

    private function fakeOpenCodePipelineResponses(): void
    {
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push($this->chatPayload([
                    [
                        '標題' => '黃仁勳參加COMPUTEX',
                        '媒體事件' => ['新聞頻道' => ['黃仁勳COMPUTEX']],
                    ],
                ]))
                ->push($this->chatPayload([
                    [
                        '標題' => '黃仁勳的高人氣與活動',
                        '媒體事件' => ['新聞頻道' => ['黃仁勳高人氣']],
                    ],
                ]))
                ->push($this->summaryPayload('黃仁勳參加COMPUTEX'))
                ->push($this->peoplePayload())
                ->push($this->mediaPayload())
                ->push($this->summaryPayload('黃仁勳的高人氣與活動'))
                ->push($this->peoplePayload())
                ->push($this->mediaPayload())
                ->push($this->chatPayload([
                    [
                        '2026-06-03' => ['黃仁勳的高人氣與活動'],
                        '2026-06-02' => ['黃仁勳參加COMPUTEX'],
                    ],
                ])),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function chatPayload(mixed $content): array
    {
        return [
            'choices' => [
                [
                    'message' => [
                        'content' => json_encode($content, JSON_UNESCAPED_UNICODE),
                    ],
                ],
            ],
            'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 30, 'total_tokens' => 130],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function summaryPayload(string $event): array
    {
        return $this->chatPayload([
            'events' => [
                [
                    'event' => $event,
                    'description' => $event.' 摘要',
                    'keywords' => ['黃仁勳', 'COMPUTEX'],
                    'media' => ['新聞頻道'],
                    'fact' => [['media' => '新聞頻道', 'headline' => $event, 'video_id' => 'to-a']],
                    'opinion' => [['media' => '新聞頻道', 'stance' => '科技', 'intensity' => '中', 'content' => $event.' 觀點', 'video_id' => 'to-b']],
                ],
            ],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function peoplePayload(): array
    {
        return $this->chatPayload([
            'main_subject' => '黃仁勳',
            'supporting_persons' => [
                [
                    'person' => '黃仁勳',
                    'role' => '輝達執行長',
                    'support_or_opposition' => '支持',
                    'strength' => '高',
                    'description' => '帶動 AI 熱度。',
                    'videos' => [['media' => '新聞頻道', 'video_id' => 'to-a']],
                ],
            ],
            'opposing_persons' => [],
            'other_opinions_persons' => [],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function mediaPayload(): array
    {
        return $this->chatPayload([
            'main_subject' => '黃仁勳',
            'supporting_medias' => [
                [
                    'media' => '新聞頻道',
                    'support_or_opposition' => '支持',
                    'strength' => '中',
                    'description' => '聚焦 AI 與 COMPUTEX。',
                ],
            ],
            'opposing_medias' => [],
            'other_opinions_medias' => [],
            'all_medias' => ['新聞頻道'],
        ]);
    }
}
