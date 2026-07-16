<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionJobRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionChannelPredictionCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_channel_predictions_preview_is_capped_and_does_not_write(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10);
        $this->seedChannel(11);
        $this->seedChannel(12);

        $exitCode = Artisan::call('reports:channel-predictions:build', [
            '--limit' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertTrue($payload['available']);
        $this->assertSame(3, $payload['candidate_total']);
        $this->assertSame(2, $payload['candidates']);
        $this->assertSame(2, $payload['would_update']);
        $this->assertSame([10, 11], array_column($payload['rows'], 'u_id'));
        $this->assertSame([], $payload['writes']);
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 12)->value('views_pred_month'));
    }

    public function test_channel_predictions_supports_wrapped_offset_pagination(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10);
        $this->seedChannel(11);
        $this->seedChannel(12);

        $exitCode = Artisan::call('reports:channel-predictions:build', [
            '--limit' => 2,
            '--offset' => 2,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(2, $payload['offset']);
        $this->assertSame(1, $payload['next_offset']);
        $this->assertTrue($payload['batch_wrapped']);
        $this->assertTrue($payload['source_truncated']);
        $this->assertSame([12, 10], array_column($payload['rows'], 'u_id'));
    }

    public function test_channel_predictions_execute_updates_one_channel_idempotently(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10);

        $firstExitCode = Artisan::call('reports:channel-predictions:build', [
            '--u_id' => 10,
            '--limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $first = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExitCode);
        $this->assertSame('execute', $first['mode']);
        $this->assertSame(1, $first['updated']);
        $this->assertSame('updated', $first['rows'][0]['status']);
        $this->assertSame(700, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
        $this->assertSame(2900, DB::table('urt_count')->where('u_id', 10)->value('views_pred_month'));
        $this->assertSame([
            'urt_count.views_pred_week',
            'urt_count.views_pred_month',
        ], $first['writes']);

        $secondExitCode = Artisan::call('reports:channel-predictions:build', [
            '--u_id' => 10,
            '--limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $second = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $secondExitCode);
        $this->assertSame(0, $second['updated']);
        $this->assertSame(1, $second['unchanged']);
        $this->assertSame('unchanged', $second['rows'][0]['status']);
        $this->assertSame(700, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
        $this->assertSame(2900, DB::table('urt_count')->where('u_id', 10)->value('views_pred_month'));
    }

    public function test_channel_predictions_isolates_bad_log_rows_and_continues(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10, validLog: false);
        $this->seedChannel(11);

        $exitCode = Artisan::call('reports:channel-predictions:build', [
            '--limit' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['failed']);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('invalid_log_history', $payload['rows'][0]['reason']);
        $this->assertSame('updated', $payload['rows'][1]['status']);
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
        $this->assertSame(700, DB::table('urt_count')->where('u_id', 11)->value('views_pred_week'));
    }

    public function test_channel_predictions_skips_channel_without_log_history(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10);
        DB::table('urt_log')->where('u_id', 10)->delete();

        $exitCode = Artisan::call('reports:channel-predictions:build', [
            '--u_id' => 10,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['skipped']);
        $this->assertSame(0, $payload['failed']);
        $this->assertSame('skipped', $payload['rows'][0]['status']);
        $this->assertSame('insufficient_log_history', $payload['rows'][0]['reason']);
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
    }

    public function test_channel_predictions_do_not_write_video_only_history(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10);
        DB::table('urt_log')->where('u_id', 10)->update([
            'thedata' => json_encode([
                '2026-05-24' => ['video' => 10],
                '2026-05-25' => ['videos' => 12],
            ], JSON_THROW_ON_ERROR),
        ]);

        $exitCode = Artisan::call('reports:channel-predictions:build', [
            '--u_id' => 10,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['skipped']);
        $this->assertSame(0, $payload['failed']);
        $this->assertSame('skipped', $payload['rows'][0]['status']);
        $this->assertSame('insufficient_log_history', $payload['rows'][0]['reason']);
        $this->assertSame(2, $payload['rows'][0]['valid_points']);
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('views_pred_month'));
    }

    public function test_channel_predictions_handles_missing_schema_without_sql_details(): void
    {
        $this->setPredictionTestTime();

        foreach (['urt_log', 'urt_count', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        $exitCode = Artisan::call('reports:channel-predictions:build', [
            '--execute' => true,
            '--json' => true,
        ]);
        $output = trim(Artisan::output());
        $payload = json_decode($output, true);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['available']);
        $this->assertSame('missing_table:urt_channel', $payload['blocked_reason']);
        $this->assertSame([], $payload['writes']);
        $this->assertStringNotContainsString('SQLSTATE', $output);
        $this->assertStringNotContainsString('Connection:', $output);
    }

    public function test_channel_predictions_execute_reports_lock_contention_and_logs_it(): void
    {
        $this->setPredictionTestTime();
        $this->createTables();
        $this->seedChannel(10);
        Log::spy();
        $lock = Cache::lock('ingestion:reports.channel_predictions.build', 60);
        $this->assertTrue($lock->get());

        try {
            $exitCode = Artisan::call('reports:channel-predictions:build', [
                '--u_id' => 10,
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('lock_busy', $payload['blocked_reason']);
            $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('views_pred_week'));
            Log::shouldHaveReceived('warning')->once()->withArgs(
                fn (string $message, array $context): bool => $message === 'Channel prediction build completed with gaps.'
                    && $context['blocked_reason'] === 'lock_busy',
            );
        } finally {
            $lock->release();
        }
    }

    public function test_channel_predictions_registry_entry_remains_manual_and_planned(): void
    {
        $job = app(IngestionJobRegistry::class)->find('reports.channel_predictions.build');

        $this->assertNotNull($job);
        $this->assertSame('planned', $job['status']);
        $this->assertSame('manual', $job['schedule']);
        $this->assertSame('reports:channel-predictions:build', $job['modern_command']);
        $this->assertSame('', $job['scheduled_execute_command']);
        $this->assertTrue($job['command_exists']);
        $this->assertFalse(app(IngestionJobRegistry::class)->scheduledWriteProfile($job)['allowed']);
    }

    private function setPredictionTestTime(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
    }

    private function createTables(): void
    {
        foreach (['urt_log', 'urt_count', 'urt_channel'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_channel', function ($table): void {
            $table->integer('u_id')->primary();
            $table->string('title')->nullable();
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id')->primary();
            $table->bigInteger('views_pred_week')->nullable();
            $table->bigInteger('views_pred_month')->nullable();
        });

        Schema::create('urt_log', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->date('themonth')->nullable();
            $table->longText('thedata')->nullable();
        });
    }

    private function seedChannel(int $uId, bool $validLog = true): void
    {
        DB::table('urt_channel')->insert([
            'u_id' => $uId,
            'title' => 'Channel '.$uId,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => $uId,
            'views_pred_week' => 0,
            'views_pred_month' => 0,
        ]);
        DB::table('urt_log')->insert([
            'u_id' => $uId,
            'themonth' => '2026-05-01',
            'thedata' => $validLog
                ? json_encode($this->dailyHistory(), JSON_UNESCAPED_SLASHES)
                : '{bad-json',
        ]);
    }

    /**
     * @return array<string, array{view: int, video: int}>
     */
    private function dailyHistory(): array
    {
        $rows = [];
        $start = CarbonImmutable::parse('2026-03-01 00:00:00', 'Asia/Taipei');
        $end = CarbonImmutable::parse('2026-05-25 00:00:00', 'Asia/Taipei');
        $index = 0;

        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $rows[$date->toDateString()] = [
                'view' => 1000 + ($index * 100),
                'video' => 10 + $index,
            ];
            $index++;
        }

        return $rows;
    }
}
