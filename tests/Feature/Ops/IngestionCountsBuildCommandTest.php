<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionCountsBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_reports_counts_build_previews_legacy_count_deltas_in_preview_mode(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_count')->insert([
            [
                'u_id' => 10,
                'ctime' => '2026-05-01 00:00:00',
                'viewCount' => 1000,
                'subscriberCount' => 100,
                'videoCount' => 50,
                'view_week' => 0,
                'sub_week' => 0,
                'video_week' => 0,
                'view_month' => 0,
                'sub_month' => 0,
                'video_month' => 0,
                'tags' => '[1]',
            ],
            [
                'u_id' => 11,
                'ctime' => '2026-05-01 00:00:00',
                'viewCount' => 2000,
                'subscriberCount' => 200,
                'videoCount' => 60,
                'view_week' => 0,
                'sub_week' => 0,
                'video_week' => 0,
                'view_month' => 0,
                'sub_month' => 0,
                'video_month' => 0,
                'tags' => '[2]',
            ],
        ]);

        DB::table('urt_log')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-25 12:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-25' => ['view' => 1000, 'subscriber' => 100, 'video' => 50],
                '2026-05-18' => ['view' => 850, 'subscriber' => 90, 'video' => 45],
                '2026-04-26' => ['view' => 700, 'subscriber' => 80, 'video' => 40],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:counts:build', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(2, $payload['candidates']);
        $this->assertSame(1, $payload['with_logs']);
        $this->assertSame(1, $payload['missing_logs']);
        $this->assertSame(1, $payload['would_update']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame(10, $payload['rows'][0]['u_id']);
        $this->assertSame([
            'view_week' => 150,
            'sub_week' => 10,
            'video_week' => 5,
            'view_month' => 300,
            'sub_month' => 20,
            'video_month' => 10,
        ], $payload['rows'][0]['computed']);
        $this->assertSame(0, DB::table('urt_count')->where('u_id', 10)->value('view_week'));
    }

    public function test_reports_counts_build_supports_legacy_single_id_preview(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_count')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'view_week' => 0,
            'sub_week' => 0,
            'video_week' => 0,
            'view_month' => 0,
            'sub_month' => 0,
            'video_month' => 0,
        ]);
        DB::table('urt_log')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-25 12:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-25' => ['view' => 100, 'subscriber' => 20, 'video' => 10],
                '2026-05-18' => ['view' => 80, 'subscriber' => 18, 'video' => 9],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:counts:build', [
            '--id' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['candidates']);
        $this->assertSame(10, $payload['rows'][0]['u_id']);
        $this->assertSame(20, $payload['rows'][0]['computed']['view_week']);
    }

    public function test_reports_counts_build_execute_updates_selected_count_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('urt_count')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-01 00:00:00',
            'view_week' => 0,
            'sub_week' => 0,
            'video_week' => 0,
            'view_month' => 0,
            'sub_month' => 0,
            'video_month' => 0,
        ]);
        DB::table('urt_log')->insert([
            'u_id' => 10,
            'ctime' => '2026-05-25 12:00:00',
            'themonth' => '2026-05-01',
            'thedata' => json_encode([
                '2026-05-25' => ['view' => 100, 'subscriber' => 20, 'video' => 10],
                '2026-05-18' => ['view' => 80, 'subscriber' => 18, 'video' => 9],
            ], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:counts:build', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['updated']);
        $this->assertSame(20, DB::table('urt_count')->where('u_id', 10)->value('view_week'));
        $this->assertSame(2, DB::table('urt_count')->where('u_id', 10)->value('sub_week'));
        $this->assertSame('2026-05-25 12:00:00', DB::table('urt_count')->where('u_id', 10)->value('mtime'));
    }

    public function test_ingestion_scheduler_can_execute_ingestion_counts_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['reports.counts.build']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.counts.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        foreach (['urt_log', 'urt_count'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id')->primary();
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->bigInteger('viewCount')->nullable();
            $table->integer('subscriberCount')->nullable();
            $table->integer('videoCount')->nullable();
            $table->integer('view_week')->nullable();
            $table->integer('sub_week')->nullable();
            $table->integer('video_week')->nullable();
            $table->integer('view_month')->nullable();
            $table->integer('sub_month')->nullable();
            $table->integer('video_month')->nullable();
            $table->string('tags')->nullable();
        });

        Schema::create('urt_log', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->dateTime('ctime')->nullable();
            $table->date('themonth')->nullable();
            $table->text('thedata')->nullable();
        });
    }
}
