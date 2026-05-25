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

class ReadOnlyLiveStaticCommandTest extends TestCase
{
    private string $legacyRoot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->legacyRoot = storage_path('framework/testing-legacy-live-static');
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

    public function test_reports_live_static_previews_legacy_static_target_without_writing_html(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));
        $this->createLegacyLiveTables();
        $this->writeLegacyShell();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => 'News'],
            ['tag_id' => 2, 'tag_name' => 'Politics'],
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 10,
            'tags' => '[1][2]',
        ]);
        DB::table('urt_video_live')->insert([
            'videoId' => 'static-live',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 17:00:00',
            'actualStartTime' => '2026-05-24 17:10:00',
            'scheduledStartTime' => null,
            'actualEndTime' => null,
            'concurrentViewers' => 1500,
            'mtime' => '2026-05-24 17:50:00',
            'max_current' => 2400,
        ]);
        DB::table('urt_show_video_live')->insert([
            'pk_live' => 1,
            'videoId' => 'static-live',
            'u_id' => 10,
            'publishedAt' => '2026-05-24 17:00:00',
            'channelTitle' => 'Static Channel',
            'title' => 'Static Live Title',
            'thumbnails' => 'https://example.test/static.jpg',
        ]);
        DB::table('urt_video_live_log')->insert([
            'videoId' => 'static-live',
            'u_id' => 10,
            'the_date' => '2026-05-24',
            'max_current' => 2000,
            'log_json' => json_encode(['17:40' => 900, '17:50' => 1500], JSON_UNESCAPED_UNICODE),
        ]);

        $exitCode = Artisan::call('reports:live:static', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('read-only-preview', $payload['mode']);
        $this->assertSame('parsed', $payload['source_status']);
        $this->assertSame(1, $payload['targets']);
        $this->assertSame(1, $payload['would_generate']);
        $this->assertSame([], $payload['writes']);
        $this->assertSame('/home/urtube/html/live_social.html', $payload['rows'][0]['output_path']);
        $this->assertSame('live_social.html', $payload['rows'][0]['output_file']);
        $this->assertSame('/live.php?or=1%2C2%2C12%2C13%2C14%2C81', $payload['rows'][0]['legacy_url']);
        $this->assertSame('/live/current?or=1%2C2%2C12%2C13%2C14%2C81', $payload['rows'][0]['modern_url']);
        $this->assertTrue($payload['rows'][0]['dynamic_report_available']);
        $this->assertSame(1, $payload['rows'][0]['dynamic_rows']);
        $this->assertFileDoesNotExist($this->legacyRoot.'/urtube/html/live_social.html');
    }

    public function test_reports_live_static_uses_fallback_when_legacy_shell_is_not_mounted(): void
    {
        config()->set('legacy.ground_truth_path', $this->legacyRoot.'/missing');

        $exitCode = Artisan::call('reports:live:static', [
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertStringStartsWith('fallback:', $payload['source_status']);
        $this->assertSame(1, $payload['targets']);
        $this->assertSame('/home/urtube/html/live_social.html', $payload['rows'][0]['output_path']);
        $this->assertFalse($payload['rows'][0]['dynamic_report_available']);
    }

    public function test_ingestion_scheduler_can_execute_read_only_live_static_preview_when_due(): void
    {
        $this->writeLegacyShell();
        config()->set('ingestion.scheduler_enabled', true);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 00:19:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.live.static',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed', $result['jobs'][0]['action']);
    }

    private function writeLegacyShell(): void
    {
        File::put(
            $this->legacyRoot.'/urtube/html/make_live.sh',
            "#!/bin/sh\n/usr/bin/php -d memory_limit=500M /home/urtube/live.php or=1,2,12,13,14,81 > /home/urtube/html/live_social.html\n# ignored\n",
        );
    }

    private function createLegacyLiveTables(): void
    {
        foreach (['urt_video_live_log', 'urt_show_video_live', 'urt_video_live', 'urt_count', 'urt_tag'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

        Schema::create('urt_video_live', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->dateTime('actualStartTime')->nullable();
            $table->dateTime('scheduledStartTime')->nullable();
            $table->dateTime('actualEndTime')->nullable();
            $table->integer('concurrentViewers')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->integer('max_current')->nullable();
        });

        Schema::create('urt_show_video_live', function ($table): void {
            $table->integer('pk_live');
            $table->string('videoId');
            $table->integer('u_id');
            $table->dateTime('publishedAt');
            $table->string('channelTitle');
            $table->string('title');
            $table->string('thumbnails')->nullable();
        });

        Schema::create('urt_video_live_log', function ($table): void {
            $table->string('videoId');
            $table->integer('u_id')->nullable();
            $table->date('the_date');
            $table->integer('max_current')->nullable();
            $table->text('log_json')->nullable();
        });
    }
}
