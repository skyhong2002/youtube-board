<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyGroupsBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_reports_groups_build_summarizes_local_tag_group_without_external_fetch_or_writes(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTable();

        DB::table('tag_group')->insert([
            [
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => null,
                'latest_time' => '2026-05-20 10:00:00',
                'tag' => 'alpha',
                'group_name' => 'Group A',
                'del_flag' => null,
            ],
            [
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => '2026-05-21 00:00:00',
                'latest_time' => '2026-05-21 09:00:00',
                'tag' => 'beta',
                'group_name' => 'Group A',
                'del_flag' => '1',
            ],
            [
                'ctime' => '2026-05-02 00:00:00',
                'mtime' => null,
                'latest_time' => '2026-05-22 08:00:00',
                'tag' => 'gamma',
                'group_name' => 'Group B',
                'del_flag' => '0',
            ],
        ]);

        $exitCode = Artisan::call('reports:groups:build', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame(2, $payload['group_count']);
        $this->assertSame(3, $payload['tag_rows']);
        $this->assertSame(2, $payload['active_rows']);
        $this->assertSame(1, $payload['deleted_rows']);
        $this->assertSame('2026-05-22 08:00:00', $payload['latest_time']);
        $this->assertSame([], $payload['writes']);
        $this->assertStringContainsString('not called', $payload['external_fetch_skipped']);
        $this->assertSame(3, DB::table('tag_group')->count());
        $this->assertSame('1', DB::table('tag_group')->where('tag', 'beta')->value('del_flag'));
    }

    public function test_reports_groups_build_supports_single_group_preview(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTable();

        DB::table('tag_group')->insert([
            [
                'ctime' => '2026-05-01 00:00:00',
                'mtime' => null,
                'latest_time' => '2026-05-20 10:00:00',
                'tag' => 'alpha',
                'group_name' => 'Group A',
                'del_flag' => null,
            ],
            [
                'ctime' => '2026-05-02 00:00:00',
                'mtime' => null,
                'latest_time' => '2026-05-22 08:00:00',
                'tag' => 'gamma',
                'group_name' => 'Group B',
                'del_flag' => '0',
            ],
        ]);

        $exitCode = Artisan::call('reports:groups:build', [
            '--group' => 'Group B',
            '--hours' => 12,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('Group B', $payload['group_name']);
        $this->assertSame(12, $payload['hours']);
        $this->assertSame(1, $payload['group_count']);
        $this->assertSame('Group B', $payload['rows'][0]['group_name']);
        $this->assertSame(1, $payload['rows'][0]['active_rows']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_groups_preview_when_due(): void
    {
        $this->createTable();
        config()->set('ingestion.scheduler_enabled', true);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.groups.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
    }

    private function createTable(): void
    {
        Schema::dropIfExists('tag_group');

        Schema::create('tag_group', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('latest_time');
            $table->string('tag', 64);
            $table->string('group_name', 64);
            $table->string('del_flag', 1)->nullable();
        });
    }
}
