<?php

namespace Tests\Feature\Reports;

use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AiDailyLineageStatusTest extends TestCase
{
    public function test_ai_daily_lineage_shows_the_latest_failed_execution_attempt(): void
    {
        $this->setLineageTestNow();

        try {
            Storage::fake('local');
            $this->putRunRecord(
                id: '20260713-173000-failed',
                createdAt: '2026-07-13 17:30:00 Asia/Taipei',
                failed: true,
                exitCode: 1,
            );

            $response = $this->get('/ai/days/2026-07-12/all');

            $response->assertOk();
            $response->assertSee('最近執行失敗：30 分鐘前');
            $response->assertDontSee('上次執行：尚無記錄');
        } finally {
            $this->clearLineageTestNow();
        }
    }

    public function test_ai_daily_lineage_distinguishes_a_failure_before_command_start(): void
    {
        $this->setLineageTestNow();

        try {
            Storage::fake('local');
            $this->putRunRecord(
                id: '20260713-173000-scheduler-failed',
                createdAt: '2026-07-13 17:30:00 Asia/Taipei',
                failed: true,
                exitCode: 1,
                started: false,
                action: 'failed:youtube-quota-ledger-unavailable',
            );

            $response = $this->get('/ai/days/2026-07-12/all');

            $response->assertOk();
            $response->assertSee('最近執行前置失敗：30 分鐘前');
            $response->assertDontSee('最近執行失敗：30 分鐘前');
        } finally {
            $this->clearLineageTestNow();
        }
    }

    public function test_ai_daily_lineage_labels_database_freshness_as_a_cache_update_without_run_history(): void
    {
        $this->setLineageTestNow();

        try {
            Storage::fake('local');
            $this->createAiDailyCacheTable();

            DB::table('urt_ai_date')->insert([
                'pk' => 1,
                'date_from' => '2026-07-12 00:00:00',
                'date_to' => '2026-07-12 23:59:59',
                'condition_type' => 'all',
                'data_type' => 'oneday',
                'del_flag' => null,
                'channel_id' => '[]',
                'result_json' => '[]',
                'ctime' => '2026-07-13 15:55:00',
                'mtime' => '2026-07-13 16:00:00',
            ]);

            $response = $this->get('/ai/days/2026-07-12/all');

            $response->assertOk();
            $response->assertSee('資料最後更新：2 小時前');
            $response->assertDontSee('上次成功執行');
            $response->assertDontSee('上次執行：2 小時前');
        } finally {
            $this->clearLineageTestNow();
        }
    }

    public function test_ai_daily_lineage_uses_the_newest_channel_ai_cache_timestamp_without_run_history(): void
    {
        $this->setLineageTestNow();

        try {
            Storage::fake('local');
            $this->createAiDailyCacheTable();
            $this->createChannelAiCacheTable();

            DB::table('urt_ai_date')->insert([
                'pk' => 1,
                'date_from' => '2026-07-12 00:00:00',
                'date_to' => '2026-07-12 23:59:59',
                'condition_type' => 'all',
                'data_type' => 'oneday',
                'del_flag' => null,
                'channel_id' => '[]',
                'result_json' => '[]',
                'ctime' => '2026-07-13 14:55:00',
                'mtime' => '2026-07-13 15:00:00',
            ]);
            DB::table('urt_channel_ai')->insert([
                'pk' => 2,
                'u_id' => 15,
                'date_from' => '2026-07-12 00:00:00',
                'date_to' => '2026-07-12 23:59:59',
                'del_flag' => null,
                'result_json' => '[]',
                'ctime' => '2026-07-13 16:55:00',
                'mtime' => '2026-07-13 17:00:00',
            ]);

            $response = $this->get('/ai/days/2026-07-12/all');

            $response->assertOk();
            $response->assertSee('資料最後更新：1 小時前');
            $response->assertDontSee('上次成功執行');
        } finally {
            $this->clearLineageTestNow();
        }
    }

    public function test_ai_daily_lineage_labels_a_successful_execution_as_the_last_success(): void
    {
        $this->setLineageTestNow();

        try {
            Storage::fake('local');
            $this->putRunRecord(
                id: '20260713-170000-success',
                createdAt: '2026-07-13 17:00:00 Asia/Taipei',
                failed: false,
                exitCode: 0,
            );

            $response = $this->get('/ai/days/2026-07-12/all');

            $response->assertOk();
            $response->assertSee('上次成功執行：1 小時前');
            $response->assertDontSee('上次執行：尚無記錄');
        } finally {
            $this->clearLineageTestNow();
        }
    }

    private function setLineageTestNow(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-07-13 18:00:00', 'Asia/Taipei'));
        Carbon::setTestNow(Carbon::parse('2026-07-13 18:00:00', 'Asia/Taipei'));
    }

    private function clearLineageTestNow(): void
    {
        CarbonImmutable::setTestNow();
        Carbon::setTestNow();
    }

    private function putRunRecord(
        string $id,
        string $createdAt,
        bool $failed,
        int $exitCode,
        bool $started = true,
        ?string $action = null,
    ): void {
        $job = [
            'key' => 'ai.daily',
            'executed' => ! $failed,
            'failed' => $failed,
            'exit_code' => $exitCode,
        ];

        if ($started) {
            $job['started_at'] = $createdAt;
        }

        if ($action !== null) {
            $job['action'] = $action;
        }

        Storage::disk('local')->put('ingestion-runs/'.$id.'.json', json_encode([
            'id' => $id,
            'created_at' => $createdAt,
            'request' => ['mode' => 'execute', 'source' => 'artisan'],
            'result' => [
                'mode' => 'execute',
                'jobs' => [
                    $job,
                ],
            ],
        ], JSON_THROW_ON_ERROR));
    }

    private function createAiDailyCacheTable(): void
    {
        Schema::dropIfExists('urt_ai_date');

        Schema::create('urt_ai_date', function ($table): void {
            $table->integer('pk');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->string('condition_type')->nullable();
            $table->string('data_type')->nullable();
            $table->integer('del_flag')->nullable();
            $table->text('channel_id')->nullable();
            $table->text('result_json')->nullable();
            $table->timestamp('ctime')->nullable();
            $table->timestamp('mtime')->nullable();
        });
    }

    private function createChannelAiCacheTable(): void
    {
        Schema::dropIfExists('urt_channel_ai');

        Schema::create('urt_channel_ai', function ($table): void {
            $table->integer('pk');
            $table->integer('u_id');
            $table->dateTime('date_from');
            $table->dateTime('date_to');
            $table->integer('del_flag')->nullable();
            $table->text('result_json')->nullable();
            $table->timestamp('ctime')->nullable();
            $table->timestamp('mtime')->nullable();
        });
    }
}
