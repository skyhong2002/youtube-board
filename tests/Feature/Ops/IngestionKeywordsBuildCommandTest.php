<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionKeywordsBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_reports_keywords_build_previews_legacy_keyword_json_in_preview_mode(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('tags')->insert([
            [
                'tag' => '蔡英文',
                'ctime' => '2026-05-25 10:00:00',
                'mtime' => '2026-05-25 10:00:00',
                'max_count' => 1000,
                'hours_count' => 200,
                'max_hours' => '2026-05-25 10:00:00',
                'no_tag' => 0,
            ],
            [
                'tag' => '舊聞',
                'ctime' => '2026-05-01 10:00:00',
                'mtime' => '2026-05-01 10:00:00',
                'max_count' => 900,
                'hours_count' => 150,
                'max_hours' => '2026-05-01 10:00:00',
                'no_tag' => 0,
            ],
            [
                'tag' => 'A',
                'ctime' => '2026-05-25 10:00:00',
                'mtime' => '2026-05-25 10:00:00',
                'max_count' => 5000,
                'hours_count' => 5000,
                'max_hours' => '2026-05-25 10:00:00',
                'no_tag' => 0,
            ],
            [
                'tag' => 'TV',
                'ctime' => '2026-05-25 10:00:00',
                'mtime' => '2026-05-25 10:00:00',
                'max_count' => 5000,
                'hours_count' => 5000,
                'max_hours' => '2026-05-25 10:00:00',
                'no_tag' => 0,
            ],
            [
                'tag' => '1234',
                'ctime' => '2026-05-25 10:00:00',
                'mtime' => '2026-05-25 10:00:00',
                'max_count' => 5000,
                'hours_count' => 5000,
                'max_hours' => '2026-05-25 10:00:00',
                'no_tag' => 0,
            ],
            [
                'tag' => '封鎖',
                'ctime' => '2026-05-25 10:00:00',
                'mtime' => '2026-05-25 10:00:00',
                'max_count' => 5000,
                'hours_count' => 5000,
                'max_hours' => '2026-05-25 10:00:00',
                'no_tag' => 1,
            ],
        ]);

        $exitCode = Artisan::call('reports:keywords:build', [
            '--limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame(6, $payload['source_tags']);
        $this->assertSame(2, $payload['eligible_keywords']);
        $this->assertSame(1, $payload['recent_keywords']);
        $this->assertSame(['no_tag' => 1, 'single_char' => 1, 'numeric' => 1, 'short_ascii' => 1], $payload['excluded']);
        $this->assertSame(['data/keyword.json', 'data/keyword_all.json'], $payload['filesystem_targets']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('蔡英文', $payload['rows'][0]['tag']);
        $this->assertSame(sprintf('%.2f', log(1010) + log(250)), $payload['rows'][0]['legacy_weight']);
        $this->assertTrue($payload['rows'][0]['included_in_keyword_all']);
        $this->assertSame(6, DB::table('tags')->count());
    }

    public function test_ingestion_scheduler_can_execute_ingestion_keywords_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['reports.keywords.build']);
        Http::fake([
            'https://tag.analysis.tw/api/tag_json.php*' => Http::response([]),
        ]);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.keywords.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
    }

    public function test_reports_keywords_build_execute_syncs_external_tag_rows(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();
        DB::table('tags')->insert([
            'tag' => '既有',
            'ctime' => '2026-05-20 10:00:00',
            'mtime' => '2026-05-20 10:00:00',
            'max_count' => 1,
            'hours_count' => 1,
            'max_hours' => '2026-05-20 10:00:00',
            'no_tag' => 0,
        ]);
        Http::fake([
            'https://tag.analysis.tw/api/tag_json.php*' => Http::response([
                [
                    'tag' => '既有',
                    'max_count' => 10,
                    'hours_count' => 20,
                    'max_hours' => '2026-05-25 11:00:00',
                    'mtime' => '2026-05-25 11:00:00',
                    'no_tag' => 0,
                ],
                [
                    'tag' => '新增',
                    'max_count' => 30,
                    'hours_count' => 40,
                    'max_hours' => '2026-05-25 11:30:00',
                    'mtime' => '2026-05-25 11:30:00',
                    'no_tag' => 1,
                ],
            ]),
        ]);

        $exitCode = Artisan::call('reports:keywords:build', [
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(2, $payload['synced_rows']);
        $this->assertSame(['tags'], $payload['writes']);
        $this->assertSame(2, DB::table('tags')->count());
        $this->assertSame(10, DB::table('tags')->where('tag', '既有')->value('max_count'));
        $this->assertSame(1, DB::table('tags')->where('tag', '新增')->value('no_tag'));
    }

    private function createTables(): void
    {
        Schema::dropIfExists('tags');

        Schema::create('tags', function ($table): void {
            $table->increments('pk');
            $table->string('tag');
            $table->dateTime('ctime');
            $table->dateTime('mtime');
            $table->integer('max_count');
            $table->integer('hours_count');
            $table->dateTime('max_hours');
            $table->tinyInteger('no_tag')->nullable();
        });
    }
}
