<?php

namespace Tests\Feature\Reports;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ChannelCloudBuildCommandTest extends TestCase
{
    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();

        parent::tearDown();
    }

    public function test_dry_run_does_not_write_rows(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '3',
            '--keyword-limit' => '100',
        ])->assertSuccessful();

        $this->assertSame(0, DB::table('urt_show_cloud')->count());
    }

    public function test_execute_writes_channel_cloud_cache(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '3,7',
            '--keyword-limit' => '100',
            '--execute' => true,
        ])->assertSuccessful();

        $this->assertSame(2, DB::table('urt_show_cloud')->count());

        $row = DB::table('urt_show_cloud')->where('u_id', 10)->where('days', 3)->first();
        $this->assertNotNull($row);
        $this->assertNotNull($row->keywords_json);

        $decoded = json_decode($row->keywords_json, true);
        $this->assertIsArray($decoded);
        $this->assertArrayHasKey('選舉', $decoded);
        $this->assertArrayHasKey('政策', $decoded);
    }

    public function test_execute_upserts_existing_channel_period_row(): void
    {
        $this->createTables();
        $this->seedRawData();

        $arguments = [
            '--u_id' => '10',
            '--days' => '3',
            '--keyword-limit' => '100',
            '--execute' => true,
        ];

        $this->artisan('reports:channel-cloud:build', $arguments)->assertSuccessful();
        $firstPk = DB::table('urt_show_cloud')->value('pk');

        $this->artisan('reports:channel-cloud:build', $arguments)->assertSuccessful();

        $this->assertSame(1, DB::table('urt_show_cloud')->count());
        $this->assertSame($firstPk, DB::table('urt_show_cloud')->value('pk'));
    }

    public function test_without_u_id_selects_recent_channels_with_limit(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:channel-cloud:build', [
            '--days' => '3',
            '--limit' => '1',
            '--recent-days' => '7',
            '--keyword-limit' => '100',
            '--execute' => true,
        ])->assertSuccessful();

        $this->assertSame(1, DB::table('urt_show_cloud')->count());
        $this->assertSame(20, (int) DB::table('urt_show_cloud')->value('u_id'));
    }

    public function test_json_output_mode(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '3',
            '--keyword-limit' => '100',
            '--json' => true,
        ])->assertSuccessful();
    }

    public function test_build_many_isolates_failed_channel_period_and_returns_nonzero_summary(): void
    {
        $this->createTables();
        $this->seedRawData();
        Log::spy();

        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_channel_cloud
BEFORE INSERT ON urt_show_cloud
WHEN NEW.u_id = 10 AND NEW.days = 3
BEGIN
    SELECT RAISE(FAIL, 'token=channel-cloud-secret');
END
SQL);

        $exitCode = Artisan::call('reports:channel-cloud:build', [
            '--u_id' => '10,20',
            '--days' => '3',
            '--keyword-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('success', $payload['rows'][1]['status']);
        $this->assertStringNotContainsString('channel-cloud-secret', json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertSame(0, DB::table('urt_show_cloud')->where('u_id', 10)->count());
        $this->assertSame(1, DB::table('urt_show_cloud')->where('u_id', 20)->count());
        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Channel cloud cache row failed.'
                    && $context['u_id'] === 10
                    && $context['failure_reason'] === 'cache_row_processing_failed'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'channel-cloud-secret');
            })
            ->once();
    }

    private function createTables(): void
    {
        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->integer('u_id');
            $table->string('videoId');
            $table->dateTime('publishedAt');
            $table->string('title')->nullable();
            $table->text('description')->nullable();
            $table->integer('viewCount')->default(0);
        });

        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->integer('max_count')->default(0);
            $table->integer('hours_count')->default(0);
            $table->string('max_hours')->nullable();
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_show_cloud', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->integer('u_id');
            $table->integer('days');
            $table->longText('keywords_json')->nullable();
        });
    }

    private function seedRawData(): void
    {
        $now = CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei');
        CarbonImmutable::setTestNow($now);

        DB::table('tags')->insert([
            ['tag' => '選舉', 'max_count' => 10, 'hours_count' => 5, 'max_hours' => $now->subDays(2)->format('Y-m-d H:i:s'), 'no_tag' => null],
            ['tag' => '政策', 'max_count' => 8, 'hours_count' => 4, 'max_hours' => $now->subDays(1)->format('Y-m-d H:i:s'), 'no_tag' => null],
            ['tag' => '新聞', 'max_count' => 20, 'hours_count' => 10, 'max_hours' => $now->format('Y-m-d H:i:s'), 'no_tag' => null],
        ]);

        DB::table('urt_video')->insert([
            ['u_id' => 10, 'videoId' => 'v1', 'publishedAt' => $now->subDays(1)->format('Y-m-d H:i:s'), 'title' => '選舉政策新聞報導', 'description' => '關於選舉政策的詳細分析', 'viewCount' => 1000],
            ['u_id' => 10, 'videoId' => 'v2', 'publishedAt' => $now->subDays(2)->format('Y-m-d H:i:s'), 'title' => '新聞選舉專題', 'description' => '選舉新聞專題報導', 'viewCount' => 2000],
            ['u_id' => 20, 'videoId' => 'v3', 'publishedAt' => $now->subHours(6)->format('Y-m-d H:i:s'), 'title' => '政策新聞分析', 'description' => '最新政策新聞分析', 'viewCount' => 500],
        ]);
    }
}
