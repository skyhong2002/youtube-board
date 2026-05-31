<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionMayorStaticCommandTest extends TestCase
{
    private string $legacyRoot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->legacyRoot = storage_path('framework/testing-legacy-mayor-static');
        File::deleteDirectory($this->legacyRoot);
        File::ensureDirectoryExists($this->legacyRoot.'/urtube/mayor');
        config()->set('legacy.ground_truth_path', $this->legacyRoot);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();
        File::deleteDirectory($this->legacyRoot);

        parent::tearDown();
    }

    public function test_reports_mayor_static_previews_legacy_mayor_targets_through_dynamic_routes(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();
        $this->writeLegacyShell();
        $this->seedSingleMayorCacheRow();

        $exitCode = Artisan::call('reports:mayor:static', [
            '--limit' => 30,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('ingestion-preview', $payload['mode']);
        $this->assertSame('parsed+fallback: filled missing current mayor targets', $payload['source_status']);
        $this->assertSame(22, $payload['targets']);
        $this->assertSame(22, $payload['would_generate']);
        $this->assertSame([], $payload['writes']);

        $this->assertSame('/home/urtube/mayor/html_taipei.html', $payload['rows'][0]['output_path']);
        $this->assertSame('html_taipei.html', $payload['rows'][0]['output_file']);
        $this->assertSame('/mayor/html_taipei.html', $payload['rows'][0]['legacy_static_url']);
        $this->assertSame('/mayor/city.php?days=30&city=taipei', $payload['rows'][0]['legacy_url']);
        $this->assertSame('/mayor/cities/taipei?days=30', $payload['rows'][0]['modern_url']);
        $this->assertSame('mayor-city-support', $payload['rows'][0]['report_type']);
        $this->assertTrue($payload['rows'][0]['dynamic_report_available']);
        $this->assertSame(30, $payload['rows'][0]['dynamic_rows']);
        $this->assertSame(1, $payload['rows'][0]['cache_rows']);
        $this->assertSame('/mayor/cities/lienchiang?days=30', $payload['rows'][21]['modern_url']);

        $this->assertFileDoesNotExist($this->legacyRoot.'/urtube/mayor/html_taipei.html');
        $this->assertFileDoesNotExist($this->legacyRoot.'/urtube/mayor/html_taichung.html');
    }

    public function test_reports_mayor_static_can_filter_one_city(): void
    {
        $this->createTagDateCacheTable();
        $this->writeLegacyShell();

        $exitCode = Artisan::call('reports:mayor:static', [
            '--city' => 'taichung',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, $payload['targets']);
        $this->assertSame('taichung', $payload['rows'][0]['city']);
        $this->assertSame('/mayor/cities/taichung?days=30', $payload['rows'][0]['modern_url']);
    }

    public function test_ingestion_scheduler_can_execute_ingestion_mayor_preview_when_due(): void
    {
        $this->writeLegacyShell();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['off']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 05:13:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.mayor.static',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 0, 'skipped' => 1, 'failed' => 0], $result['summary']);
        $this->assertSame('skip:controlled-execution-guardrail', $result['jobs'][0]['action']);
    }

    private function writeLegacyShell(): void
    {
        File::put(
            $this->legacyRoot.'/urtube/mayor/make_mayor.sh',
            "#!/bin/sh\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/mayor/city.php days=30 city=taipei > /home/urtube/mayor/html_taipei.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/mayor/city.php days=30 city=taoyuan > /home/urtube/mayor/html_taoyuan.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/mayor/city.php days=30 city=newtaipei > /home/urtube/mayor/html_newtaipei.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/mayor/city.php days=30 city=hsinchu > /home/urtube/mayor/html_hsinchu.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/mayor/city.php days=30 city=taichung > /home/urtube/mayor/html_taichung.html\n",
        );
    }

    private function createTagDateCacheTable(): void
    {
        Schema::dropIfExists('urt_show_tag_date');

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->integer('pk');
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->date('the_date');
            $table->integer('total_views')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_channels')->nullable();
            $table->longText('tags_views')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_result')->nullable();
        });
    }

    private function seedSingleMayorCacheRow(): void
    {
        DB::table('urt_show_tag_date')->insert([
            'pk' => 1,
            'tagid' => '3',
            'tag_or' => null,
            'tag_not' => null,
            'the_date' => '2026-05-23',
            'total_views' => 1000,
            'count_videos' => 10,
            'count_channels' => 3,
            'tags_views' => json_encode(['蔣萬安' => 100, '沈伯洋' => 1, '郭璽' => 1], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['蔣萬安' => 100, '沈伯洋' => 1, '郭璽' => 1], JSON_UNESCAPED_UNICODE),
            'tags_result' => json_encode(['蔣萬安' => 100, '沈伯洋' => 1, '郭璽' => 1], JSON_UNESCAPED_UNICODE),
        ]);
    }
}
