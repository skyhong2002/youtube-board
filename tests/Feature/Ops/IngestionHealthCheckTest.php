<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiDailyPreview;
use App\Services\Ingestion\IngestionTelemetry;
use App\Services\Ingestion\OpenCodeChatClient;
use App\Services\Ingestion\YoutubeDataApiClient;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class IngestionHealthCheckTest extends TestCase
{
    public function test_clients_record_youtube_and_ai_request_latency_without_secrets(): void
    {
        config()->set('services.youtube.api_key', 'youtube-secret-key');
        config()->set('services.opencode_go.api_key', 'ai-secret-key');
        config()->set('services.opencode_go.base_url', 'https://ai.example.test/v1');
        config()->set('services.opencode_go.model', 'qwen-test');

        Http::fake([
            'https://www.googleapis.com/youtube/v3/channels*' => Http::response([
                'items' => [
                    [
                        'id' => 'UC-test',
                        'statistics' => [
                            'viewCount' => '100',
                            'subscriberCount' => '10',
                            'videoCount' => '5',
                        ],
                    ],
                ],
            ]),
            'https://ai.example.test/v1/chat/completions' => Http::response([
                'choices' => [
                    ['message' => ['content' => '{"ok":true}']],
                ],
                'usage' => [
                    'prompt_tokens' => 12,
                    'completion_tokens' => 4,
                    'total_tokens' => 16,
                ],
            ]),
        ]);
        Http::preventStrayRequests();

        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();
        $telemetry->startJob('test.external');

        app(YoutubeDataApiClient::class)->channelStatistics(['UC-test']);
        app(OpenCodeChatClient::class)->complete('請回覆 JSON');

        $snapshot = $telemetry->finishJob('test.external');

        $this->assertCount(1, $snapshot['youtube_requests']);
        $this->assertSame('channels.list', $snapshot['youtube_requests'][0]['method']);
        $this->assertSame(1, $snapshot['youtube_requests'][0]['resource_count']);
        $this->assertArrayHasKey('latency_ms', $snapshot['youtube_requests'][0]);

        $this->assertCount(1, $snapshot['ai_requests']);
        $this->assertSame('primary', $snapshot['ai_requests'][0]['provider']);
        $this->assertSame('qwen-test', $snapshot['ai_requests'][0]['model']);
        $this->assertSame(16, $snapshot['ai_requests'][0]['usage']['total_tokens']);
        $this->assertArrayHasKey('latency_ms', $snapshot['ai_requests'][0]);

        $encoded = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $this->assertStringNotContainsString('youtube-secret-key', (string) $encoded);
        $this->assertStringNotContainsString('ai-secret-key', (string) $encoded);
    }

    public function test_telemetry_keeps_same_child_events_across_top_level_and_nested_frames(): void
    {
        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();

        $telemetry->startJob('youtube.channels.videos.general');
        $telemetry->recordYoutubeRequest(['method' => 'top-level']);
        $topLevel = $telemetry->finishJob('youtube.channels.videos.general');

        $telemetry->startJob('ai.hourly');
        $telemetry->startJob('youtube.channels.videos.general');
        $telemetry->recordYoutubeRequest(['method' => 'nested']);
        $nested = $telemetry->finishJob('youtube.channels.videos.general');
        $parent = $telemetry->finishJob('ai.hourly');

        $this->assertSame(1, $topLevel['summary']['youtube_requests']);
        $this->assertSame(1, $nested['summary']['youtube_requests']);
        $this->assertSame(1, $parent['summary']['youtube_requests']);
        $this->assertSame(['youtube.channels.videos.general'], $topLevel['youtube_requests'][0]['job_path']);
        $this->assertSame(
            ['ai.hourly', 'youtube.channels.videos.general'],
            $nested['youtube_requests'][0]['job_path'],
        );
        $this->assertSame(2, $telemetry->summary()['youtube_requests']);
    }

    public function test_reentered_parent_frame_excludes_old_descendant_events(): void
    {
        $telemetry = app(IngestionTelemetry::class);
        $telemetry->reset();

        $telemetry->startJob('parent');
        $telemetry->startJob('first-child');
        $telemetry->recordYoutubeRequest(['method' => 'first']);
        $telemetry->recordAiRequest(['provider' => 'first']);
        $telemetry->finishJob('first-child');
        $first = $telemetry->finishJob('parent');

        $telemetry->startJob('parent');
        $telemetry->startJob('second-child');
        $telemetry->recordYoutubeRequest(['method' => 'second']);
        $telemetry->recordAiRequest(['provider' => 'second']);
        $telemetry->finishJob('second-child');
        $second = $telemetry->finishJob('parent');

        $this->assertSame(1, $first['summary']['youtube_requests']);
        $this->assertSame(1, $first['summary']['ai_requests']);
        $this->assertSame(1, $second['summary']['youtube_requests']);
        $this->assertSame(1, $second['summary']['ai_requests']);
        $this->assertSame('second', $second['youtube_requests'][0]['method']);
        $this->assertSame('second', $second['ai_requests'][0]['provider']);
        $this->assertSame(['parent', 'second-child'], $second['youtube_requests'][0]['job_path']);
        $this->assertSame(2, $telemetry->snapshotForJob('parent')['summary']['youtube_requests']);
        $this->assertSame(2, $telemetry->summary()['youtube_requests']);
        $this->assertSame(2, $telemetry->summary()['ai_requests']);
    }

    public function test_ingestion_health_command_reports_runtime_telemetry_and_daily_completeness(): void
    {
        Storage::fake('local');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:02:00', 'Asia/Taipei'));

        try {
            $this->createAiTables();
            $this->seedCompleteDailyRows('2026-05-24');

            Storage::disk('local')->put('ingestion-runs/20260525-100100-00000000-0000-4000-8000-000000000000.json', json_encode([
                'id' => '20260525-100100-00000000-0000-4000-8000-000000000000',
                'created_at' => '2026-05-25 10:01:00 Asia/Taipei',
                'request' => [
                    'source' => 'artisan',
                    'mode' => 'execute',
                ],
                'result' => [
                    'mode' => 'execute',
                    'summary' => [
                        'evaluated' => 2,
                        'due' => 2,
                        'executed' => 2,
                        'skipped' => 0,
                        'failed' => 0,
                    ],
                    'jobs' => [
                        [
                            'key' => 'youtube.live.poll',
                            'action' => 'executed:local-polling',
                            'executed' => true,
                            'failed' => false,
                            'runtime_ms' => 1200,
                            'started_at' => '2026-05-25 10:01:00 Asia/Taipei',
                            'finished_at' => '2026-05-25 10:01:01 Asia/Taipei',
                            'telemetry' => [
                                'summary' => ['youtube_requests' => 1, 'ai_requests' => 0],
                                'youtube_requests' => [
                                    [
                                        'method' => 'videos.list(liveStreamingDetails)',
                                        'latency_ms' => 640,
                                        'ok' => true,
                                        'status' => 200,
                                    ],
                                ],
                                'ai_requests' => [],
                            ],
                        ],
                        [
                            'key' => 'ai.daily',
                            'action' => 'executed:local-polling',
                            'executed' => true,
                            'failed' => false,
                            'runtime_ms' => 88000,
                            'started_at' => '2026-05-25 10:01:01 Asia/Taipei',
                            'finished_at' => '2026-05-25 10:02:29 Asia/Taipei',
                            'telemetry' => [
                                'summary' => ['youtube_requests' => 0, 'ai_requests' => 1],
                                'youtube_requests' => [],
                                'ai_requests' => [
                                    [
                                        'provider' => 'primary',
                                        'model' => 'qwen-test',
                                        'latency_ms' => 42000,
                                        'ok' => true,
                                        'status' => 200,
                                        'usage' => ['prompt_tokens' => 100, 'completion_tokens' => 20, 'total_tokens' => 120],
                                    ],
                                ],
                            ],
                        ],
                    ],
                    'youtube_quota_estimate' => ['estimated_units' => 1],
                ],
            ], JSON_THROW_ON_ERROR));

            $exitCode = Artisan::call('ingestion:health', [
                '--date' => '2026-05-24',
                '--json' => true,
            ]);

            $payload = json_decode(Artisan::output(), true, 512, JSON_THROW_ON_ERROR);

            $this->assertSame(0, $exitCode);
            $this->assertSame('2026-05-24', $payload['target_date']);
            $this->assertTrue($payload['scheduler']['active']);
            $this->assertSame(1, $payload['youtube']['requests']);
            $this->assertSame(640, $payload['youtube']['max_latency_ms']);
            $this->assertSame(1, $payload['ai']['requests']);
            $this->assertSame(42000, $payload['ai']['max_latency_ms']);
            $this->assertSame(1, $payload['ai']['usage']['successful_calls']);
            $this->assertSame(120, $payload['ai']['usage']['total_tokens']);
            $this->assertSame('ok', $payload['targets']['ai_daily']['status']);
            $this->assertSame(6, count($payload['targets']['ai_daily']['completed_conditions']));
            $this->assertSame(39, $payload['targets']['ai_daily']['channel_rows']);
            $this->assertSame('ok', $payload['targets']['mayor_person']['status']);
            $this->assertSame(3, count($payload['targets']['mayor_person']['completed_people']));

            $liveJob = collect($payload['processing']['jobs'])->firstWhere('key', 'youtube.live.poll');
            $this->assertSame(1200, $liveJob['last_runtime_ms']);
            $this->assertSame('executed:local-polling', $liveJob['last_action']);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_ingestion_health_degrades_target_completeness_when_database_is_unavailable(): void
    {
        Storage::fake('local');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:02:00', 'Asia/Taipei'));
        config()->set('database.default', 'mysql');
        config()->set('database.connections.mysql.host', '127.0.0.1');
        config()->set('database.connections.mysql.port', 1);
        config()->set('database.connections.mysql.database', 'youtube_board_missing');
        config()->set('database.connections.mysql.username', 'youtube_board_missing');
        config()->set('database.connections.mysql.password', 'not-a-secret');
        DB::purge('mysql');

        try {
            $exitCode = Artisan::call('ingestion:health', [
                '--date' => '2026-05-24',
                '--json' => true,
            ]);

            $payload = json_decode(Artisan::output(), true, 512, JSON_THROW_ON_ERROR);

            $this->assertSame(1, $exitCode);
            $this->assertSame('fail', $payload['youtube']['status']);
            $this->assertFalse($payload['youtube']['quota']['available']);
            $this->assertSame('unknown', $payload['targets']['ai_daily']['status']);
            $this->assertSame('database unavailable while checking AI daily completeness', $payload['targets']['ai_daily']['reason']);
            $this->assertSame('unknown', $payload['targets']['mayor_person']['status']);
            $this->assertSame('database unavailable while checking mayor person AI completeness', $payload['targets']['mayor_person']['reason']);
        } finally {
            DB::purge('mysql');
            CarbonImmutable::setTestNow();
        }
    }

    public function test_ingestion_health_treats_missing_youtube_resources_as_warning_not_outage(): void
    {
        Storage::fake('local');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:02:00', 'Asia/Taipei'));

        try {
            $this->createAiTables();
            $this->seedCompleteDailyRows('2026-05-24');

            Storage::disk('local')->put('ingestion-runs/20260525-100100-00000000-0000-4000-8000-000000000001.json', json_encode([
                'id' => '20260525-100100-00000000-0000-4000-8000-000000000001',
                'created_at' => '2026-05-25 10:01:00 Asia/Taipei',
                'request' => [
                    'source' => 'artisan',
                    'mode' => 'execute',
                ],
                'result' => [
                    'mode' => 'execute',
                    'summary' => [
                        'evaluated' => 1,
                        'due' => 1,
                        'executed' => 1,
                        'skipped' => 0,
                        'failed' => 0,
                    ],
                    'jobs' => [
                        [
                            'key' => 'youtube.channels.videos.general',
                            'action' => 'executed:local-polling',
                            'executed' => true,
                            'failed' => false,
                            'runtime_ms' => 900,
                            'started_at' => '2026-05-25 10:01:00 Asia/Taipei',
                            'finished_at' => '2026-05-25 10:01:01 Asia/Taipei',
                            'telemetry' => [
                                'summary' => ['youtube_requests' => 1, 'ai_requests' => 0],
                                'youtube_requests' => [
                                    [
                                        'method' => 'playlistItems.list',
                                        'latency_ms' => 280,
                                        'ok' => false,
                                        'status' => 404,
                                        'quota_or_rate_limit_retry' => false,
                                        'error' => 'The playlist identified with the request playlistId parameter cannot be found.',
                                    ],
                                ],
                                'ai_requests' => [],
                            ],
                        ],
                    ],
                    'youtube_quota_estimate' => ['estimated_units' => 1],
                ],
            ], JSON_THROW_ON_ERROR));

            $exitCode = Artisan::call('ingestion:health', [
                '--date' => '2026-05-24',
                '--json' => true,
            ]);

            $payload = json_decode(Artisan::output(), true, 512, JSON_THROW_ON_ERROR);

            $this->assertSame(0, $exitCode);
            $this->assertSame('warn', $payload['status']);
            $this->assertSame('warn', $payload['youtube']['status']);
            $this->assertSame(1, $payload['youtube']['failed_requests']);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_ingestion_health_excludes_invalid_ai_json_from_daily_completeness(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 10:00:00', 'Asia/Taipei'));
        $this->createAiTables();
        $this->seedCompleteDailyRows('2026-05-24');

        DB::table('urt_ai_date')
            ->where('condition_type', 'world')
            ->update(['result_json' => 'not-json']);
        DB::table('urt_channel_ai')
            ->where('u_id', AiDailyPreview::channelAiUids()[0])
            ->update(['result_json' => '{"events":[]}']);

        Artisan::call('ingestion:health', [
            '--date' => '2026-05-24',
            '--json' => true,
        ]);
        $payload = json_decode(Artisan::output(), true, 512, JSON_THROW_ON_ERROR);
        $target = $payload['targets']['ai_daily'];

        $this->assertSame('fail', $target['status']);
        $this->assertContains('world', $target['missing_conditions']);
        $this->assertSame(6, $target['condition_rows']);
        $this->assertSame(5, $target['valid_condition_rows']);
        $this->assertSame(1, $target['invalid_condition_rows']);
        $this->assertSame(39, $target['channel_rows_total']);
        $this->assertSame(38, $target['channel_rows']);
        $this->assertSame(1, $target['invalid_channel_rows']);
    }

    private function createAiTables(): void
    {
        Schema::create('urt_ai_date', function ($table): void {
            $table->id('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('data_type');
            $table->string('condition_type')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });

        Schema::create('urt_channel_ai', function ($table): void {
            $table->id('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('data_type');
            $table->dateTime('mtime')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('result_json');
        });

        Schema::create('urt_mayor_person_ai', function ($table): void {
            $table->id('pk');
            $table->string('city_key');
            $table->string('person');
            $table->date('the_date');
            $table->dateTime('mtime')->nullable();
            $table->integer('del_flag')->nullable();
        });
    }

    private function seedCompleteDailyRows(string $date): void
    {
        foreach (['all', 'green', 'blue', 'neutral', 'finance', 'world'] as $condition) {
            DB::table('urt_ai_date')->insert([
                'date_from' => $date.' 00:00:00',
                'date_to' => $date.' 23:59:59',
                'data_type' => 'oneday',
                'condition_type' => $condition,
                'mtime' => '2026-05-25 09:50:00',
                'del_flag' => null,
                'result_json' => '[{"標題":"每日事件","媒體事件":{"News Channel":["頻道事件"]}}]',
            ]);
        }

        foreach (AiDailyPreview::channelAiUids() as $uId) {
            DB::table('urt_channel_ai')->insert([
                'u_id' => $uId,
                'date_from' => $date.' 00:00:00',
                'date_to' => $date.' 23:59:59',
                'data_type' => 'oneday',
                'mtime' => '2026-05-25 09:45:00',
                'del_flag' => null,
                'result_json' => '[{"事件":"頻道事件","videoId":["video-1"]}]',
            ]);
        }

        foreach (['蔣萬安', '沈伯洋', '郭璽'] as $person) {
            DB::table('urt_mayor_person_ai')->insert([
                'city_key' => 'taipei',
                'person' => $person,
                'the_date' => $date,
                'mtime' => '2026-05-25 09:55:00',
                'del_flag' => null,
            ]);
        }
    }
}
