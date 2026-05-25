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

class ReadOnlyStaticHtmlCommandTest extends TestCase
{
    private string $legacyRoot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->legacyRoot = storage_path('framework/testing-legacy-static-html');
        File::deleteDirectory($this->legacyRoot);
        File::ensureDirectoryExists($this->legacyRoot.'/urtube/html');
        config()->set('legacy.ground_truth_path', $this->legacyRoot);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();
        File::deleteDirectory($this->legacyRoot);

        parent::tearDown();
    }

    public function test_reports_static_build_previews_legacy_group_static_targets_without_writing_html(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createTagDateCacheTable();
        $this->writeLegacyShell();

        DB::table('urt_show_tag_date')->insert([
            'pk' => 1,
            'tagid' => '53',
            'tag_or' => null,
            'tag_not' => null,
            'the_date' => '2026-05-23',
            'total_views' => 123456,
            'count_videos' => 42,
            'count_channels' => 3,
        ]);

        $exitCode = Artisan::call('reports:static:build', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('parsed', $payload['source_status']);
        $this->assertSame(4, $payload['targets']);
        $this->assertSame(4, $payload['would_generate']);
        $this->assertSame([], $payload['writes']);

        $this->assertSame('/home/urtube/html/group_chart_30.html', $payload['rows'][0]['output_path']);
        $this->assertSame('group_chart_30.html', $payload['rows'][0]['output_file']);
        $this->assertSame('/group_chart.php?days=30', $payload['rows'][0]['legacy_url']);
        $this->assertSame('/groups/media/ranking?days=30', $payload['rows'][0]['modern_url']);
        $this->assertSame('group-ranking', $payload['rows'][0]['report_type']);
        $this->assertTrue($payload['rows'][0]['dynamic_report_available']);
        $this->assertSame(7, $payload['rows'][0]['dynamic_rows']);
        $this->assertSame(1, $payload['rows'][0]['cache_rows']);

        $this->assertSame('/group_chart.php?days=30&group=media_all', $payload['rows'][1]['legacy_url']);
        $this->assertSame('/groups/media_all/ranking?days=30', $payload['rows'][1]['modern_url']);
        $this->assertSame('group-ranking', $payload['rows'][1]['report_type']);

        $this->assertSame('/group_line.php?days=30', $payload['rows'][2]['legacy_url']);
        $this->assertSame('/groups/media/trends?days=30', $payload['rows'][2]['modern_url']);
        $this->assertSame('group-trend', $payload['rows'][2]['report_type']);
        $this->assertSame(30, $payload['rows'][2]['dynamic_rows']);

        $this->assertFileDoesNotExist($this->legacyRoot.'/urtube/html/group_chart_30.html');
        $this->assertFileDoesNotExist($this->legacyRoot.'/urtube/html/group_line.html');
    }

    public function test_reports_static_build_uses_fallback_when_legacy_shell_is_not_mounted(): void
    {
        Schema::dropIfExists('urt_show_tag_date');
        config()->set('legacy.ground_truth_path', $this->legacyRoot.'/missing');

        $exitCode = Artisan::call('reports:static:build', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertStringStartsWith('fallback:', $payload['source_status']);
        $this->assertSame(4, $payload['targets']);
        $this->assertSame('/home/urtube/html/group_chart_30.html', $payload['rows'][0]['output_path']);
        $this->assertFalse($payload['rows'][0]['dynamic_report_available']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_static_preview_when_due(): void
    {
        $this->writeLegacyShell();
        config()->set('ingestion.scheduler_enabled', true);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 08:13:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.static.html',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
    }

    private function writeLegacyShell(): void
    {
        File::put(
            $this->legacyRoot.'/urtube/html/make_html.sh',
            "#!/bin/sh\n"
            ."#/usr/bin/php -d memory_limit=500M /home/urtube/group_people.php days=30 ratio=1 > /home/urtube/html/group_people_30.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/group_chart.php days=30 > /home/urtube/html/group_chart_30.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/group_chart.php days=30 group=media_all > /home/urtube/html/group_chart_all.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/group_line.php days=30 > /home/urtube/html/group_line.html\n"
            ."/usr/bin/php -d memory_limit=500M /home/urtube/group_chart.php days=7 > /home/urtube/html/group_chart.html\n",
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
        });
    }
}
