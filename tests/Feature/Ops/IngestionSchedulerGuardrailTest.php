<?php

namespace Tests\Feature\Ops;

use App\Console\GuardedClosureCommand;
use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\IngestionCommandLock;
use App\Services\Ingestion\IngestionHealthCheck;
use App\Services\Ingestion\IngestionJobRegistry;
use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\IngestionTelemetry;
use App\Services\Ingestion\YoutubeDataApiClient;
use App\Services\Ingestion\YoutubeQuotaBudgetLedger;
use App\Services\Ingestion\YoutubeQuotaEstimator;
use App\Services\Ingestion\YoutubeQuotaReservationContext;
use App\Services\Ingestion\YoutubeQuotaWindowException;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Console\ClosureCommand;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class IngestionSchedulerGuardrailTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.production_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['*']);
        config()->set('ingestion.job_lock_seconds', 600);
        config()->set('ingestion.lock_store', null);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        config()->set('services.youtube.api_key', null);
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 1);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_empty_scheduled_write_allowlist_fails_closed(): void
    {
        config()->set('ingestion.scheduled_write_allowlist', []);
        $registry = app(IngestionJobRegistry::class);
        $job = $registry->find('youtube.tag_videos.backfill');

        $this->assertNotNull($job);
        $this->assertSame([
            'allowed' => false,
            'blocks' => ['Scheduled writes are disabled by INGESTION_SCHEDULED_WRITE_ALLOWLIST.'],
            'scope' => 'off',
        ], $registry->scheduledWriteProfile($job));
    }

    public function test_every_execute_capable_command_exposes_an_explicit_dry_run_override(): void
    {
        $writeCommands = collect(Artisan::all())
            ->filter(fn ($command): bool => $command->getDefinition()->hasOption('execute'))
            ->filter(fn ($command): bool => $command instanceof ClosureCommand);

        $this->assertNotEmpty($writeCommands);

        foreach ($writeCommands as $name => $command) {
            $this->assertTrue(
                $command->getDefinition()->hasOption('dry-run'),
                "{$name} must define --dry-run so it can override --execute.",
            );
        }
    }

    public function test_every_repository_write_closure_has_exactly_one_lock_owner(): void
    {
        $quotaOwned = [
            'youtube:channels:stats',
            'youtube:channels:videos',
            'youtube:tvbs:videos',
            'youtube:tag-videos:backfill',
            'youtube:live:poll',
            'youtube:tvbs:live:poll',
            'youtube:videos:duration',
            'youtube:videos:stats',
            'youtube:comments:fetch',
        ];
        $lock = app(IngestionCommandLock::class);
        $writeCommands = collect(Artisan::all())
            ->filter(fn ($command): bool => $command instanceof ClosureCommand)
            ->filter(fn ($command): bool => $command->getDefinition()->hasOption('execute'));

        foreach ($writeCommands as $name => $command) {
            if ($name === 'ingestion:run' || in_array($name, $quotaOwned, true)) {
                $this->assertNotInstanceOf(GuardedClosureCommand::class, $command, $name);

                continue;
            }

            $this->assertInstanceOf(GuardedClosureCommand::class, $command, $name);
            $this->assertNotNull($lock->jobKeyForCommand($name), $name);
        }
    }

    public function test_direct_and_scheduler_commands_share_lock_while_dry_run_bypasses_it_and_logs_are_sanitized(): void
    {
        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
        });
        Log::spy();
        $jobKey = 'reports.counts.build';
        $lockName = IngestionCommandLock::name($jobKey);
        $lock = Cache::lock($lockName, 600);
        $this->assertTrue($lock->get());

        try {
            $directExit = Artisan::call('reports:counts:build', [
                '--execute' => true,
                '--json' => true,
            ]);
            $blocked = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);
            $dryRunExit = Artisan::call('reports:counts:build', [
                '--execute' => true,
                '--dry-run' => true,
                '--json' => true,
            ]);
            $dryRunOutput = trim(Artisan::output());
            $scheduled = app(IngestionSchedulerRunner::class)->run(
                at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
                execute: true,
                jobKey: $jobKey,
            );
        } finally {
            $lock->release();
        }

        $this->assertSame(1, $directExit);
        $this->assertSame('command_locked', $blocked['blocked_reason']);
        $this->assertSame($jobKey, $blocked['job_key']);
        $this->assertSame($lockName, $blocked['lock']['name']);
        $this->assertSame(0, $dryRunExit, $dryRunOutput);
        $this->assertStringContainsString('ingestion-preview', $dryRunOutput);
        $this->assertStringNotContainsString('command_locked', $dryRunOutput);
        $this->assertSame('skip:job-locked', $scheduled['jobs'][0]['action']);

        $completed = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: $jobKey,
        );

        $this->assertSame(1, $completed['summary']['executed']);
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(fn (string $message, array $context): bool => $message === 'Ingestion command execution blocked.'
                && $context === [
                    'command' => 'reports:counts:build',
                    'job_key' => $jobKey,
                    'status' => 'locked',
                    'exit_code' => 1,
                    'runtime_ms' => 0,
                ]);
        Log::shouldHaveReceived('info')
            ->withArgs(fn (string $message, array $context): bool => $message === 'Ingestion command execution completed.'
                && $context['command'] === 'reports:counts:build'
                && $context['job_key'] === $jobKey
                && $context['status'] === 'completed'
                && $context['exit_code'] === 0
                && is_int($context['runtime_ms'])
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'secret'))
            ->once();
    }

    public function test_runner_skips_job_when_per_job_lock_is_already_held(): void
    {
        config()->set('legacy.ground_truth_path', storage_path('framework/testing-missing-legacy'));
        $lockName = 'ingestion:job:'.sha1('reports.live.static');
        $lock = Cache::lock($lockName, 600);
        $this->assertTrue($lock->get());

        try {
            $result = app(IngestionSchedulerRunner::class)->run(
                at: CarbonImmutable::parse('2026-05-25 00:19:00', 'Asia/Taipei'),
                execute: true,
                jobKey: 'reports.live.static',
            );
        } finally {
            $lock->release();
        }

        $this->assertSame('skip:job-locked', $result['jobs'][0]['action']);
        $this->assertSame('another runner currently holds the per-job execution lock', $result['jobs'][0]['skip_reason']);
        $this->assertFalse($result['jobs'][0]['lock']['acquired']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
    }

    public function test_runner_releases_per_job_lock_after_execution(): void
    {
        config()->set('legacy.ground_truth_path', storage_path('framework/testing-missing-legacy'));
        $runner = app(IngestionSchedulerRunner::class);
        $at = CarbonImmutable::parse('2026-05-25 00:19:00', 'Asia/Taipei');

        $first = $runner->run(at: $at, execute: true, jobKey: 'reports.live.static');
        $second = $runner->run(at: $at, execute: true, jobKey: 'reports.live.static');

        $this->assertSame('executed', $first['jobs'][0]['action']);
        $this->assertSame('executed', $second['jobs'][0]['action']);
        $this->assertTrue($first['jobs'][0]['lock']['acquired']);
        $this->assertTrue($second['jobs'][0]['lock']['acquired']);
    }

    public function test_missing_quota_ledger_does_not_mark_a_non_youtube_job_as_failed(): void
    {
        config()->set('legacy.ground_truth_path', storage_path('framework/testing-missing-legacy'));
        Schema::drop('ingestion_youtube_quota_daily');

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:19:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.live.static',
        );
        $job = $result['jobs'][0];

        $this->assertSame('executed', $job['action']);
        $this->assertTrue($job['executed']);
        $this->assertFalse($job['failed']);
        $this->assertArrayNotHasKey('quota_accounting_failed', $job);
        $this->assertSame(0, $job['youtube_quota_estimate']['estimated_units']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
    }

    public function test_composite_nested_quota_denial_is_recorded_without_double_charge(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:00:00', 'Asia/Taipei'));
        config()->set('ingestion.scheduled_write_allowlist', ['ai.daily']);
        config()->set('services.youtube.api_key', 'test-youtube-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        DB::table('ingestion_youtube_quota_daily')->insert([
            'provider' => 'youtube_data_api_v3',
            'quota_date' => '2026-05-25',
            'consumed_units' => 8000,
            'reserved_units' => 0,
            'created_at' => '2026-05-25 00:00:00',
            'updated_at' => '2026-05-25 00:00:00',
        ]);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('ingestion:run', [
            '--execute' => true,
            '--record' => true,
            '--at' => '2026-05-26 00:00:00',
            '--job' => 'ai.daily',
        ]);

        $this->assertSame(0, $exitCode);
        $stored = json_decode((string) DB::table('ingestion_runs')->value('payload_json'), true, 512, JSON_THROW_ON_ERROR);
        $job = $stored['result']['jobs'][0];
        $jobBudget = $job['youtube_quota_budget'];
        $runBudget = $stored['result']['youtube_quota_budget'];

        $this->assertTrue($job['failed']);
        $this->assertSame('youtube.tag_videos.backfill', $jobBudget['direct_job_key']);
        $this->assertSame('direct_command', $jobBudget['accounting_owner']);
        $this->assertSame('quota_budget_exceeded', $jobBudget['reason']);
        $this->assertSame(2000, $jobBudget['planned_units']);
        $this->assertSame(0, $jobBudget['actual_units']);
        $this->assertSame(8000, $jobBudget['consumed_units']);
        $this->assertSame(0, $jobBudget['reserved_units']);
        $this->assertSame(8000, $jobBudget['projected_units']);
        $this->assertSame(1000, $jobBudget['remaining_units']);
        $this->assertFalse($jobBudget['reservation_active']);
        $this->assertArrayNotHasKey('lock', $jobBudget);
        $this->assertArrayNotHasKey('_direct_lock', $jobBudget);
        $this->assertSame('quota_budget_exceeded', $runBudget['reason']);
        $this->assertSame(8000, $runBudget['consumed_units']);
        $this->assertSame(0, $runBudget['reserved_units']);
        $this->assertSame(1000, $runBudget['remaining_units']);
        $this->assertDatabaseHas('ingestion_youtube_quota_daily', [
            'consumed_units' => 8000,
            'reserved_units' => 0,
        ]);
        $this->assertStringNotContainsString('test-youtube-key', json_encode($stored, JSON_THROW_ON_ERROR));
        Http::assertNothingSent();

        $manualExitCode = Artisan::call('ai:daily:pipeline', [
            '--execute' => true,
            '--date' => '2026-05-25',
            '--json' => true,
        ]);
        $manual = json_decode(trim(Artisan::output()), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(1, $manualExitCode);
        $this->assertSame('quota_budget_exceeded', $manual['source_refresh']['failure_reason']);
        $this->assertSame('quota_budget_exceeded', $manual['source_refresh']['youtube_quota_budget']['reason']);
        $this->assertSame(8000, $manual['source_refresh']['youtube_quota_budget']['consumed_units']);
        $this->assertSame(0, $manual['source_refresh']['youtube_quota_budget']['reserved_units']);
        $this->assertSame(1000, $manual['source_refresh']['youtube_quota_budget']['remaining_units']);
        $this->assertArrayNotHasKey('_direct_lock', $manual['source_refresh']['youtube_quota_budget']);
        Http::assertNothingSent();
    }

    public function test_composite_missing_youtube_credential_keeps_the_original_failure_action(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-26 00:00:00', 'Asia/Taipei'));
        config()->set('ingestion.scheduled_write_allowlist', ['ai.daily']);
        config()->set('services.youtube.api_key', null);
        config()->set('services.youtube.api_keys', null);
        Http::preventStrayRequests();

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'ai.daily',
        );
        $job = $result['jobs'][0];

        $this->assertSame('failed', $job['action']);
        $this->assertTrue($job['failed']);
        $this->assertSame('youtube_api_key_not_configured', $job['youtube_quota_budget']['reason']);
        $this->assertSame('youtube.tag_videos.backfill', $job['youtube_quota_budget']['direct_job_key']);
        $this->assertArrayNotHasKey('quota_accounting_failed', $job);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 0, 'failed' => 1], $result['summary']);
        Http::assertNothingSent();
    }

    public function test_composite_nested_settlement_failure_remains_an_operational_failure(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'America/Los_Angeles'));
        config()->set('services.youtube.api_key', 'test-key');
        Artisan::command('testing:nested-youtube-drop-ledger', function (): int {
            $run = app(DirectYoutubeQuotaGuard::class)->run(
                jobKey: 'youtube.live.poll',
                effectiveCommand: 'youtube:live:poll --execute --limit=1',
                callback: function (): array {
                    app(IngestionTelemetry::class)->recordYoutubeRequest([
                        'method' => 'videos.list',
                        'estimated_quota_units' => 1,
                        'ok' => true,
                        'status' => 200,
                        'latency_ms' => 5,
                    ]);
                    Schema::drop('ingestion_youtube_quota_daily');

                    return ['exit_code' => 0];
                },
            );

            return (int) data_get($run, 'payload.exit_code', 1);
        });
        config()->set('ingestion.jobs', [[
            'key' => 'testing.nested_youtube',
            'group' => 'Testing',
            'priority' => 1,
            'modern_command' => 'testing:nested-youtube-drop-ledger',
            'scheduled_execute_command' => 'testing:nested-youtube-drop-ledger',
            'legacy_command' => 'test only',
            'schedule' => '* * * * *',
            'cadence' => 'test only',
            'status' => 'active',
            'external_dependency' => 'YouTube Data API',
            'writes' => ['test only'],
            'notes' => 'test only',
        ]]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'testing.nested_youtube',
        );
        $job = $result['jobs'][0];
        $budget = $job['youtube_quota_budget'];

        $this->assertSame('executed:quota-accounting-failed', $job['action']);
        $this->assertTrue($job['failed']);
        $this->assertTrue($job['quota_accounting_failed']);
        $this->assertSame('youtube.live.poll', $budget['direct_job_key']);
        $this->assertSame('direct_command', $budget['accounting_owner']);
        $this->assertSame(1, $budget['actual_units']);
        $this->assertTrue($budget['reservation_active']);
        $this->assertTrue($budget['accounting_failed']);
        $this->assertFalse($budget['available']);
        $this->assertSame('quota_ledger_settlement_failed', $budget['settlement_reason']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 0, 'failed' => 1], $result['summary']);
        $this->assertFalse($result['youtube_quota_budget']['available']);
    }

    public function test_runner_skips_scheduled_youtube_job_before_it_exceeds_daily_budget(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 03:17:00', 'Asia/Taipei'));
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);
        config()->set('ingestion.youtube_daily_quota_budget', 9000);
        Http::preventStrayRequests();

        DB::table('ingestion_youtube_quota_daily')->insert([
            'provider' => 'youtube_data_api_v3',
            'quota_date' => '2026-05-24',
            'consumed_units' => 8000,
            'reserved_units' => 0,
            'created_at' => '2026-05-24 00:00:00',
            'updated_at' => '2026-05-24 00:00:00',
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );

        $job = $result['jobs'][0];
        $this->assertSame('skip:youtube-quota-budget', $job['action']);
        $this->assertSame(8000, $job['youtube_quota_budget']['history_estimated_units']);
        $this->assertSame(4000, $job['youtube_quota_budget']['planned_units']);
        $this->assertSame(12000, $job['youtube_quota_budget']['projected_units']);
        $this->assertSame(9000, $job['youtube_quota_budget']['budget_units']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        Http::assertNothingSent();
    }

    public function test_daily_quota_ledger_reservations_are_atomic_and_settle_to_actual_usage(): void
    {
        $at = CarbonImmutable::parse('2026-05-25 00:17:00', 'Asia/Taipei');
        $ledger = app(YoutubeQuotaBudgetLedger::class);

        $first = $ledger->reserve(6000, 9000, $at);
        $blocked = $ledger->reserve(4000, 9000, $at);
        $settled = $ledger->settle(6000, 12, 9000, $at);
        $after = $ledger->reserve(8989, 9000, $at);

        $this->assertTrue($first['allowed']);
        $this->assertSame(6000, $first['state']['reserved_units']);
        $this->assertFalse($blocked['allowed']);
        $this->assertSame('quota_budget_exceeded', $blocked['reason']);
        $this->assertSame(12, $settled['consumed_units']);
        $this->assertSame(0, $settled['reserved_units']);
        $this->assertFalse($after['allowed']);
        $this->assertSame(12, DB::table('ingestion_youtube_quota_daily')->value('consumed_units'));
        $this->assertSame(0, DB::table('ingestion_youtube_quota_daily')->value('reserved_units'));
    }

    public function test_runner_uses_real_quota_day_instead_of_schedule_evaluation_time(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 12:00:00', 'America/Los_Angeles'));
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);
        DB::table('ingestion_youtube_quota_daily')->insert([
            'provider' => 'youtube_data_api_v3',
            'quota_date' => '2026-07-13',
            'consumed_units' => 8000,
            'reserved_units' => 0,
            'created_at' => '2026-07-13 00:00:00',
            'updated_at' => '2026-07-13 00:00:00',
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:17:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );

        $this->assertSame('skip:youtube-quota-budget', $result['jobs'][0]['action']);
        $this->assertSame('2026-07-13', $result['youtube_quota_budget']['quota_date']);
        $this->assertSame(8000, $result['jobs'][0]['youtube_quota_budget']['history_estimated_units']);
    }

    public function test_missing_quota_ledger_fails_closed_and_health_is_not_ok(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 03:17:00', 'Asia/Taipei'));
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);
        Schema::drop('ingestion_youtube_quota_daily');
        Http::preventStrayRequests();

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );
        $health = app(IngestionHealthCheck::class)->check(now: CarbonImmutable::now('Asia/Taipei'));

        $this->assertSame('failed:youtube-quota-ledger-unavailable', $result['jobs'][0]['action']);
        $this->assertTrue($result['jobs'][0]['failed']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 0, 'failed' => 1], $result['summary']);
        $this->assertSame('fail', $health['youtube']['status']);
        $this->assertFalse($health['youtube']['quota']['available']);
        Http::assertNothingSent();
    }

    public function test_zero_quota_budget_fails_closed_for_scheduled_youtube_jobs_and_health(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 03:17:00', 'Asia/Taipei'));
        config()->set('ingestion.scheduled_write_allowlist', ['youtube.tag_videos.backfill']);
        config()->set('ingestion.youtube_daily_quota_budget', 0);
        Http::preventStrayRequests();

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.tag_videos.backfill',
        );
        $health = app(IngestionHealthCheck::class)->check(now: CarbonImmutable::now('Asia/Taipei'));

        $this->assertSame('failed:youtube-quota-ledger-unavailable', $result['jobs'][0]['action']);
        $this->assertTrue($result['jobs'][0]['failed']);
        $this->assertSame('quota_budget_not_configured', $result['jobs'][0]['youtube_quota_budget']['reason']);
        $this->assertSame('fail', $health['youtube']['status']);
        $this->assertFalse($health['youtube']['quota']['available']);
        $this->assertSame('quota_budget_not_configured', $health['youtube']['quota']['reason']);
        Http::assertNothingSent();
    }

    public function test_all_direct_youtube_commands_fail_closed_before_ingestion_when_quota_is_unavailable(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('ingestion.youtube_daily_quota_budget', 0);
        Http::preventStrayRequests();
        $commands = [
            ['youtube:channels:stats', []],
            ['youtube:channels:videos', []],
            ['youtube:tvbs:videos', []],
            ['youtube:tag-videos:backfill', ['--tagid' => 102]],
            ['youtube:live:poll', []],
            ['youtube:tvbs:live:poll', []],
            ['youtube:videos:duration', []],
            ['youtube:videos:stats', []],
            ['youtube:comments:fetch', []],
        ];

        foreach ($commands as [$command, $arguments]) {
            $exitCode = Artisan::call($command, $arguments + ['--execute' => true, '--json' => true]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode, $command);
            $this->assertSame('youtube_quota_accounting_unavailable', $payload['blocked_reason'], $command);
            $this->assertSame('quota_budget_not_configured', $payload['youtube_quota_budget']['reason'], $command);
            $this->assertTrue($payload['youtube_quota_budget']['lock']['released_after_denial'], $command);
        }

        Http::assertNothingSent();
    }

    public function test_direct_youtube_guard_logs_blocked_execution_without_command_or_secrets(): void
    {
        Log::spy();
        config()->set('services.youtube.api_key', null);

        $result = app(DirectYoutubeQuotaGuard::class)->run(
            jobKey: 'youtube.live.poll',
            effectiveCommand: 'youtube:live:poll --execute --videoId=private-option',
            callback: fn (): array => ['exit_code' => 0],
        );

        $this->assertFalse($result['allowed']);
        Log::shouldHaveReceived('warning')
            ->once()
            ->with('Direct YouTube ingestion execution blocked.', \Mockery::on(function (array $context): bool {
                $this->assertSame('youtube.live.poll', $context['job_key']);
                $this->assertSame('blocked', $context['status']);
                $this->assertSame('youtube_api_key_not_configured', $context['reason']);
                $this->assertSame(1, $context['exit_code']);
                $this->assertArrayNotHasKey('effective_command', $context);
                $this->assertArrayNotHasKey('output', $context);

                return ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'private-option');
            }));
    }

    public function test_direct_youtube_guard_logs_sanitized_completion_summary(): void
    {
        Log::spy();
        config()->set('services.youtube.api_key', 'youtube-super-secret');

        $result = app(DirectYoutubeQuotaGuard::class)->run(
            jobKey: 'youtube.live.poll',
            effectiveCommand: 'youtube:live:poll --execute --videoId=private-option',
            callback: function (): array {
                app(IngestionTelemetry::class)->recordYoutubeRequest([
                    'method' => 'videos.list',
                    'estimated_quota_units' => 1,
                    'ok' => true,
                    'status' => 200,
                    'latency_ms' => 5,
                ]);

                return ['exit_code' => 0];
            },
        );

        $this->assertTrue($result['allowed']);
        Log::shouldHaveReceived('info')
            ->once()
            ->with('Direct YouTube ingestion execution completed.', \Mockery::on(function (array $context): bool {
                $this->assertSame('youtube.live.poll', $context['job_key']);
                $this->assertSame('completed', $context['status']);
                $this->assertSame(0, $context['exit_code']);
                $this->assertSame(1, $context['actual_units']);
                $this->assertSame(1, $context['request_attempts']);
                $this->assertArrayNotHasKey('effective_command', $context);
                $this->assertArrayNotHasKey('payload', $context);

                $encoded = json_encode($context, JSON_THROW_ON_ERROR);

                return ! str_contains($encoded, 'private-option')
                    && ! str_contains($encoded, 'youtube-super-secret');
            }));
    }

    public function test_direct_youtube_guard_logs_exception_class_without_message(): void
    {
        Log::spy();
        config()->set('services.youtube.api_key', 'youtube-super-secret');
        $thrown = null;

        try {
            app(DirectYoutubeQuotaGuard::class)->run(
                jobKey: 'youtube.live.poll',
                effectiveCommand: 'youtube:live:poll --execute --videoId=private-option',
                callback: fn (): array => throw new \RuntimeException('token=callback-super-secret'),
            );
        } catch (\RuntimeException $exception) {
            $thrown = $exception;
        }

        $this->assertNotNull($thrown);
        Log::shouldHaveReceived('warning')
            ->once()
            ->with('Direct YouTube ingestion execution failed.', \Mockery::on(function (array $context): bool {
                $this->assertSame('youtube.live.poll', $context['job_key']);
                $this->assertSame('failed_exception', $context['status']);
                $this->assertSame(\RuntimeException::class, $context['exception_class']);
                $this->assertArrayNotHasKey('exception_message', $context);
                $this->assertArrayNotHasKey('effective_command', $context);

                $encoded = json_encode($context, JSON_THROW_ON_ERROR);

                return ! str_contains($encoded, 'callback-super-secret')
                    && ! str_contains($encoded, 'private-option')
                    && ! str_contains($encoded, 'youtube-super-secret');
            }));
    }

    public function test_direct_youtube_guard_refuses_an_overlapping_job_before_reserving_quota(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $jobKey = 'youtube.live.poll';
        $lock = Cache::lock('ingestion:job:'.sha1($jobKey), 600);
        $this->assertTrue($lock->get());

        try {
            $exitCode = Artisan::call('youtube:live:poll', [
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('command_locked', $payload['blocked_reason']);
            $this->assertSame(0, DB::table('ingestion_youtube_quota_daily')->count());
        } finally {
            $lock->release();
        }
    }

    public function test_scheduler_skips_a_youtube_job_while_a_direct_command_holds_the_shared_lock(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $jobKey = 'youtube.live.poll';
        $lock = Cache::lock('ingestion:job:'.sha1($jobKey), 600);
        $this->assertTrue($lock->get());

        try {
            $result = app(IngestionSchedulerRunner::class)->run(
                at: CarbonImmutable::now('Asia/Taipei'),
                execute: true,
                jobKey: $jobKey,
            );
        } finally {
            $lock->release();
        }

        $this->assertSame('skip:job-locked', $result['jobs'][0]['action']);
        $this->assertSame(0, DB::table('ingestion_youtube_quota_daily')->count());
        Http::assertNothingSent();
    }

    public function test_scheduler_reservation_context_reuses_the_shared_job_lock(): void
    {
        config()->set('services.youtube.api_key', 'test-key');
        $jobKey = 'youtube.live.poll';
        $lock = Cache::lock('ingestion:job:'.sha1($jobKey), 600);
        $this->assertTrue($lock->get());

        try {
            $result = app(YoutubeQuotaReservationContext::class)->withSchedulerReservation(
                $jobKey,
                [
                    'planned_units' => 1,
                    'budget_units' => 9000,
                    'quota_date' => CarbonImmutable::now('America/Los_Angeles')->toDateString(),
                    'ledger_source' => 'test',
                ],
                fn (): array => app(DirectYoutubeQuotaGuard::class)->run(
                    jobKey: $jobKey,
                    effectiveCommand: 'youtube:live:poll --execute --limit=1',
                    callback: fn (): array => ['mode' => 'test'],
                ),
            );

            $this->assertTrue($result['allowed']);
            $this->assertSame('scheduler', $result['guard']['accounting_owner']);
            $this->assertTrue($lock->isOwnedByCurrentProcess());
        } finally {
            $lock->release();
        }
    }

    public function test_direct_command_accepts_fallback_only_youtube_credentials_before_quota_preflight(): void
    {
        config()->set('services.youtube.api_key', null);
        config()->set('services.youtube.api_keys', 'fallback-only-key');
        config()->set('ingestion.youtube_daily_quota_budget', 0);
        Http::preventStrayRequests();

        $exitCode = Artisan::call('youtube:comments:fetch', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('quota_budget_not_configured', $payload['youtube_quota_budget']['reason']);
        $this->assertNotSame('youtube_api_key_not_configured', $payload['youtube_quota_budget']['reason']);
        Http::assertNothingSent();
    }

    public function test_direct_quota_context_stops_before_an_attempt_can_cross_pacific_reset(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 23:59:50', 'America/Los_Angeles'));
        config()->set('services.youtube.api_key', 'test-key');
        config()->set('services.youtube.api_keys', null);
        config()->set('services.youtube.transient_retries', 0);
        Http::preventStrayRequests();

        try {
            app(DirectYoutubeQuotaGuard::class)->run(
                jobKey: 'youtube.live.poll',
                effectiveCommand: 'youtube:live:poll --execute --limit=1',
                callback: fn (): array => ['details' => app(YoutubeDataApiClient::class)->videoLiveStreamingDetails(['video-1'])],
            );
            $this->fail('Expected the Pacific quota reset guard to stop the request.');
        } catch (YoutubeQuotaWindowException $exception) {
            $this->assertSame('youtube_quota_window_reset_guard', $exception->getMessage());
        }

        $ledger = DB::table('ingestion_youtube_quota_daily')->where('quota_date', '2026-07-13')->first();
        $this->assertNotNull($ledger);
        $this->assertSame(0, (int) $ledger->consumed_units);
        $this->assertSame(0, (int) $ledger->reserved_units);
        Http::assertNothingSent();
    }

    public function test_runner_settles_reservation_into_top_level_budget_state(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'America/Los_Angeles'));
        Artisan::command('testing:youtube-telemetry', function (): int {
            app(IngestionTelemetry::class)->recordYoutubeRequest([
                'method' => 'videos.list',
                'estimated_quota_units' => 1,
                'ok' => true,
                'status' => 200,
                'latency_ms' => 5,
            ]);

            return 0;
        });
        $this->configureYoutubeTestJob('testing:youtube-telemetry');

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.live.poll',
        );
        $budget = $result['jobs'][0]['youtube_quota_budget'];

        $this->assertSame(1, $result['summary']['executed']);
        $this->assertSame(1, $budget['actual_units']);
        $this->assertSame(1, $budget['consumed_units']);
        $this->assertSame(0, $budget['reserved_units']);
        $this->assertSame(1, $budget['projected_units']);
        $this->assertSame(8999, $budget['remaining_units']);
        $this->assertFalse($budget['reservation_active']);
    }

    public function test_settlement_failure_marks_operational_failure_without_restarting_job(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'America/Los_Angeles'));
        Artisan::command('testing:youtube-drop-ledger', function (): int {
            app(IngestionTelemetry::class)->recordYoutubeRequest([
                'method' => 'videos.list',
                'estimated_quota_units' => 1,
                'ok' => true,
                'status' => 200,
                'latency_ms' => 5,
            ]);
            Schema::drop('ingestion_youtube_quota_daily');

            return 0;
        });
        $this->configureYoutubeTestJob('testing:youtube-drop-ledger');

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::now('Asia/Taipei'),
            execute: true,
            jobKey: 'youtube.live.poll',
        );
        $job = $result['jobs'][0];

        $this->assertTrue($job['executed']);
        $this->assertTrue($job['failed']);
        $this->assertTrue($job['quota_accounting_failed']);
        $this->assertSame('executed:quota-accounting-failed', $job['action']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 0, 'failed' => 1], $result['summary']);
        $this->assertFalse($job['youtube_quota_budget']['available']);
    }

    public function test_scheduled_quota_estimates_use_command_caps_and_configured_key_attempts(): void
    {
        config()->set('services.youtube.api_key', 'primary');
        config()->set('services.youtube.api_keys', 'fallback');
        $estimator = app(YoutubeQuotaEstimator::class);

        $backfill = $estimator->estimateScheduledJob([
            'key' => 'youtube.tag_videos.backfill',
        ], 'youtube:tag-videos:backfill --execute --limit=100 --max-pages=20');
        $comments = $estimator->estimateScheduledJob([
            'key' => 'youtube.comments.fetch',
        ], 'youtube:comments:fetch --execute --limit=5 --max-pages=3');
        $stats = $estimator->estimateScheduledJob([
            'key' => 'youtube.videos.stats',
        ], 'youtube:videos:stats --execute --limit=25');
        $blockedBeforeHttp = $estimator->estimateJob([
            'key' => 'youtube.live.poll',
            'failed' => true,
            'error' => 'youtube_quota_window_reset_guard',
            'telemetry' => ['youtube_requests' => []],
        ]);

        $this->assertSame(8000, $backfill['estimated_units']);
        $this->assertSame(460, $comments['estimated_units']);
        $this->assertSame(4, $stats['estimated_units']);
        $this->assertSame(0, $blockedBeforeHttp['estimated_units']);
        $this->assertStringContainsString('configured_key_attempts=2', $backfill['basis']);
        $this->assertStringContainsString('transient_attempts=2', $backfill['basis']);
    }

    public function test_runner_redacts_command_output_before_it_reaches_run_history(): void
    {
        config()->set('services.youtube.api_key', 'scheduler-super-secret');
        Artisan::command('testing:secret-output', function (): int {
            $this->line('failed https://example.test/?key=scheduler-super-secret Bearer bearer-super-secret token=token-super-secret');

            return 1;
        });
        config()->set('ingestion.jobs', [[
            'key' => 'testing.secret_output',
            'group' => 'Testing',
            'priority' => 1,
            'modern_command' => 'testing:secret-output',
            'scheduled_execute_command' => 'testing:secret-output',
            'legacy_command' => 'test only',
            'schedule' => '* * * * *',
            'cadence' => 'test only',
            'status' => 'active',
            'external_dependency' => 'Local DB',
            'writes' => ['test only'],
            'notes' => 'test only',
        ]]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:19:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'testing.secret_output',
        );
        $output = $result['jobs'][0]['output'];

        $this->assertSame('failed', $result['jobs'][0]['action']);
        $this->assertStringContainsString('<redacted>', $output);
        $this->assertStringNotContainsString('scheduler-super-secret', $output);
        $this->assertStringNotContainsString('bearer-super-secret', $output);
        $this->assertStringNotContainsString('token-super-secret', $output);
    }

    private function configureYoutubeTestJob(string $command): void
    {
        config()->set('ingestion.jobs', [[
            'key' => 'youtube.live.poll',
            'group' => 'Testing',
            'priority' => 1,
            'modern_command' => $command,
            'scheduled_execute_command' => $command,
            'legacy_command' => 'test only',
            'schedule' => '* * * * *',
            'cadence' => 'test only',
            'status' => 'active',
            'external_dependency' => 'YouTube Data API',
            'writes' => ['test only'],
            'notes' => 'test only',
        ]]);
    }
}
