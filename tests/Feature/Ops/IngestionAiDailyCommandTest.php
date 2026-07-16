<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiDailyPreview;
use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
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
        $this->assertSame(['min' => 8, 'max' => 12], $row['prompt_bounds']);
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

    public function test_ai_daily_complete_low_volume_source_skips_channel_rows_without_failing(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 00:15:00', 'Asia/Taipei'));
        $this->createTables();
        Http::fake();

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 39,
            '--ai-call-limit' => 45,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('success', $payload['status']);
        $this->assertSame(39, $payload['channel_ai']['attempted']);
        $this->assertSame(39, $payload['channel_ai']['skipped']);
        $this->assertSame(0, $payload['channel_ai']['failed']);
        $this->assertSame(0, $payload['channel_ai']['inserted']);
        $this->assertSame(0, $payload['channel_ai']['updated']);
        $this->assertSame(
            ['fewer_than_10_videos'],
            collect($payload['channel_ai']['rows'])->pluck('skip_reason')->unique()->values()->all(),
        );
        $this->assertTrue(collect($payload['channel_ai']['rows'])->every(
            fn (array $row): bool => $row['ai_call_attempted'] === false,
        ));
        $this->assertSame(0, $payload['ai_call_guard']['used']);
        Http::assertNothingSent();
    }

    public function test_ai_daily_execute_fails_when_required_all_condition_has_only_nonmergeable_source_events(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        DB::table('urt_channel')->insert(['u_id' => 10, 'title' => 'Single Video Event Channel']);
        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '']);
        DB::table('urt_channel_ai')->insert($this->channelAiRow(10, [[
            '事件' => '只有單支影片的來源事件',
            'videoId' => ['single-video'],
        ]]));
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['daily_ai']['failed']);
        $this->assertSame('no_source_events', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertFalse($payload['daily_ai']['rows'][0]['ai_call_attempted']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        Http::assertNothingSent();
    }

    public function test_ai_daily_execute_fails_when_raw_source_is_eligible_but_channel_refresh_is_disabled(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedRefreshChannelVideos();
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame(0, $payload['channel_ai']['attempted']);
        $this->assertSame(1, $payload['daily_ai']['failed']);
        $this->assertSame('no_source_events', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertSame(0, DB::table('urt_channel_ai')->count());
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        Http::assertNothingSent();
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
        $this->assertSame(['min' => 15, 'max' => 20], $all['prompt_bounds']);

        $refresh = $payload['channel_ai_refresh'];
        $this->assertSame(39, $refresh['configured_channels']);
        $this->assertSame(1, $refresh['existing_channels']);
        $this->assertSame(39, $refresh['would_attempt_channel_ai_refresh']);
        $this->assertSame(1, $refresh['would_insert_channel_ai_candidates']);
        $this->assertSame(76, $refresh['sample_channels'][0]['u_id']);
        $this->assertSame(10, $refresh['sample_channels'][0]['video_rows']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
    }

    public function test_ai_daily_explicit_dry_run_forwards_caps_and_offsets_eligible_channels_like_execute(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $existingChannelAiRows = DB::table('urt_channel_ai')->count();
        DB::table('urt_channel')->insert([
            ['u_id' => 76, 'title' => 'First Eligible Channel'],
            ['u_id' => 405, 'title' => 'Second Eligible Channel'],
            ['u_id' => 39, 'title' => 'Third Eligible Channel'],
        ]);

        foreach ([76, 405, 39] as $uId) {
            for ($index = 1; $index <= 12; $index++) {
                DB::table('urt_video')->insert([
                    'u_id' => $uId,
                    'videoId' => sprintf('preview-%d-video-%d', $uId, $index),
                    'publishedAt' => '2026-05-24 12:00:00',
                    'title' => sprintf('Preview Channel %d Video %d', $uId, $index),
                    'channelTitle' => 'Preview Channel '.$uId,
                ]);
            }
        }

        $exitCode = Artisan::call('ai:daily', [
            '--dry-run' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 2,
            '--channel-offset' => 1,
            '--channel-batch-size' => 1,
            '--ai-call-limit' => 1,
            '--channel-video-limit' => 11,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);
        $refresh = $payload['channel_ai_refresh'];

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(2, $refresh['limit']);
        $this->assertSame(1, $refresh['offset']);
        $this->assertSame([405, 39], $refresh['selected_channel_ids']);
        $this->assertSame(1, $refresh['batch_size']);
        $this->assertSame(1, $refresh['effective_batch_size']);
        $this->assertSame(2, $refresh['batches']);
        $this->assertSame(11, $refresh['video_limit']);
        $this->assertSame(2, $refresh['would_attempt_channel_ai_refresh']);
        $this->assertSame(2, $refresh['eligible_channel_ai_candidates']);
        $this->assertSame(1, $refresh['would_call_channel_ai_requests']);
        $this->assertSame(1, $refresh['would_skip_ai_call_guard']);
        $this->assertSame(1, $refresh['prompt_truncated_channels']);
        $this->assertSame(1, $refresh['prompt_omitted_video_rows']);
        $this->assertSame(1, $payload['ai_call_guard']['limit']);
        $this->assertSame(1, $payload['ai_call_guard']['would_use']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        $this->assertSame($existingChannelAiRows, DB::table('urt_channel_ai')->count());
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
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'fallback-test');
        config()->set('services.opencode_go.transient_retries', 1);

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'model' => 'qwen-test-2026-07-15',
                    'choices' => [
                        [
                            'message' => [
                                'content' => $this->channelCompletion('頻道事件'),
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'model' => 'qwen-test-2026-07-15',
                    'choices' => [
                        [
                            'message' => [
                                'content' => $this->dailyCompletion('每日事件'),
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 20, 'completion_tokens' => 6],
                ])
                ->push([
                    'model' => 'replacement-model-2026-07-15',
                    'choices' => [
                        [
                            'message' => [
                                'content' => $this->channelCompletion('頻道事件更新'),
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 11, 'completion_tokens' => 5],
                ])
                ->push([
                    'model' => 'replacement-model-2026-07-15',
                    'choices' => [
                        [
                            'message' => [
                                'content' => $this->dailyCompletion('每日事件更新'),
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
        $this->assertSame('qwen-test-2026-07-15', $payload['channel_ai']['rows'][0]['model']);
        $this->assertSame('qwen-test-2026-07-15', $payload['daily_ai']['rows'][0]['model']);
        $this->assertSame([
            'limit' => 45,
            'used' => 2,
            'remaining' => 43,
            'unit' => 'logical_completion_chain',
            'provider_attempts_per_chain_limit' => 4,
            'provider_request_limit' => 180,
            'provider_requests_used' => 2,
            'provider_requests_remaining' => 178,
        ], $payload['ai_call_guard']);
        $this->assertSame('not_printed', $payload['secrets']);
        $this->assertDatabaseHas('urt_channel_ai', [
            'u_id' => 76,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'ai_type' => 'qwen-test',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'result_json' => $this->channelCompletion('頻道事件'),
        ]);
        $this->assertDatabaseHas('urt_ai_date', [
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'condition_type' => 'all',
            'ai_type' => 'qwen-test',
            'data_type' => 'oneday',
            'user_token' => 'CLI',
            'result_json' => $this->dailyCompletion('每日事件'),
        ]);
        $storedChannelMap = json_decode(
            (string) DB::table('urt_ai_date')
                ->where('date_from', '2026-05-24 00:00:00')
                ->where('condition_type', 'all')
                ->value('channel_id'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        $this->assertEqualsCanonicalizing([
            76 => 'Configured News Channel',
            30 => 'Finance Channel',
            20 => 'Blue Channel',
            10 => 'Green Channel',
        ], $storedChannelMap);

        config()->set('services.opencode_go.model', 'replacement-model');
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
        $this->assertSame('replacement-model-2026-07-15', $payload['channel_ai']['rows'][0]['model']);
        $this->assertSame('replacement-model-2026-07-15', $payload['daily_ai']['rows'][0]['model']);
        $this->assertSame(4, DB::table('urt_channel_ai')->count());
        $this->assertSame(1, DB::table('urt_ai_date')->count());
        $this->assertSame('replacement-model', DB::table('urt_channel_ai')->where('u_id', 76)->value('ai_type'));
        $this->assertSame('replacement-model', DB::table('urt_ai_date')->value('ai_type'));
        Http::assertSentCount(4);
    }

    public function test_ai_daily_normalizes_official_structured_media_rows_and_stores_configured_model_alias(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        config()->set('services.opencode_go.api_key', 'official-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.max_tokens', 4096);
        config()->set('services.opencode_go.daily_max_tokens', 12_288);
        config()->set('services.opencode_go.fallback_api_key', null);
        $structuredEvents = collect(range(1, 15))->map(function (int $index): array {
            $mediaRows = [
                ['媒體' => 'Green Channel', '事件' => ['Green Multi']],
                ['媒體' => 'Blue Channel', '事件' => ['Blue Multi']],
            ];

            if ($index === 1) {
                $mediaRows[] = ['媒體' => 'Green Channel', '事件' => ['Green Duplicate']];
                $mediaRows[] = ['媒體' => ' ', '事件' => ['']];
            }

            return [
                '標題' => '結構化每日事件 '.$index,
                '媒體事件' => $mediaRows,
            ];
        })->all();

        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-07-15',
                'choices' => [['message' => ['content' => json_encode([
                    'events' => $structuredEvents,
                ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]]],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);
        $stored = json_decode(
            (string) DB::table('urt_ai_date')->value('result_json'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        $this->assertSame(0, $exitCode);
        $this->assertSame('gpt-5.4-mini-2026-07-15', $payload['daily_ai']['rows'][0]['model']);
        $this->assertSame('gpt-5.4-mini', DB::table('urt_ai_date')->value('ai_type'));
        $this->assertSame([
            'Green Channel' => ['Green Multi'],
            'Blue Channel' => ['Blue Multi'],
        ], $stored[0]['媒體事件']);
        Http::assertSent(function (Request $request): bool {
            $format = $request['response_format'] ?? [];
            $events = $format['json_schema']['schema']['properties']['events'] ?? [];
            $mediaRows = $events['items']['properties']['媒體事件'] ?? [];
            $mediaEvents = $mediaRows['items']['properties']['事件'] ?? [];
            $prompt = (string) data_get($request->data(), 'messages.0.content');

            return ($format['type'] ?? null) === 'json_schema'
                && ($format['json_schema']['strict'] ?? null) === true
                && ($request['max_completion_tokens'] ?? null) === 12_288
                && ! isset($request['max_tokens'])
                && ($events['minItems'] ?? null) === 15
                && ($events['maxItems'] ?? null) === 20
                && ($mediaRows['minItems'] ?? null) === 2
                && ($mediaRows['maxItems'] ?? null) === 6
                && ($mediaEvents['minItems'] ?? null) === 1
                && ($mediaEvents['maxItems'] ?? null) === 1
                && str_contains($prompt, '"媒體事件": [')
                && str_contains($prompt, '2 到 6 個最具代表性的媒體')
                && str_contains($prompt, '正好保留 1 個最具代表性的輸入事件')
                && str_contains($prompt, '不得重複媒體名稱');
        });
    }

    public function test_ai_daily_other_condition_keeps_primary_provider_token_cap(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        config()->set('services.opencode_go.api_key', 'official-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.max_tokens', 4096);
        config()->set('services.opencode_go.daily_max_tokens', 12_288);
        config()->set('services.opencode_go.fallback_api_key', null);
        $structuredEvents = collect(range(1, 8))->map(fn (int $index): array => [
            '標題' => '綠營每日事件 '.$index,
            '媒體事件' => [
                ['媒體' => 'Green Channel', '事件' => ['Green Multi']],
                ['媒體' => 'Second Channel', '事件' => ['Related event']],
            ],
        ])->all();

        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::response([
                'model' => 'gpt-5.4-mini-2026-07-15',
                'choices' => [['message' => ['content' => json_encode([
                    'events' => $structuredEvents,
                ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]]],
            ]),
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'green',
            '--channel-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);

        $this->assertSame(0, $exitCode);
        $this->assertSame('green', DB::table('urt_ai_date')->value('condition_type'));
        Http::assertSent(fn (Request $request): bool => ($request['max_completion_tokens'] ?? null) === 4096
            && ! isset($request['max_tokens'])
            && ($request['response_format']['type'] ?? null) === 'json_schema');
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
                                'content' => $this->channelCompletion('後段頻道事件'),
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => $this->dailyCompletion('每日事件'),
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
                                'content' => $this->channelCompletion('第二批頻道事件'),
                            ],
                        ],
                    ],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [
                        [
                            'message' => [
                                'content' => $this->dailyCompletion('每日事件'),
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
                    'choices' => [['message' => ['content' => $this->channelCompletion('第一頻道事件')]]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => $this->channelCompletion('第二頻道事件')]]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => $this->channelCompletion('第三頻道事件')]]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => $this->dailyCompletion('每日事件')]]],
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
                'choices' => [['message' => ['content' => $this->channelCompletion('第一頻道事件')]]],
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

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['channel_ai']['inserted']);
        $this->assertSame(1, $payload['channel_ai']['skipped']);
        $this->assertSame('ai_call_guard_exhausted', $payload['channel_ai']['rows'][1]['skip_reason']);
        $this->assertFalse($payload['channel_ai']['rows'][1]['ai_call_attempted']);
        $this->assertSame(1, $payload['daily_ai']['skipped']);
        $this->assertSame(1, $payload['daily_ai']['failed']);
        $this->assertSame('channel_ai_incomplete', $payload['daily_ai']['rows'][0]['skip_reason']);
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
                    'choices' => [['message' => ['content' => $this->channelCompletion('頻道事件')]]],
                    'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
                ])
                ->push([
                    'choices' => [['message' => ['content' => $this->dailyCompletion('每日事件')]]],
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
        $this->assertTrue($payload['channel_ai']['rows'][0]['prompt_truncated']);
        $this->assertSame(5, $payload['channel_ai']['rows'][0]['prompt_omitted_video_rows']);
        $this->assertSame(1, $payload['channel_ai']['prompt_truncated_channels']);
        $this->assertSame(5, $payload['channel_ai']['prompt_omitted_video_rows']);
        Http::assertSentCount(2);
    }

    public function test_ai_daily_zero_channel_video_limit_uses_finite_hard_max_and_reports_truncation(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        DB::table('urt_channel')->insert(['u_id' => 76, 'title' => 'Configured News Channel']);
        $videos = [];

        for ($index = 1; $index <= 501; $index++) {
            $videos[] = [
                'u_id' => 76,
                'videoId' => sprintf('hard-cap-video-%03d', $index),
                'publishedAt' => '2026-05-24 12:00:00',
                'title' => 'Hard Cap Video '.$index,
                'channelTitle' => 'Configured News Channel',
                'viewCount' => 1000 + $index,
            ];
        }

        foreach (array_chunk($videos, 100) as $chunk) {
            DB::table('urt_video')->insert($chunk);
        }

        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => $this->channelCompletion('頻道事件', 19)]]],
                'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 5],
            ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 1,
            '--channel-video-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);
        $channelRow = $payload['channel_ai']['rows'][0];

        $this->assertSame(1, $exitCode);
        $this->assertSame(0, $payload['channel_ai']['video_limit_requested']);
        $this->assertSame(500, $payload['channel_ai']['video_limit']);
        $this->assertSame(500, $payload['channel_ai']['video_limit_max']);
        $this->assertTrue($payload['channel_ai']['video_limit_clamped']);
        $this->assertSame(501, $channelRow['video_rows']);
        $this->assertSame(500, $channelRow['prompt_video_rows']);
        $this->assertTrue($channelRow['prompt_truncated']);
        $this->assertSame(1, $channelRow['prompt_omitted_video_rows']);
        $this->assertSame(1, $payload['channel_ai']['prompt_truncated_channels']);
        $this->assertSame(1, $payload['channel_ai']['prompt_omitted_video_rows']);
        $this->assertSame(1, $payload['daily_ai']['failed']);
        $this->assertSame('ai_call_guard_exhausted', $payload['daily_ai']['rows'][0]['skip_reason']);
        Http::assertSentCount(1);
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
        $this->useDirectDailyScheduledCommand();
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake(function ($request) {
            $prompt = (string) data_get($request->data(), 'messages.0.content', '');
            $content = str_contains($prompt, '多個媒體的事件列表')
                ? $this->dailyCompletion('排程每日事件', $this->dailyMinimumFromPrompt($prompt))
                : $this->channelCompletion('排程事件', $this->channelMinimumFromPrompt($prompt));

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
        $this->assertGreaterThanOrEqual(
            1,
            DB::table('urt_ai_date')->count(),
            json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );
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

    public function test_recorded_scheduler_daily_pipeline_crawls_all_required_channels_before_calling_ai(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:00:00', 'Asia/Taipei'));
        Storage::fake('local');
        $this->createTables();
        $this->createDailyPipelineSourceTables();
        $this->seedDailyPipelineChannels();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['ai.daily']);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        config()->set('services.youtube.api_key', 'test-youtube-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        config()->set('services.opencode_go.api_key', 'test-ai-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_api_key', null);
        $requestStages = [];
        $youtubePlaylists = [];
        $aiRequests = 0;

        Http::fake(function (Request $request) use (&$requestStages, &$youtubePlaylists, &$aiRequests) {
            if (str_starts_with($request->url(), 'https://www.googleapis.com/youtube/v3/playlistItems')) {
                $requestStages[] = 'youtube';
                $playlistId = (string) $request['playlistId'];
                $youtubePlaylists[] = $playlistId;

                return Http::response([
                    'items' => $playlistId === 'UU-daily-76'
                        ? $this->dailyPipelinePlaylistItems()
                        : [],
                ]);
            }

            if ($request->url() === 'https://opencode.test/v1/chat/completions') {
                $requestStages[] = 'ai';
                $aiRequests++;
                $prompt = (string) data_get($request->data(), 'messages.0.content', '');
                $content = str_contains($prompt, '多個媒體的事件列表')
                    ? $this->dailyCompletion('整合每日事件', $this->dailyMinimumFromPrompt($prompt))
                    : $this->channelCompletion('整合頻道事件', $this->channelMinimumFromPrompt($prompt));

                return Http::response([
                    'choices' => [['message' => ['content' => $content]]],
                    'usage' => ['prompt_tokens' => 30, 'completion_tokens' => 8, 'total_tokens' => 38],
                ]);
            }

            return Http::response(['error' => ['message' => 'unexpected test request']], 500);
        });
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ingestion:run', [
            '--execute' => true,
            '--record' => true,
            '--at' => '2026-05-26 00:00:00',
            '--job' => 'ai.daily',
        ]);

        $this->assertSame(0, $exitCode, Artisan::output());
        $this->assertEqualsCanonicalizing(
            collect(AiDailyPreview::channelAiUids())
                ->map(fn (int $uId): string => 'UU-daily-'.$uId)
                ->all(),
            array_values(array_unique($youtubePlaylists)),
        );
        $this->assertSame(array_fill(0, 39, 'youtube'), array_slice($requestStages, 0, 39));
        $this->assertSame(array_fill(0, $aiRequests, 'ai'), array_slice($requestStages, 39));
        $this->assertSame(3, $aiRequests, json_encode([
            'request_stages' => $requestStages,
            'channel_rows' => DB::table('urt_channel_ai')->get()->all(),
            'daily_rows' => DB::table('urt_ai_date')->get()->all(),
            'artisan_output' => Artisan::output(),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $this->assertDatabaseCount('urt_channel_ai', 1);
        $this->assertDatabaseCount('urt_ai_date', 2);
        $this->assertDatabaseCount('ingestion_runs', 1);
        $this->assertDatabaseHas('ingestion_run_jobs', [
            'job_key' => 'ai.daily',
            'succeeded' => 1,
            'failed' => 0,
        ]);
        $this->assertDatabaseHas('urt_show_tag_date', [
            'tagid' => '102',
            'the_date' => '2026-05-25',
            'count_channels' => 39,
            'count_videos' => 10,
        ]);
        $stored = json_decode((string) DB::table('ingestion_runs')->value('payload_json'), true, 512, JSON_THROW_ON_ERROR);
        $job = $stored['result']['jobs'][0];

        $this->assertSame('ai.daily', $job['key']);
        $this->assertStringStartsWith('ai:daily:pipeline --execute', $job['effective_command']);
        $this->assertStringContainsString('source_succeeded=yes', $job['output']);
        $this->assertStringContainsString('source_channels=39', $job['output']);
        $this->assertStringContainsString('source_failed=0', $job['output']);
        $this->assertStringContainsString('ai_status=success', $job['output']);
        $this->assertStringContainsString('ai_calls=3', $job['output']);
        $this->assertCount(39, $job['telemetry']['youtube_requests']);
        $this->assertSame(
            ['ai.daily', 'youtube.tag_videos.backfill'],
            $job['telemetry']['youtube_requests'][0]['job_path'],
        );
        $this->assertSame(3, $job['telemetry']['summary']['ai_requests']);
        $this->assertSame('ai.daily', $job['telemetry']['ai_requests'][0]['job_key']);
        $this->assertSame('primary', $job['telemetry']['ai_requests'][0]['provider']);
        $this->assertSame(39, $job['estimated_youtube_quota_units']);
        $this->assertSame(39, $job['youtube_quota_estimate']['estimated_units']);
        $this->assertSame(0, $job['youtube_quota_budget']['planned_units']);
        $this->assertSame(39, $job['youtube_quota_budget']['actual_units']);
        $this->assertSame(39, $job['youtube_quota_budget']['consumed_units']);
        $this->assertSame(0, $job['youtube_quota_budget']['reserved_units']);
        $this->assertSame(39, $job['youtube_quota_budget']['projected_units']);
        $this->assertSame(8961, $job['youtube_quota_budget']['remaining_units']);
        $this->assertFalse($job['youtube_quota_budget']['reservation_active']);
        $this->assertSame(39, $stored['result']['youtube_quota_budget']['consumed_units']);
        $this->assertSame(0, $stored['result']['youtube_quota_budget']['reserved_units']);
        $this->assertSame(39, $stored['result']['youtube_quota_budget']['projected_units']);
        $this->assertSame(8961, $stored['result']['youtube_quota_budget']['remaining_units']);
        $this->assertSame(39, $stored['result']['telemetry']['youtube_requests']);
        $this->assertSame(3, $stored['result']['telemetry']['ai_requests']);
        $this->assertDatabaseHas('ingestion_youtube_quota_daily', [
            'consumed_units' => 39,
            'reserved_units' => 0,
        ]);
        Http::assertSentCount(42);
    }

    private function useDirectDailyScheduledCommand(): void
    {
        config()->set('ingestion.jobs', collect(config('ingestion.jobs', []))
            ->map(function (array $job): array {
                if (($job['key'] ?? null) === 'ai.daily') {
                    $job['scheduled_execute_command'] = 'ai:daily --execute --date=yesterday --type=oneday --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000';
                }

                return $job;
            })
            ->all());
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
        $this->assertSame('channel_ai_incomplete', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertFalse($payload['daily_ai']['rows'][0]['ai_call_attempted']);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        $this->assertSame(3, DB::table('urt_channel_ai')->count());
    }

    public function test_ai_daily_rejects_invalid_channel_json_and_blocks_daily_summary(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $this->seedRefreshChannelVideos();
        $existingChannel = $this->channelCompletion('既有完整頻道事件');
        DB::table('urt_channel_ai')->insert($this->channelAiRow(
            76,
            json_decode($existingChannel, true, 512, JSON_THROW_ON_ERROR),
        ));
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');
        Log::spy();

        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push([
                    'choices' => [['message' => ['content' => 'not json token=ai-output-secret']]],
                ])
                ->push(['choices' => [['message' => ['content' => $this->dailyCompletion('不應呼叫')]]]]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--channel-limit' => 1,
            '--ai-call-limit' => 2,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(7, $payload['failed_rows']);
        $this->assertSame('invalid_ai_json', $payload['channel_ai']['rows'][0]['skip_reason']);
        $this->assertSame(0, $payload['daily_ai']['inserted']);
        $this->assertSame(6, $payload['daily_ai']['failed']);
        $this->assertTrue(collect($payload['daily_ai']['rows'])->every(
            fn (array $row): bool => $row['skip_reason'] === 'channel_ai_incomplete'
                && $row['ai_call_attempted'] === false,
        ));
        $this->assertStringNotContainsString('ai-output-secret', $output);
        $this->assertSame(4, DB::table('urt_channel_ai')->count());
        $this->assertSame(
            $existingChannel,
            DB::table('urt_channel_ai')->where('u_id', 76)->value('result_json'),
        );
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        Http::assertSentCount(1);
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
                    'choices' => [['message' => ['content' => $this->channelCompletion('頻道事件')]]],
                ])
                ->push([
                    'choices' => [['message' => ['content' => $this->dailyCompletion('不應呼叫')]]],
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
        $this->assertSame(0, $payload['daily_ai']['inserted']);
        $this->assertSame(1, $payload['daily_ai']['failed']);
        $this->assertSame('channel_ai_incomplete', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertSame('database_write_failed', $payload['channel_ai']['rows'][0]['skip_reason']);
        $this->assertStringNotContainsString('channel-db-secret', $output);
        $this->assertSame(0, DB::table('urt_ai_date')->count());
        Http::assertSentCount(1);
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'AI daily ingestion item failed.'
                    && $context['stage'] === 'channel_write'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'channel-db-secret');
            });
    }

    public function test_ai_daily_rejects_under_and_oversized_results_without_overwriting_complete_cache(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $existing = $this->dailyCompletion('既有完整每日事件');
        $this->insertDailyCache($existing);
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'replacement-model');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::sequence()
                ->push(['choices' => [['message' => ['content' => $this->dailyCompletion('過少', 14)]]]])
                ->push(['choices' => [['message' => ['content' => $this->dailyCompletion('過多', 21)]]]]),
        ]);

        foreach ([
            'ai_payload_item_count_below_minimum',
            'ai_payload_item_count_above_maximum',
        ] as $expectedReason) {
            $exitCode = Artisan::call('ai:daily', [
                '--execute' => true,
                '--date' => '2026-05-24',
                '--condition' => 'all',
                '--channel-limit' => 0,
                '--ai-call-limit' => 1,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

            $this->assertSame(1, $exitCode);
            $this->assertSame($expectedReason, $payload['daily_ai']['rows'][0]['skip_reason']);
            $this->assertSame(1, $payload['daily_ai']['failed']);
            $this->assertSame(1, DB::table('urt_ai_date')->count());
            $this->assertSame('existing-model', DB::table('urt_ai_date')->value('ai_type'));
            $this->assertSame($existing, DB::table('urt_ai_date')->value('result_json'));
        }
    }

    public function test_ai_daily_rejects_topics_with_one_media_source_without_overwriting_complete_cache(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $existing = $this->dailyCompletion('既有完整每日事件');
        $this->insertDailyCache($existing);
        config()->set('services.opencode_go.api_key', 'test-key');
        config()->set('services.opencode_go.base_url', 'https://opencode.test/v1');
        config()->set('services.opencode_go.model', 'replacement-model');
        Http::fake([
            'https://opencode.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => $this->dailyCompletion('單一來源', 15, 1)]]],
            ]),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('invalid_ai_payload_shape', $payload['daily_ai']['rows'][0]['skip_reason']);
        $this->assertSame(1, DB::table('urt_ai_date')->count());
        $this->assertSame('existing-model', DB::table('urt_ai_date')->value('ai_type'));
        $this->assertSame($existing, DB::table('urt_ai_date')->value('result_json'));
    }

    public function test_ai_daily_rejects_fallback_payloads_exceeding_generation_representation_caps_without_write(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $existing = $this->dailyCompletion('既有完整每日事件');
        $this->insertDailyCache($existing);
        config()->set('services.opencode_go.api_key', 'primary-key');
        config()->set('services.opencode_go.base_url', 'https://api.openai.com/v1');
        config()->set('services.opencode_go.model', 'gpt-5.4-mini');
        config()->set('services.opencode_go.endpoint_style', 'chat');
        config()->set('services.opencode_go.max_tokens', 4096);
        config()->set('services.opencode_go.daily_max_tokens', 12_288);
        config()->set('services.opencode_go.fallback_api_key', 'fallback-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'qwen3.6-plus');
        config()->set('services.opencode_go.fallback_endpoint_style', 'chat');
        config()->set('services.opencode_go.fallback_max_tokens', 1200);
        config()->set('services.opencode_go.transient_retries', 0);
        Http::fake([
            'https://api.openai.com/v1/chat/completions' => Http::sequence()
                ->push(['error' => ['message' => 'primary unavailable']], 400)
                ->push(['error' => ['message' => 'primary unavailable']], 400),
            'https://fallback.test/v1/chat/completions' => Http::sequence()
                ->push(['choices' => [['message' => ['content' => $this->dailyCompletion('過多代表媒體', 15, 7)]]]])
                ->push(['choices' => [['message' => ['content' => $this->dailyCompletion('單一媒體多事件', 15, 2, 2)]]]]),
        ]);
        Http::preventStrayRequests();

        foreach (range(1, 2) as $_attempt) {
            $exitCode = Artisan::call('ai:daily', [
                '--execute' => true,
                '--date' => '2026-05-24',
                '--condition' => 'all',
                '--channel-limit' => 0,
                '--ai-call-limit' => 1,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

            $this->assertSame(1, $exitCode);
            $this->assertSame('invalid_ai_payload_shape', $payload['daily_ai']['rows'][0]['skip_reason']);
            $this->assertSame(1, $payload['daily_ai']['failed']);
            $this->assertSame(1, DB::table('urt_ai_date')->count());
            $this->assertSame('existing-model', DB::table('urt_ai_date')->value('ai_type'));
            $this->assertSame($existing, DB::table('urt_ai_date')->value('result_json'));
        }

        $requests = Http::recorded()->map(fn (array $record): Request => $record[0]);
        $primaryRequests = $requests->filter(
            fn (Request $request): bool => $request->url() === 'https://api.openai.com/v1/chat/completions',
        );
        $fallbackRequests = $requests->filter(
            fn (Request $request): bool => $request->url() === 'https://fallback.test/v1/chat/completions',
        );

        $this->assertCount(2, $primaryRequests);
        $this->assertCount(2, $fallbackRequests);
        $this->assertTrue($primaryRequests->every(fn (Request $request): bool => ($request['max_completion_tokens'] ?? null) === 12_288
            && ($request['response_format']['type'] ?? null) === 'json_schema'));
        $this->assertTrue($fallbackRequests->every(fn (Request $request): bool => ($request['max_tokens'] ?? null) === 1200
            && ! isset($request['max_completion_tokens'])
            && ! isset($request['response_format'])));
    }

    public function test_ai_daily_propagates_safe_validation_reason_before_fallback_http_failure(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 16:15:00', 'Asia/Taipei'));
        $this->createTables();
        $this->seedDailyAiFixtures();
        $existing = $this->dailyCompletion('既有完整每日事件');
        $this->insertDailyCache($existing);
        config()->set('services.opencode_go.api_key', 'primary-secret-key');
        config()->set('services.opencode_go.base_url', 'https://primary.test/v1');
        config()->set('services.opencode_go.model', 'primary-model');
        config()->set('services.opencode_go.fallback_api_key', 'fallback-secret-key');
        config()->set('services.opencode_go.fallback_base_url', 'https://fallback.test/v1');
        config()->set('services.opencode_go.fallback_model', 'fallback-model');
        config()->set('services.opencode_go.transient_retries', 0);
        Http::fake([
            'https://primary.test/v1/chat/completions' => Http::response([
                'choices' => [['message' => ['content' => $this->dailyCompletion('過少', 14)]]],
            ]),
            'https://fallback.test/v1/chat/completions' => Http::response([
                'error' => ['message' => 'quota token=fallback-provider-secret'],
            ], 429),
        ]);

        $exitCode = Artisan::call('ai:daily', [
            '--execute' => true,
            '--date' => '2026-05-24',
            '--condition' => 'all',
            '--channel-limit' => 0,
            '--ai-call-limit' => 1,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
        $reason = $payload['daily_ai']['rows'][0]['skip_reason'];

        $this->assertSame(1, $exitCode);
        $this->assertSame('ai_payload_item_count_below_minimum', $reason);
        $this->assertStringNotContainsString('fallback-provider-secret', $output);
        $this->assertSame($existing, DB::table('urt_ai_date')->value('result_json'));
        Http::assertSentCount(2);
    }

    private function channelCompletion(string $title, int $count = 3): string
    {
        return json_encode(collect(range(1, $count))->map(fn (int $index): array => [
            '事件' => $title.' '.$index,
            '描述' => $title.'描述 '.$index,
            '關鍵字' => ['測試'],
            'videoId' => ['video-'.$index.'-a', 'video-'.$index.'-b'],
        ])->all(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function dailyCompletion(
        string $title,
        int $count = 15,
        int $mediaCount = 2,
        int $eventsPerMedia = 1,
    ): string {
        return json_encode(collect(range(1, $count))->map(fn (int $index): array => [
            '標題' => $title.' '.$index,
            '媒體事件' => collect(range(1, max(1, $mediaCount)))
                ->mapWithKeys(fn (int $media): array => [
                    '測試媒體 '.$media => collect(range(1, max(1, $eventsPerMedia)))
                        ->map(fn (int $event): string => $title.'來源事件 '.$index.'-'.$media.
                            ($eventsPerMedia > 1 ? '-'.$event : ''))
                        ->all(),
                ])
                ->all(),
        ])->all(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function channelMinimumFromPrompt(string $prompt): int
    {
        return preg_match('/整理成\s+(\d+)\s*~/u', $prompt, $matches) === 1
            ? (int) $matches[1]
            : 3;
    }

    private function dailyMinimumFromPrompt(string $prompt): int
    {
        return preg_match('/合併成\s+(\d+)\s+到/u', $prompt, $matches) === 1
            ? (int) $matches[1]
            : 15;
    }

    private function insertDailyCache(string $resultJson): void
    {
        DB::table('urt_ai_date')->insert([
            'ctime' => '2026-05-25 10:00:00',
            'mtime' => null,
            'date_from' => '2026-05-24 00:00:00',
            'date_to' => '2026-05-24 23:59:59',
            'ai_type' => 'existing-model',
            'data_type' => 'oneday',
            'condition_type' => 'all',
            'user_token' => 'CLI',
            'del_flag' => null,
            'channel_id' => '{}',
            'result_json' => $resultJson,
        ]);
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

    private function createDailyPipelineSourceTables(): void
    {
        Schema::table('urt_channel', function ($table): void {
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('vtime')->nullable();
            $table->integer('flag_del')->nullable();
            $table->string('youtube_id')->nullable();
            $table->string('uploads')->nullable();
            $table->integer('videoCount')->nullable();
        });

        Schema::table('urt_video', function ($table): void {
            $table->dateTime('ctime')->nullable();
            $table->string('id')->nullable();
            $table->string('channelId')->nullable();
            $table->string('thumbnails')->nullable();
            $table->string('playlistId')->nullable();
            $table->integer('position')->nullable();
            $table->text('description')->nullable();
        });

        Schema::create('urt_video_schedule', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->string('videoId');
            $table->dateTime('publishedAt')->nullable();
        });

        Schema::create('urt_video_live', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->string('videoId');
            $table->dateTime('publishedAt')->nullable();
            $table->integer('u_id');
        });

        Schema::create('tags', function ($table): void {
            $table->increments('pk');
            $table->string('tag');
            $table->integer('max_count')->nullable();
            $table->integer('hours_count')->nullable();
            $table->dateTime('max_hours')->nullable();
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->date('the_date')->nullable();
            $table->integer('tags_count')->nullable();
            $table->integer('total_views')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
    }

    private function seedDailyPipelineChannels(): void
    {
        $channelIds = collect(AiDailyPreview::channelAiUids());

        DB::table('urt_channel')->insert($channelIds
            ->map(fn (int $uId): array => [
                'u_id' => $uId,
                'ctime' => '2026-05-20 00:00:00',
                'flag_del' => null,
                'youtube_id' => 'UC-daily-'.$uId,
                'title' => 'Daily Pipeline Channel '.$uId,
                'uploads' => 'UU-daily-'.$uId,
                'videoCount' => 100,
            ])
            ->all());
        DB::table('urt_count')->insert($channelIds
            ->map(fn (int $uId): array => ['u_id' => $uId, 'tags' => '[102]'])
            ->all());
        DB::table('tags')->insert([
            'tag' => '整合',
            'max_count' => 10,
            'hours_count' => 20,
            'max_hours' => '2026-05-26 00:00:00',
            'no_tag' => null,
        ]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function dailyPipelinePlaylistItems(): array
    {
        return collect(range(1, 10))
            ->map(fn (int $index): array => [
                'id' => 'daily-pipeline-item-'.$index,
                'snippet' => [
                    'publishedAt' => sprintf('2026-05-25T%02d:00:00Z', $index),
                    'channelId' => 'UC-daily-76',
                    'title' => '整合 Daily Pipeline Video '.$index,
                    'description' => 'Daily pipeline integration fixture',
                    'thumbnails' => ['default' => ['url' => 'https://img.test/daily-pipeline-'.$index.'.jpg']],
                    'channelTitle' => 'Daily Pipeline Channel 76',
                    'playlistId' => 'UU-daily-76',
                    'position' => $index - 1,
                    'resourceId' => ['videoId' => 'daily-pipeline-video-'.$index],
                    'liveBroadcastContent' => 'none',
                ],
            ])
            ->all();
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
