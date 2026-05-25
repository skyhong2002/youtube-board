<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReadOnlyPeopleBuildCommandTest extends TestCase
{
    public function test_reports_people_build_previews_legacy_tag_period_jobs_without_calls(): void
    {
        $this->createTables();

        DB::table('tag_group')->insert([
            [
                'ctime' => '2026-05-20 10:00:00',
                'latest_time' => '2026-05-24 10:00:00',
                'tag' => '柯文哲',
                'group_name' => '政治人物',
                'del_flag' => '',
            ],
            [
                'ctime' => '2026-05-19 10:00:00',
                'latest_time' => '2026-05-23 10:00:00',
                'tag' => '蔡英文',
                'group_name' => '政治人物',
                'del_flag' => '0',
            ],
            [
                'ctime' => '2026-05-18 10:00:00',
                'latest_time' => '2026-05-22 10:00:00',
                'tag' => '封存人物',
                'group_name' => '政治人物',
                'del_flag' => '1',
            ],
            [
                'ctime' => '2026-05-18 10:00:00',
                'latest_time' => '2026-05-25 10:00:00',
                'tag' => '藝人A',
                'group_name' => '藝人',
                'del_flag' => '',
            ],
        ]);

        $exitCode = Artisan::call('reports:people:build', [
            '--group' => '政治人物',
            '--tagid' => 13,
            '--days' => 37,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('政治人物', $payload['group_name']);
        $this->assertSame(2, $payload['candidates']);
        $this->assertSame('2026-05-24 10:00:00', $payload['latest_time']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('柯文哲', $payload['rows'][0]['tag']);
        $this->assertStringContainsString('tagid=13', $payload['rows'][0]['modern_api_preview']);
        $this->assertStringContainsString('days=37', $payload['rows'][0]['modern_api_preview']);
        $this->assertStringContainsString('tag_period.php tag=柯文哲 tagid=13 days=37', $payload['rows'][0]['legacy_command']);
        $this->assertSame(4, DB::table('tag_group')->count());
    }

    public function test_reports_people_build_supports_legacy_group_and_period_options(): void
    {
        $this->createTables();

        DB::table('tag_group')->insert([
            'ctime' => '2026-05-20 10:00:00',
            'latest_time' => '2026-05-24 10:00:00',
            'tag' => '藝人A',
            'group_name' => '藝人',
            'del_flag' => '',
        ]);

        $exitCode = Artisan::call('reports:people:build', [
            '--group' => '藝人',
            '--tagid' => 6,
            '--days' => 14,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('藝人', $payload['group_name']);
        $this->assertSame(6, $payload['tagid']);
        $this->assertSame(14, $payload['days']);
        $this->assertSame('藝人A', $payload['rows'][0]['tag']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_people_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.people.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
    }

    private function createTables(): void
    {
        Schema::dropIfExists('tag_group');

        Schema::create('tag_group', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->string('tag');
            $table->string('group_name');
            $table->string('del_flag')->nullable();
        });
    }
}
