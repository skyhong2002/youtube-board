<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\AiProviderUsageSummary;
use App\Services\Ingestion\IngestionRunHistory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

class IngestionRunHistoryPersistenceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        Cache::flush();
        config()->set('ingestion.timezone', 'Asia/Taipei');
    }

    public function test_compact_provider_usage_uses_neutral_fallback_fields_and_reads_legacy_rows(): void
    {
        $summarizer = app(AiProviderUsageSummary::class);
        $summary = $summarizer->summarizeOutput(
            'provider_usage="primary_success=1 openai_success=2 primary_failed=3 openai_failed=4 openai_prompt_tokens=5 openai_completion_tokens=6 openai_total_tokens=11"',
        );

        $this->assertSame(2, data_get($summary, 'providers.fallback.successful_calls'));
        $this->assertSame(4, data_get($summary, 'providers.fallback.failed_attempts'));

        $compact = $summarizer->compactLine($summary);

        $this->assertStringContainsString('fallback_success=2', $compact);
        $this->assertStringContainsString('fallback_failed=4', $compact);
        $this->assertStringContainsString('fallback_total_tokens=11', $compact);
        $this->assertStringNotContainsString('openai_', $compact);
        $this->assertSame($summary, $summarizer->summarizeOutput('provider_usage="'.$compact.'"'));
    }

    public function test_record_persists_database_payload_and_only_normalizes_attempted_jobs(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 09:30:00', 'Asia/Taipei'));

        try {
            $record = app(IngestionRunHistory::class)->record(
                result: [
                    'mode' => 'execute',
                    'jobs' => [
                        [
                            'key' => 'ai.daily',
                            'action' => 'executed:local-polling',
                            'executed' => true,
                            'failed' => false,
                            'exit_code' => 0,
                            'started_at' => '2026-07-13 09:29:00 Asia/Taipei',
                            'finished_at' => '2026-07-13 09:30:00 Asia/Taipei',
                        ],
                        [
                            'key' => 'youtube.channels.videos.general',
                            'action' => 'failed:youtube-quota-ledger-unavailable',
                            'executed' => false,
                            'failed' => true,
                            'exit_code' => 1,
                        ],
                        [
                            'key' => 'reports.counts.build',
                            'action' => 'skip:not-due',
                            'executed' => false,
                            'failed' => false,
                            'exit_code' => null,
                        ],
                    ],
                ],
                request: ['source' => 'artisan', 'mode' => 'execute'],
            );

            $this->assertSame('database', $record['history_storage']);
            $this->assertSame('database:ingestion_runs/'.$record['id'], $record['path']);
            $this->assertSame([], Storage::disk('local')->files('ingestion-runs'));
            $this->assertDatabaseCount('ingestion_runs', 1);
            $this->assertDatabaseCount('ingestion_run_jobs', 2);
            $this->assertDatabaseHas('ingestion_run_jobs', [
                'run_id' => $record['id'],
                'job_key' => 'ai.daily',
                'attempted' => 1,
                'succeeded' => 1,
                'failed' => 0,
                'exit_code' => 0,
            ]);
            $this->assertDatabaseHas('ingestion_run_jobs', [
                'run_id' => $record['id'],
                'job_key' => 'youtube.channels.videos.general',
                'attempted' => 1,
                'succeeded' => 0,
                'failed' => 1,
                'exit_code' => 1,
            ]);
            $this->assertDatabaseMissing('ingestion_run_jobs', ['job_key' => 'reports.counts.build']);

            $stored = json_decode((string) DB::table('ingestion_runs')->value('payload_json'), true);
            $this->assertSame('database', $stored['history_storage']);
            $this->assertSame($record['path'], $stored['path']);

            $history = app(IngestionRunHistory::class);
            $this->assertSame('database', $history->latest(1)[0]['history_storage']);
            $this->assertSame($record['id'], $history->find($record['id'])['id']);
            $this->assertNull($history->find('../../.env'));
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_indexed_job_history_distinguishes_latest_attempt_from_latest_success(): void
    {
        $history = app(IngestionRunHistory::class);

        try {
            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 10:00:00', 'Asia/Taipei'));
            $history->record($this->jobResult([
                'executed' => true,
                'failed' => false,
                'exit_code' => 0,
                'action' => 'executed:local-polling',
                'started_at' => '2026-07-13 09:55:00 Asia/Taipei',
            ]), $this->artisanExecuteRequest());

            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 11:00:00', 'Asia/Taipei'));
            $history->record($this->jobResult([
                'executed' => false,
                'failed' => true,
                'exit_code' => 1,
                'action' => 'failed',
                'started_at' => '2026-07-13 10:55:00 Asia/Taipei',
            ]), $this->artisanExecuteRequest());

            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 12:00:00', 'Asia/Taipei'));
            $history->record($this->jobResult([
                'executed' => false,
                'failed' => true,
                'exit_code' => 1,
                'action' => 'failed:youtube-quota-ledger-unavailable',
                'started_at' => null,
            ]), $this->artisanExecuteRequest());

            $jobHistory = $history->latestJobHistory('ai.daily');

            $this->assertSame('2026-07-13 12:00:00', $jobHistory['latest_attempt_at']?->format('Y-m-d H:i:s'));
            $this->assertSame('blocked', $jobHistory['latest_attempt_status']);
            $this->assertSame('failed:youtube-quota-ledger-unavailable', $jobHistory['latest_attempt_action']);
            $this->assertSame(1, $jobHistory['latest_attempt_exit_code']);
            $this->assertSame('2026-07-13 10:00:00', $jobHistory['latest_success_at']?->format('Y-m-d H:i:s'));
            $this->assertSame(
                '2026-07-13 10:00:00',
                $history->latestSuccessfulJobRun(['missing.job', 'ai.daily'])?->format('Y-m-d H:i:s'),
            );
            $this->assertNull($history->latestSuccessfulJobRun([]));
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_daily_quota_and_ai_usage_windows_are_aggregated_from_database_payloads(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 10:00:00', 'America/Los_Angeles'));

        try {
            $history = app(IngestionRunHistory::class);
            $databaseRecord = $history->record([
                'mode' => 'execute',
                'jobs' => [[
                    'key' => 'youtube.tag_videos.backfill',
                    'executed' => true,
                    'failed' => false,
                    'exit_code' => 0,
                    'youtube_quota_estimate' => [
                        'estimated_units' => 6,
                        'basis' => 'test',
                    ],
                    'result' => [
                        'rows' => [[
                            'provider' => 'primary',
                            'provider_failures' => [],
                            'usage' => ['prompt_tokens' => 10, 'completion_tokens' => 4],
                            'ai_call_attempted' => true,
                            'skipped' => false,
                        ]],
                    ],
                ]],
            ], $this->artisanExecuteRequest());

            Storage::disk('local')->put('ingestion-runs/20260714-013000-00000000-0000-4000-8000-000000000099.json', json_encode([
                'id' => '20260714-013000-00000000-0000-4000-8000-000000000099',
                'created_at' => '2026-07-14 01:30:00 Asia/Taipei',
                'request' => $this->artisanExecuteRequest(),
                'result' => [
                    'mode' => 'execute',
                    'jobs' => [[
                        'key' => 'youtube.live.poll',
                        'executed' => true,
                        'failed' => false,
                        'exit_code' => 0,
                        'youtube_quota_estimate' => ['estimated_units' => 2, 'basis' => 'fallback test'],
                        'result' => [
                            'rows' => [[
                                'provider' => 'fallback',
                                'provider_failures' => [],
                                'usage' => ['prompt_tokens' => 5, 'completion_tokens' => 1],
                                'ai_call_attempted' => true,
                                'skipped' => false,
                            ]],
                        ],
                    ]],
                ],
            ], JSON_THROW_ON_ERROR));
            Storage::disk('local')->put('ingestion-runs/duplicate.json', json_encode([
                'id' => $databaseRecord['id'],
                'created_at' => $databaseRecord['created_at'],
                'request' => $this->artisanExecuteRequest(),
                'result' => [
                    'mode' => 'execute',
                    'youtube_quota_estimate' => ['estimated_units' => 999],
                ],
            ], JSON_THROW_ON_ERROR));

            $quota = $history->youtubeQuotaDailyEstimate(
                CarbonImmutable::parse('2026-07-13 11:00:00', 'America/Los_Angeles'),
            );
            $aiUsage = $history->aiProviderUsageDailyEstimate(
                CarbonImmutable::parse('2026-07-14 02:00:00', 'Asia/Taipei'),
            );

            $this->assertSame(8, $quota['estimated_units']);
            $this->assertSame(2, $quota['record_count']);
            $this->assertSame('youtube.tag_videos.backfill', $quota['job_breakdown'][0]['job']);
            $this->assertSame(2, $aiUsage['successful_calls']);
            $this->assertSame(15, $aiUsage['prompt_tokens']);
            $this->assertSame(5, $aiUsage['completion_tokens']);
            $this->assertSame(20, $aiUsage['total_tokens']);
            $this->assertSame(2, $aiUsage['record_count']);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_daily_history_windows_are_scanned_in_bounded_batches(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 12:00:00', 'America/Los_Angeles'));
        $start = CarbonImmutable::parse('2026-07-13 17:00:00', 'UTC');
        $rows = [];

        try {
            for ($offset = 0; $offset < 205; $offset++) {
                $timestamp = $start->addSeconds($offset);
                $id = $timestamp->format('Ymd-His').'-00000000-0000-4000-8000-'.str_pad((string) $offset, 12, '0', STR_PAD_LEFT);
                $payload = [
                    'id' => $id,
                    'created_at' => $timestamp->toDateTimeString().' UTC',
                    'request' => $this->artisanExecuteRequest(),
                    'result' => [
                        'mode' => 'execute',
                        'jobs' => [[
                            'key' => 'youtube.live.poll',
                            'executed' => true,
                            'failed' => false,
                            'youtube_quota_estimate' => ['estimated_units' => 1],
                            'telemetry' => $offset === 0
                                ? ['youtube_requests' => 1, 'ai_requests' => null]
                                : ['youtube_requests' => [], 'ai_requests' => []],
                        ]],
                    ],
                ];
                $rows[] = [
                    'id' => $id,
                    'recorded_at' => $timestamp->toDateTimeString(),
                    'request_source' => 'artisan',
                    'request_mode' => 'execute',
                    'result_mode' => 'execute',
                    'payload_json' => json_encode($payload, JSON_THROW_ON_ERROR),
                    'created_at' => $timestamp->toDateTimeString(),
                    'updated_at' => $timestamp->toDateTimeString(),
                ];

                if (count($rows) !== 50) {
                    continue;
                }

                DB::table('ingestion_runs')->insert($rows);
                $rows = [];
            }

            if ($rows !== []) {
                DB::table('ingestion_runs')->insert($rows);
            }

            $windowQueries = [];
            DB::listen(function (QueryExecuted $query) use (&$windowQueries): void {
                if (str_contains($query->sql, 'select "id", "payload_json" from "ingestion_runs"')) {
                    $windowQueries[] = $query->sql;
                }
            });

            $quota = app(IngestionRunHistory::class)->youtubeQuotaDailyEstimate(
                CarbonImmutable::parse('2026-07-13 12:00:00', 'America/Los_Angeles'),
            );

            $this->assertSame(205, $quota['estimated_units']);
            $this->assertSame(205, $quota['record_count']);
            $this->assertCount(3, $windowQueries);
            $this->assertTrue(collect($windowQueries)->every(
                fn (string $sql): bool => str_contains(strtolower($sql), 'limit 100'),
            ));

            $windowQueries = [];
            $response = $this->get('/ops/ingestion');

            $response->assertOk();
            $response->assertSee('estimated 205 / 10,000 units');
            $this->assertCount(6, $windowQueries);
            $this->assertTrue(collect($windowQueries)->every(
                fn (string $sql): bool => str_contains(strtolower($sql), 'limit 100'),
            ));
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_missing_history_schema_uses_legacy_file_fallback_for_writes_and_indexed_reads(): void
    {
        Schema::drop('ingestion_run_jobs');
        Schema::drop('ingestion_runs');
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 13:00:00', 'Asia/Taipei'));

        try {
            $history = app(IngestionRunHistory::class);
            $record = $history->record($this->jobResult([
                'executed' => true,
                'failed' => false,
                'exit_code' => 0,
                'action' => 'executed',
                'started_at' => '2026-07-13 12:59:00 Asia/Taipei',
            ]), $this->artisanExecuteRequest());

            $this->assertSame('file', $record['history_storage']);
            Storage::disk('local')->assertExists($record['path']);
            $this->assertSame('file', $history->latest(1)[0]['history_storage']);
            $this->assertSame('file', $history->find($record['id'])['history_storage']);
            $this->assertSame('success', $history->latestJobHistory('ai.daily')['latest_attempt_status']);
            $this->assertSame(
                '2026-07-13 13:00:00',
                $history->latestSuccessfulJobRun(['ai.daily'])?->format('Y-m-d H:i:s'),
            );
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_newer_file_fallback_supersedes_older_database_job_indexes(): void
    {
        $history = app(IngestionRunHistory::class);

        try {
            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 10:00:00', 'Asia/Taipei'));
            $history->record($this->jobResult([
                'executed' => true,
                'failed' => false,
                'exit_code' => 0,
                'action' => 'executed',
                'started_at' => '2026-07-13 09:59:00 Asia/Taipei',
            ]), $this->artisanExecuteRequest());

            $this->putFileRun(
                id: '20260713-110000-00000000-0000-4000-8000-000000000101',
                createdAt: '2026-07-13 11:00:00 Asia/Taipei',
                jobKey: 'ai.daily',
                job: [
                    'executed' => false,
                    'failed' => true,
                    'exit_code' => 1,
                    'action' => 'failed',
                    'started_at' => '2026-07-13 10:59:00 Asia/Taipei',
                ],
            );
            $this->putFileRun(
                id: '20260713-120000-00000000-0000-4000-8000-000000000102',
                createdAt: '2026-07-13 12:00:00 Asia/Taipei',
                jobKey: 'ai.hourly',
                job: [
                    'executed' => true,
                    'failed' => false,
                    'exit_code' => 0,
                    'action' => 'executed',
                    'started_at' => '2026-07-13 11:59:00 Asia/Taipei',
                ],
            );

            $jobHistory = $history->latestJobHistory('ai.daily');

            $this->assertSame('2026-07-13 11:00:00', $jobHistory['latest_attempt_at']?->format('Y-m-d H:i:s'));
            $this->assertSame('failed', $jobHistory['latest_attempt_status']);
            $this->assertSame('2026-07-13 10:00:00', $jobHistory['latest_success_at']?->format('Y-m-d H:i:s'));
            $this->assertSame(
                '2026-07-13 12:00:00',
                $history->latestSuccessfulJobRun(['ai.daily', 'ai.hourly'])?->format('Y-m-d H:i:s'),
            );
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_latest_and_scheduler_activity_include_newer_file_fallback_when_database_fills_limit(): void
    {
        $start = CarbonImmutable::parse('2026-07-13 00:00:00', 'UTC');

        for ($offset = 0; $offset < 30; $offset++) {
            $timestamp = $start->addMinutes($offset);
            $this->insertRun(
                $timestamp->format('Ymd-His').'-00000000-0000-4000-8000-'.str_pad((string) $offset, 12, '0', STR_PAD_LEFT),
                $timestamp->format('Y-m-d H:i:s'),
            );
        }

        $fallbackId = '20260713-120000-00000000-0000-4000-8000-000000000120';
        $this->putFileRun(
            id: $fallbackId,
            createdAt: '2026-07-13 12:00:00 Asia/Taipei',
            jobKey: 'ai.daily',
            job: [
                'executed' => true,
                'failed' => false,
                'exit_code' => 0,
                'action' => 'executed',
                'started_at' => '2026-07-13 11:59:00 Asia/Taipei',
            ],
        );

        $history = app(IngestionRunHistory::class);
        $latest = $history->latest(30);
        $activity = $history->externalSchedulerActivity(
            3,
            CarbonImmutable::parse('2026-07-13 12:01:00', 'Asia/Taipei'),
        );

        $this->assertCount(30, $latest);
        $this->assertSame($fallbackId, $latest[0]['id']);
        $this->assertSame('file', $latest[0]['history_storage']);
        $this->assertTrue($activity['active']);
        $this->assertSame($fallbackId, $activity['latest']['id']);
    }

    public function test_indexed_job_history_does_not_decode_files_older_than_database_watermarks(): void
    {
        $this->insertRun(
            '20260713-040000-00000000-0000-4000-8000-000000000040',
            '2026-07-13 04:00:00',
            true,
        );

        $newPath = 'ingestion-runs/20260713-130000-00000000-0000-4000-8000-000000000130.json';
        $oldPath = 'ingestion-runs/20260713-100000-00000000-0000-4000-8000-000000000100.json';
        $filesystem = Mockery::mock();
        $filesystem->shouldReceive('files')
            ->once()
            ->with('ingestion-runs')
            ->andReturn([$oldPath, $newPath]);
        $filesystem->shouldReceive('get')
            ->once()
            ->with($newPath)
            ->andReturn(json_encode([
                'id' => pathinfo($newPath, PATHINFO_FILENAME),
                'created_at' => '2026-07-13 13:00:00 Asia/Taipei',
                'request' => $this->artisanExecuteRequest(),
                'result' => [
                    'mode' => 'execute',
                    'jobs' => [[
                        'key' => 'ai.daily',
                        'executed' => true,
                        'failed' => false,
                        'exit_code' => 0,
                        'action' => 'executed:file-fallback',
                        'started_at' => '2026-07-13 12:59:00 Asia/Taipei',
                    ]],
                ],
            ], JSON_THROW_ON_ERROR));
        Storage::shouldReceive('disk')->with('local')->andReturn($filesystem);

        $history = app(IngestionRunHistory::class)->latestJobHistory('ai.daily');

        $this->assertSame('2026-07-13 13:00:00', $history['latest_attempt_at']?->format('Y-m-d H:i:s'));
        $this->assertSame('2026-07-13 13:00:00', $history['latest_success_at']?->format('Y-m-d H:i:s'));
        $this->assertSame('executed:file-fallback', $history['latest_attempt_action']);
    }

    public function test_latest_successful_job_run_stops_after_newest_matching_file(): void
    {
        $newPath = 'ingestion-runs/20260713-130000-00000000-0000-4000-8000-000000000130.json';
        $oldPath = 'ingestion-runs/20260713-100000-00000000-0000-4000-8000-000000000100.json';
        $filesystem = Mockery::mock();
        $filesystem->shouldReceive('files')
            ->once()
            ->with('ingestion-runs')
            ->andReturn([$oldPath, $newPath]);
        $filesystem->shouldReceive('get')
            ->once()
            ->with($newPath)
            ->andReturn(json_encode([
                'id' => pathinfo($newPath, PATHINFO_FILENAME),
                'created_at' => '2026-07-13 13:00:00 Asia/Taipei',
                'request' => $this->artisanExecuteRequest(),
                'result' => [
                    'mode' => 'execute',
                    'jobs' => [[
                        'key' => 'ai.daily',
                        'executed' => true,
                        'failed' => false,
                        'exit_code' => 0,
                    ]],
                ],
            ], JSON_THROW_ON_ERROR));
        Storage::shouldReceive('disk')->with('local')->andReturn($filesystem);

        $latest = app(IngestionRunHistory::class)->latestSuccessfulJobRun(['ai.daily']);

        $this->assertSame('2026-07-13 13:00:00', $latest?->format('Y-m-d H:i:s'));
    }

    public function test_database_write_failure_logs_a_sanitized_reason_and_falls_back_to_file(): void
    {
        DB::statement(<<<'SQL'
            CREATE TRIGGER fail_ingestion_history
            BEFORE INSERT ON ingestion_runs
            BEGIN
                SELECT RAISE(FAIL, 'token=history-super-secret');
            END
            SQL);
        Log::spy();

        $record = app(IngestionRunHistory::class)->record(
            ['mode' => 'execute', 'jobs' => []],
            $this->artisanExecuteRequest(),
        );

        $this->assertSame('file', $record['history_storage']);
        $this->assertDatabaseCount('ingestion_runs', 0);
        Storage::disk('local')->assertExists($record['path']);
        Log::shouldHaveReceived('warning')
            ->with(
                'Database ingestion run history unavailable; using local file fallback.',
                Mockery::on(function (array $context): bool {
                    $encoded = json_encode($context, JSON_THROW_ON_ERROR);

                    return ($context['operation'] ?? null) === 'write'
                        && str_contains($encoded, 'token=<redacted>')
                        && ! str_contains($encoded, 'history-super-secret');
                }),
            )
            ->once();
    }

    public function test_hourly_pruning_applies_retention_and_record_cap_with_cascades(): void
    {
        config()->set('ingestion.run_history.retention_days', 14);
        config()->set('ingestion.run_history.max_records', 2);

        $this->insertRun(
            '20260601-000000-00000000-0000-4000-8000-000000000001',
            '2026-06-01 00:00:00',
            true,
        );
        $this->insertRun(
            '20260710-000000-00000000-0000-4000-8000-000000000002',
            '2026-07-10 00:00:00',
            true,
        );
        $this->insertRun(
            '20260711-000000-00000000-0000-4000-8000-000000000003',
            '2026-07-11 00:00:00',
        );
        $this->insertRun(
            '20260712-000000-00000000-0000-4000-8000-000000000004',
            '2026-07-12 00:00:00',
        );

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 14:00:00', 'UTC'));

        try {
            $record = app(IngestionRunHistory::class)->record(
                ['mode' => 'execute', 'jobs' => []],
                $this->artisanExecuteRequest(),
            );

            $this->assertDatabaseCount('ingestion_runs', 2);
            $this->assertDatabaseHas('ingestion_runs', ['id' => $record['id']]);
            $this->assertDatabaseHas('ingestion_runs', [
                'id' => '20260712-000000-00000000-0000-4000-8000-000000000004',
            ]);
            $this->assertDatabaseMissing('ingestion_runs', [
                'id' => '20260601-000000-00000000-0000-4000-8000-000000000001',
            ]);
            $this->assertDatabaseMissing('ingestion_runs', [
                'id' => '20260710-000000-00000000-0000-4000-8000-000000000002',
            ]);
            $this->assertDatabaseCount('ingestion_run_jobs', 0);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_record_cap_is_enforced_when_age_cleanup_cache_gate_fails(): void
    {
        config()->set('ingestion.run_history.retention_days', 3650);
        config()->set('ingestion.run_history.max_records', 2);
        $oldestId = '20260711-000000-00000000-0000-4000-8000-000000000001';
        $newestSeedId = '20260712-000000-00000000-0000-4000-8000-000000000002';
        $this->insertRun($oldestId, '2026-07-11 00:00:00');
        $this->insertRun($newestSeedId, '2026-07-12 00:00:00');
        Log::spy();
        Cache::shouldReceive('add')
            ->once()
            ->andThrow(new \RuntimeException('token=cache-gate-secret'));
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 14:00:00', 'UTC'));

        try {
            $record = app(IngestionRunHistory::class)->record(
                ['mode' => 'execute', 'jobs' => []],
                $this->artisanExecuteRequest(),
            );

            $this->assertSame('database', $record['history_storage']);
            $this->assertDatabaseCount('ingestion_runs', 2);
            $this->assertDatabaseMissing('ingestion_runs', ['id' => $oldestId]);
            $this->assertDatabaseHas('ingestion_runs', ['id' => $newestSeedId]);
            $this->assertDatabaseHas('ingestion_runs', ['id' => $record['id']]);
            Log::shouldHaveReceived('warning')
                ->with(
                    'Ingestion run history age cleanup gate failed; enforcing record cap only.',
                    Mockery::on(function (array $context): bool {
                        $encoded = json_encode($context, JSON_THROW_ON_ERROR);

                        return str_contains($encoded, 'token=<redacted>')
                            && ! str_contains($encoded, 'cache-gate-secret');
                    }),
                )
                ->once();
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_pruning_enforces_record_cap_across_multiple_delete_batches(): void
    {
        config()->set('ingestion.run_history.retention_days', 3650);
        config()->set('ingestion.run_history.max_records', 2);
        $start = CarbonImmutable::parse('2026-07-12 00:00:00', 'UTC');
        $rows = [];
        $lastSeedId = null;

        for ($offset = 0; $offset < 2105; $offset++) {
            $timestamp = $start->addSeconds($offset);
            $lastSeedId = $timestamp->format('Ymd-His').'-00000000-0000-4000-8000-'.str_pad((string) $offset, 12, '0', STR_PAD_LEFT);
            $payload = [
                'id' => $lastSeedId,
                'created_at' => $timestamp->toDateTimeString().' UTC',
                'request' => $this->artisanExecuteRequest(),
                'result' => ['mode' => 'execute', 'jobs' => []],
            ];
            $rows[] = [
                'id' => $lastSeedId,
                'recorded_at' => $timestamp->toDateTimeString(),
                'request_source' => 'artisan',
                'request_mode' => 'execute',
                'result_mode' => 'execute',
                'payload_json' => json_encode($payload, JSON_THROW_ON_ERROR),
                'created_at' => $timestamp->toDateTimeString(),
                'updated_at' => $timestamp->toDateTimeString(),
            ];

            if (count($rows) === 50) {
                DB::table('ingestion_runs')->insert($rows);
                $rows = [];
            }
        }

        if ($rows !== []) {
            DB::table('ingestion_runs')->insert($rows);
        }

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 14:00:00', 'UTC'));

        try {
            $record = app(IngestionRunHistory::class)->record(
                ['mode' => 'execute', 'jobs' => []],
                $this->artisanExecuteRequest(),
            );

            $this->assertDatabaseCount('ingestion_runs', 2);
            $this->assertDatabaseHas('ingestion_runs', ['id' => $lastSeedId]);
            $this->assertDatabaseHas('ingestion_runs', ['id' => $record['id']]);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_file_fallback_applies_retention_and_record_cap(): void
    {
        Schema::drop('ingestion_run_jobs');
        Schema::drop('ingestion_runs');
        config()->set('ingestion.run_history.retention_days', 2);
        config()->set('ingestion.run_history.max_records', 2);
        $expiredPath = 'ingestion-runs/20260701-120000-00000000-0000-4000-8000-000000000001.json';
        Storage::disk('local')->put($expiredPath, '{}');
        $history = app(IngestionRunHistory::class);

        try {
            foreach (['10:00:00', '11:00:00', '12:00:00'] as $time) {
                CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 '.$time, 'Asia/Taipei'));
                $history->record(
                    ['mode' => 'execute', 'jobs' => []],
                    $this->artisanExecuteRequest(),
                );
            }

            $paths = Storage::disk('local')->files('ingestion-runs');
            sort($paths);

            $this->assertCount(2, $paths);
            $this->assertFalse(Storage::disk('local')->exists($expiredPath));
            $this->assertStringStartsWith('ingestion-runs/20260713-110000-', $paths[0]);
            $this->assertStringStartsWith('ingestion-runs/20260713-120000-', $paths[1]);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    /**
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    private function jobResult(array $job): array
    {
        return [
            'mode' => 'execute',
            'jobs' => [[
                'key' => 'ai.daily',
                'finished_at' => '2026-07-13 12:00:00 Asia/Taipei',
            ] + $job],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function artisanExecuteRequest(): array
    {
        return ['source' => 'artisan', 'mode' => 'execute'];
    }

    private function insertRun(string $id, string $recordedAt, bool $withJob = false): void
    {
        $payload = [
            'id' => $id,
            'path' => 'database:ingestion_runs/'.$id,
            'history_storage' => 'database',
            'created_at' => $recordedAt.' UTC',
            'request' => $this->artisanExecuteRequest(),
            'result' => ['mode' => 'execute', 'jobs' => []],
        ];

        DB::table('ingestion_runs')->insert([
            'id' => $id,
            'recorded_at' => $recordedAt,
            'request_source' => 'artisan',
            'request_mode' => 'execute',
            'result_mode' => 'execute',
            'payload_json' => json_encode($payload, JSON_THROW_ON_ERROR),
            'created_at' => $recordedAt,
            'updated_at' => $recordedAt,
        ]);

        if ($withJob) {
            DB::table('ingestion_run_jobs')->insert([
                'run_id' => $id,
                'job_key' => 'ai.daily',
                'recorded_at' => $recordedAt,
                'attempted' => true,
                'succeeded' => true,
                'failed' => false,
                'action' => 'executed',
                'exit_code' => 0,
                'started_at' => $recordedAt.' UTC',
                'finished_at' => $recordedAt.' UTC',
                'created_at' => $recordedAt,
                'updated_at' => $recordedAt,
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function putFileRun(string $id, string $createdAt, string $jobKey, array $job): void
    {
        Storage::disk('local')->put('ingestion-runs/'.$id.'.json', json_encode([
            'id' => $id,
            'created_at' => $createdAt,
            'request' => $this->artisanExecuteRequest(),
            'result' => [
                'mode' => 'execute',
                'jobs' => [['key' => $jobKey] + $job],
            ],
        ], JSON_THROW_ON_ERROR));
    }
}
