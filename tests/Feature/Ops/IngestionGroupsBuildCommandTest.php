<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionGroupsBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_reports_groups_build_summarizes_local_tag_group_from_local_state_in_preview(): void
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
        $this->assertSame('ingestion-preview', $payload['mode']);
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

    public function test_ingestion_scheduler_can_execute_ingestion_groups_preview_when_due(): void
    {
        $this->createTable();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['reports.groups.build']);
        Http::fake([
            'https://tag.analysis.tw/api/group.php*' => Http::response(['result' => []]),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.groups.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
    }

    public function test_reports_groups_build_execute_syncs_external_group_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTable();
        DB::table('tag_group')->insert([
            'ctime' => '2026-05-20 10:00:00',
            'mtime' => null,
            'latest_time' => '2026-05-20 10:00:00',
            'tag' => '既有',
            'group_name' => '政治人物',
            'del_flag' => '0',
        ]);
        Http::fake([
            'https://tag.analysis.tw/api/group.php*' => Http::response([
                'result' => [
                    [
                        'tag' => '既有',
                        'group' => '政治人物',
                        'ctime' => '2026-05-20 10:00:00',
                        'mtime' => '2026-05-25 11:00:00',
                        'del_flag' => '1',
                    ],
                    [
                        'tag' => '新增',
                        'group' => '政黨',
                        'ctime' => '2026-05-25 11:30:00',
                        'mtime' => '2026-05-25 11:30:00',
                        'del_flag' => '0',
                    ],
                ],
            ]),
        ]);

        $exitCode = Artisan::call('reports:groups:build', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(2, $payload['synced_rows']);
        $this->assertSame(['tag_group'], $payload['writes']);
        $this->assertSame(2, DB::table('tag_group')->count());
        $this->assertSame('1', DB::table('tag_group')->where('tag', '既有')->value('del_flag'));
        $this->assertSame('政黨', DB::table('tag_group')->where('tag', '新增')->value('group_name'));
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
