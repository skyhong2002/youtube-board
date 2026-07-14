<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionAiDailyCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_ai_daily_previews_one_legacy_condition_as_ai_preview(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();

        DB::table('urt_ai_date')->insert([
            'ctime' => '2026-05-25 10:00:00',
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'ai_type' => 'gpt-4o-mini',
            'data_type' => 'oneday',
            'condition_type' => 'green',
            'user_token' => 'CLI',
            'del_flag' => null,
            'channel_id' => '{}',
            'result_json' => '[]',
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--date' => '2026-05-24',
            '--condition' => 'green',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('legacy_make_ai_day', $payload['source']);
        $this->assertSame('2026-05-24', $payload['date']);
        $this->assertSame('oneday', $payload['data_type']);
        $this->assertSame(['green'], $payload['conditions']);
        $this->assertSame(1, $payload['would_call_ai_requests']);
        $this->assertSame(1, $payload['would_insert_ai_date_rows']);
        $this->assertSame([], $payload['writes']);

        $row = $payload['condition_rows'][0];
        $this->assertSame('green', $row['condition']);
        $this->assertSame([4], $row['filters']['tagid']);
        $this->assertSame(1, $row['matching_channels']);
        $this->assertSame(1, $row['source_rows']);
        $this->assertSame(1, $row['media_rows']);
        $this->assertSame(2, $row['prompt_event_rows']);
        $this->assertSame(3, $row['prompt_video_refs']);
        $this->assertSame(['min' => 5, 'max' => 8], $row['prompt_bounds']);
        $this->assertSame(1, $row['existing_ai_date_rows']);
        $this->assertSame(1, DB::table('urt_ai_date')->count());
    }

    public function test_ai_daily_zero_source_preview_reports_no_ai_calls_or_writes(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        $exitCode = Artisan::call('ai:daily', [
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame(0, $payload['total_prompt_event_rows']);
        $this->assertSame(0, $payload['would_call_channel_ai_requests']);
        $this->assertSame(0, $payload['would_insert_channel_ai_rows']);
        $this->assertSame(0, $payload['would_call_ai_requests']);
        $this->assertSame(0, $payload['would_insert_ai_date_rows']);
        $this->assertFalse($payload['condition_rows'][0]['would_call_ai']);
        $this->assertFalse($payload['condition_rows'][0]['would_insert_ai_date']);
        $this->assertSame([], $payload['writes']);
    }

    public function test_ai_daily_previews_make_ai_day_shell_conditions_and_channel_ai_refresh(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();

        DB::table('urt_channel')->insert(['u_id' => 76, 'title' => 'Configured News Channel']);
        for ($index = 1; $index <= 10; $index++) {
            DB::table('urt_video')->insert([
                'u_id' => 76,
                'videoId' => 'refresh-video-'.$index,
                'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                'title' => 'Refresh Video '.$index,
                'channelTitle' => 'Configured News Channel',
            ]);
        }

        $exitCode = Artisan::call('ai:daily', [
            '--date' => '2026-05-24',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['all', 'green', 'blue', 'neutral', 'finance', 'world'], $payload['conditions']);
        $this->assertSame(4, $payload['would_call_ai_requests']);
        $this->assertSame(4, $payload['would_insert_ai_date_rows']);
        $this->assertSame(
            ['all', 'green', 'blue', 'finance'],
            collect($payload['condition_rows'])->where('would_call_ai', true)->pluck('condition')->all(),
        );

        $all = collect($payload['condition_rows'])->firstWhere('condition', 'all');
        $this->assertSame(3, $all['source_rows']);
        $this->assertSame(3, $all['media_rows']);
        $this->assertSame(3, $all['prompt_event_rows']);
        $this->assertSame(6, $all['prompt_video_refs']);
        $this->assertSame(['min' => 8, 'max' => 10], $all['prompt_bounds']);

        $refresh = $payload['channel_ai_refresh'];
        $this->assertSame(39, $refresh['configured_channels']);
        $this->assertSame(1, $refresh['existing_channels']);
        $this->assertSame(39, $refresh['would_attempt_channel_ai_refresh']);
        $this->assertSame(1, $refresh['would_insert_channel_ai_candidates']);
        $this->assertSame(76, $refresh['sample_channels'][0]['u_id']);
        $this->assertSame(10, $refresh['sample_channels'][0]['video_rows']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
    }

    public function test_ai_daily_preview_accepts_wrapped_channel_ai_payloads_with_video_id_key(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();

        DB::table('urt_channel')->insert(['u_id' => 76, 'title' => 'Wrapped Payload Channel']);
        DB::table('urt_channel_ai')->insert($this->channelAiRow(76, [
            'events' => [
                [
                    '標題' => 'Wrapped Event',
                    '說明' => 'Wrapped description',
                    'video_id' => ['wrapped-1', 'wrapped-2'],
                    'keywords' => ['wrapped', 'payload'],
                ],
            ],
        ]));

        $exitCode = Artisan::call('ai:daily', [
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);
        $row = $payload['condition_rows'][0];

        $this->assertSame(0, $exitCode);
        $this->assertSame('all', $row['condition']);
        $this->assertSame(4, $row['source_rows']);
        $this->assertSame(4, $row['media_rows']);
        $this->assertSame(4, $row['prompt_event_rows']);
        $this->assertSame(8, $row['prompt_video_refs']);
        $this->assertSame(76, $row['sample_media'][0]['u_id']);
        $this->assertSame(1, $row['sample_media'][0]['event_rows']);
        $this->assertSame(2, $row['sample_media'][0]['video_refs']);
    }

    public function test_ingestion_scheduler_respects_scheduled_write_off_gate_for_ai_daily(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-26 00:00:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.daily',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        $this->assertSame(0, DB::table('urt_channel_ai')->count());
    }

    public function test_ai_daily_execute_refreshes_channel_ai_then_upserts_daily_ai_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $this->seedRefreshChannelVideos();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"事件":"頻道事件","描述":"頻道描述","關鍵字":["測試"],"videoId":["refresh-video-10","refresh-video-9"]}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"標題":"每日事件","媒體事件":{"Configured News Channel":["頻道事件"]}}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 6],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"事件":"頻道事件更新","描述":"頻道描述","關鍵字":["測試"],"videoId":["refresh-video-10","refresh-video-9"]}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 11, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"標題":"每日事件更新","媒體事件":{"Configured News Channel":["頻道事件更新"]}}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 21, 'completion_tokens' => 6],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['channel_ai']['inserted']);
        $this->assertSame(1, $payload['daily_ai']['inserted']);
        $this->assertSame('not_printed', $payload['secrets']);
        $this->assertDatabaseHas('urt_channel_ai', [
            'u_id' => 76,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'ai_type' => 'qwen-test',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'result_json' => '[{"事件":"頻道事件","描述":"頻道描述","關鍵字":["測試"],"videoId":["refresh-video-10","refresh-video-9"]}]',
        ]);
        $this->assertDatabaseHas('urt_ai_date', [
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'ai_type' => 'qwen-test',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'channel_id' => '{"76":"Configured News Channel","30":"Finance Channel","20":"Blue Channel","10":"Green Channel"}',
            'result_json' => '[{"標題":"每日事件","媒體事件":{"Configured News Channel":["頻道事件"]}}]',
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['updated']);
        $this->assertSame(1, $payload['daily_ai']['updated']);
        $this->assertSame(4, DB::table('urt_channel_ai')->count());
        $this->assertSame(1, DB::table('urt_ai_date')->count());
        Http::assertSentCount(4);
    }

    public function test_ai_daily_execute_channel_limit_uses_eligible_legacy_channels(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        DB::table('urt_channel')->insert(['u_id' => 404, 'title' => 'Eligible Later Channel']);

        for ($index = 1; $index <= 9; $index++) {
            DB::table('urt_video')->insert([
                'u_id' => 76,
                'videoId' => 'short-video-'.$index,
                'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                'title' => 'Short Video '.$index,
                'channelTitle' => 'Short Channel',
                'viewCount' => 100 + $index,
            ]);
        }

        for ($index = 1; $index <= 10; $index++) {
            DB::table('urt_video')->insert([
                'u_id' => 404,
                'videoId' => 'later-video-'.$index,
                'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                'title' => 'Later Video '.$index,
                'channelTitle' => 'Eligible Later Channel',
                'viewCount' => 1000 + $index,
            ]);
        }

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"事件":"後段頻道事件","描述":"後段描述","關鍵字":["測試"],"videoId":["later-video-10","later-video-9"]}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"標題":"每日事件","媒體事件":{"Eligible Later Channel":["後段頻道事件"]}}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 6],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['attempted']);
        $this->assertSame(1, $payload['channel_ai']['inserted']);
        $this->assertSame(404, $payload['channel_ai']['rows'][0]['u_id']);
        $this->assertDatabaseMissing('urt_channel_ai', ['u_id' => 76]);
        $this->assertDatabaseHas('urt_channel_ai', ['u_id' => 404]);
    }

    public function test_ai_daily_execute_channel_offset_batches_eligible_legacy_channels(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        DB::table('urt_channel')->insert([
            ['u_id' => 76, 'title' => 'First Eligible Channel'],
            ['u_id' => 404, 'title' => 'Second Eligible Channel'],
        ]);

        foreach ([76 => 'first', 404 => 'second'] as $uId => $prefix) {
            for ($index = 1; $index <= 10; $index++) {
                DB::table('urt_video')->insert([
                    'u_id' => $uId,
                    'videoId' => $prefix.'-video-'.$index,
                    'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                    'title' => ucfirst($prefix).' Video '.$index,
                    'channelTitle' => $uId === 76 ? 'First Eligible Channel' : 'Second Eligible Channel',
                    'viewCount' => 1000 + $index,
                ]);
            }
        }

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"事件":"第二批頻道事件","描述":"第二批描述","關鍵字":["測試"],"videoId":["second-video-10","second-video-9"]}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => '[{"標題":"每日事件","媒體事件":{"Second Eligible Channel":["第二批頻道事件"]}}]',
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 6],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--channel-offset' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['limit']);
        $this->assertSame(1, $payload['channel_ai']['offset']);
        $this->assertSame(1, $payload['channel_ai']['attempted']);
        $this->assertSame(404, $payload['channel_ai']['rows'][0]['u_id']);
        $this->assertDatabaseMissing('urt_channel_ai', ['u_id' => 76]);
        $this->assertDatabaseHas('urt_channel_ai', ['u_id' => 404]);
    }

    public function test_ai_daily_execute_channel_batch_size_fills_multiple_eligible_batches_with_guard(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        DB::table('urt_channel')->insert([
            ['u_id' => 76, 'title' => 'First Eligible Channel'],
            ['u_id' => 404, 'title' => 'Second Eligible Channel'],
            ['u_id' => 405, 'title' => 'Third Eligible Channel'],
        ]);

        foreach ([76 => 'first', 404 => 'second', 405 => 'third'] as $uId => $prefix) {
            for ($index = 1; $index <= 10; $index++) {
                DB::table('urt_video')->insert([
                    'u_id' => $uId,
                    'videoId' => $prefix.'-video-'.$index,
                    'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                    'title' => ucfirst($prefix).' Video '.$index,
                    'channelTitle' => ucfirst($prefix).' Eligible Channel',
                    'viewCount' => 1000 + $index,
                ]);
            }
        }

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [['message' => ['content' => '[{"事件":"第一頻道事件","描述":"描述","關鍵字":["測試"],"videoId":["first-video-10","first-video-9"]}]']]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => '[{"事件":"第二頻道事件","描述":"描述","關鍵字":["測試"],"videoId":["second-video-10","second-video-9"]}]']]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => '[{"事件":"第三頻道事件","描述":"描述","關鍵字":["測試"],"videoId":["third-video-10","third-video-9"]}]']]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => '[{"標題":"每日事件","媒體事件":{"First Eligible Channel":["第一頻道事件"]}}]']]],
                    'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 6],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 3,
            '--channel-batch-size' => 2,
            '--ai-call-limit' => 4,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(3, $payload['channel_ai']['attempted']);
        $this->assertSame(3, $payload['channel_ai']['inserted']);
        $this->assertSame(2, $payload['channel_ai']['batch_size']);
        $this->assertSame(2, $payload['channel_ai']['batches']);
        $this->assertSame([1, 1, 2], array_column($payload['channel_ai']['rows'], 'batch'));
        $this->assertSame(4, $payload['ai_call_guard']['limit']);
        $this->assertSame(4, $payload['ai_call_guard']['used']);
        $this->assertSame(0, $payload['ai_call_guard']['remaining']);
        $this->assertSame(1, $payload['daily_ai']['inserted']);
        Http::assertSentCount(4);
    }

    public function test_ai_daily_execute_ai_call_guard_skips_remaining_channel_and_daily_calls(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        DB::table('urt_channel')->insert([
            ['u_id' => 76, 'title' => 'First Eligible Channel'],
            ['u_id' => 404, 'title' => 'Second Eligible Channel'],
        ]);

        foreach ([76 => 'first', 404 => 'second'] as $uId => $prefix) {
            for ($index = 1; $index <= 10; $index++) {
                DB::table('urt_video')->insert([
                    'u_id' => $uId,
                    'videoId' => $prefix.'-video-'.$index,
                    'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                    'title' => ucfirst($prefix).' Video '.$index,
                    'channelTitle' => ucfirst($prefix).' Eligible Channel',
                    'viewCount' => 1000 + $index,
                ]);
            }
        }

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => '[{"事件":"第一頻道事件","描述":"描述","關鍵字":["測試"],"videoId":["first-video-10","first-video-9"]}]']]],
                'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
            ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 2,
            '--channel-batch-size' => 1,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['inserted']);
        $this->assertSame(1, $payload['channel_ai']['skipped']);
        $this->assertSame('ai_call_guard_exhausted', $payload['channel_ai']['rows'][1]['skip_reason']);
        $this->assertFalse($payload['channel_ai']['rows'][1]['ai_call_attempted']);
        $this->assertSame(1, $payload['daily_ai']['skipped']);
        $this->assertSame('ai_call_guard_exhausted', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertFalse($payload['daily_ai']['rows'][0]['ai_call_attempted']);
        $this->assertSame(1, $payload['ai_call_guard']['used']);
        Http::assertSentCount(1);
    }

    public function test_ai_daily_execute_channel_video_limit_caps_prompt_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        DB::table('urt_channel')->insert(['u_id' => 76, 'title' => 'Configured News Channel']);

        for ($index = 1; $index <= 15; $index++) {
            DB::table('urt_video')->insert([
                'u_id' => 76,
                'videoId' => 'refresh-video-'.$index,
                'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                'title' => 'Refresh Video '.$index,
                'channelTitle' => 'Configured News Channel',
                'viewCount' => 1000 + $index,
            ]);
        }

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [['message' => ['content' => '[{"事件":"頻道事件","描述":"頻道描述","關鍵字":["測試"],"videoId":["refresh-video-15","refresh-video-14"]}]']]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => '[{"標題":"每日事件","媒體事件":{"Configured News Channel":["頻道事件"]}}]']]],
                    'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 6],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--channel-video-limit' => 10,
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(15, $payload['channel_ai']['rows'][0]['video_rows']);
        $this->assertSame(10, $payload['channel_ai']['rows'][0]['prompt_video_rows']);
        $this->assertSame(10, $payload['channel_ai']['video_limit']);
        Http::assertSentCount(2);
    }

    public function test_ingestion_scheduler_executes_allowlisted_ai_daily_command_when_due(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $this->seedRefreshChannelVideos();
        DB::table('urt_video')->update(['publishedAt' => '2026-05-25 12:00:00']);
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['ai.daily']);
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake(function ($request) {
            $prompt = (string) data_get($request->data(), 'messages.0.content', '');
            $content = str_contains($prompt, '多個媒體的事件列表')
                ? '[{"標題":"排程每日事件","媒體事件":{"Configured News Channel":["排程事件"]}}]'
                : '[{"事件":"排程事件","描述":"排程描述","關鍵字":["測試"],"videoId":["refresh-video-10","refresh-video-9"]}]';

            return Http::response([
                'choices' => [['message' => ['content' => $content]]],
                'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
            ]);
        });

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-26 00:00:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'ai.daily',
        );

        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
        $this->assertStringContainsString('ai:daily --execute --date=yesterday --type=oneday', $result['jobs'][0]['effective_command']);
        $this->assertGreaterThanOrEqual(1, DB::table('urt_channel_ai')->count());
        $this->assertGreaterThanOrEqual(1, DB::table('urt_ai_date')->count());
        $this->assertDatabaseHas('urt_channel_ai', [
            'date_from' => '2026-05-25 00:00:00',
            'data_type' => 'oneday',
        ]);
        $this->assertDatabaseHas('urt_ai_date', [
            'date_from' => '2026-05-25 00:00:00',
            'data_type' => 'oneday',
            'condition_type' => 'all',
        ]);
    }

    public function test_ai_daily_execute_records_ai_failures_and_returns_nonzero_batch_status(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $this->seedRefreshChannelVideos();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([], 524),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['skipped']);
        $this->assertSame(1, $payload['channel_ai']['failed']);
        $this->assertSame(1, $payload['daily_ai']['skipped']);
        $this->assertSame(1, $payload['daily_ai']['failed']);
        $this->assertStringContainsString('status=524', $payload['channel_ai']['rows'][0]['skip_reason']);
        $this->assertStringContainsString('status=524', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        $this->assertSame(3, DB::table('urt_channel_ai')->count());
    }

    public function test_ai_daily_rejects_invalid_json_without_leaking_content_and_continues_daily_summary(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $this->seedRefreshChannelVideos();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Log::spy();

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [['message' => ['content' => 'not json token=ai-output-secret']]],
                ])
                ->push([
                    'choices' => [['message' => ['content' => '```json\n[{"標題":"每日事件","媒體事件":{"Green Channel":["綠事件"]}}]\n```']]],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame('invalid_ai_json', $payload['channel_ai']['rows'][0]['skip_reason']);
        $this->assertSame(1, $payload['daily_ai']['inserted']);
        $this->assertStringNotContainsString('ai-output-secret', $output);
        $this->assertSame(3, DB::table('urt_channel_ai')->count());
        $this->assertDatabaseHas('urt_ai_date', [
            'condition_type' => 'all',
            'result_json' => '[{"標題":"每日事件","媒體事件":{"Green Channel":["綠事件"]}}]',
        ]);
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'AI daily ingestion item failed.'
                    && $context['stage'] === 'channel_validation'
                    && $context['failure_reason'] === 'invalid_ai_json'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'ai-output-secret');
            });
    }

    public function test_ai_daily_isolates_channel_write_failure_and_sanitizes_database_error(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $this->seedRefreshChannelVideos();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Log::spy();

        DB::statement(<<<'SQL'
CREATE TRIGGER fail_channel_ai_write
BEFORE INSERT ON urt_channel_ai
WHEN NEW.u_id = 76
BEGIN
    SELECT RAISE(FAIL, 'password=channel-db-secret');
END
SQL);

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [['message' => ['content' => '[{"事件":"頻道事件","videoId":["refresh-video-10"]}]']]],
                ])
                ->push([
                    'choices' => [['message' => ['content' => '[{"標題":"每日事件","媒體事件":{"Green Channel":["綠事件"]}}]']]],
                ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['failed']);
        $this->assertSame(1, $payload['daily_ai']['inserted']);
        $this->assertStringContainsString('password=<redacted>', $payload['channel_ai']['rows'][0]['skip_reason']);
        $this->assertStringNotContainsString('channel-db-secret', $output);
        $this->assertDatabaseHas('urt_ai_date', ['condition_type' => 'all']);
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'AI daily ingestion item failed.'
                    && $context['stage'] === 'channel_write'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'channel-db-secret');
            });
    }

    private function createTables(): void
    {
        foreach (['urt_video', 'urt_ai_date', 'urt_channel_ai', 'urt_count', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id');
            $table->string('title')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
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

        Schema::create('urt_ai_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('ai_type');
            $table->string('data_type');
            $table->string('condition_type')->nullable();
            $table->string('user_token');
            $table->integer('del_flag')->nullable();
            $table->text('channel_id');
            $table->text('result_json');
            $table->text('data_json')->nullable();
            $table->text('video_json')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->string('channelTitle')->nullable();
            $table->integer('viewCount')->nullable();
        });
    }

    private function seedRefreshChannelVideos(): void
    {
        DB::table('urt_channel')->insert(['u_id' => 76, 'title' => 'Configured News Channel']);
        for ($index = 1; $index <= 10; $index++) {
            DB::table('urt_video')->insert([
                'u_id' => 76,
                'videoId' => 'refresh-video-'.$index,
                'publishedAt' => '2026-05-24 '.str_pad((string) $index, 2, '0', STR_PAD_LEFT).':00:00',
                'title' => 'Refresh Video '.$index,
                'channelTitle' => 'Configured News Channel',
                'viewCount' => 1000 + $index,
            ]);
        }
    }

    private function seedDailyAiFixtures(): void
    {
        DB::table('urt_channel')->insert([
            ['u_id' => 10, 'title' => 'Green Channel'],
            ['u_id' => 20, 'title' => 'Blue Channel'],
            ['u_id' => 30, 'title' => 'Finance Channel'],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[4]'],
            ['u_id' => 20, 'tags' => '[3]'],
            ['u_id' => 30, 'tags' => '[31]'],
        ]);

        DB::table('urt_channel_ai')->insert([
            $this->channelAiRow(10, [
                ['事件' => 'Green Multi', '描述' => 'Green shared story', 'videoId' => ['g1', 'g2'], '關鍵字' => ['green', 'policy']],
                ['事件' => 'Green Single', '描述' => 'Green one video story', 'videoId' => ['g3'], '關鍵字' => ['single']],
            ]),
            $this->channelAiRow(20, [
                ['事件' => 'Blue Multi', '描述' => 'Blue shared story', 'videoId' => ['b1', 'b2'], '關鍵字' => ['blue']],
            ]),
            $this->channelAiRow(30, [
                ['事件' => 'Finance Multi', '描述' => 'Finance shared story', 'videoId' => ['f1', 'f2'], '關鍵字' => ['market']],
            ]),
        ]);
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @return array<string, mixed>
     */
    private function channelAiRow(int $uId, array $events): array
    {
        return [
            'u_id' => $uId,
            'ctime' => '2026-05-25 08:00:00',
            'mtime' => null,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'ai_type' => 'gpt-4o-mini',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'del_flag' => null,
            'result_json' => json_encode($events, JSON_UNESCAPED_UNICODE),
        ];
    }
}
