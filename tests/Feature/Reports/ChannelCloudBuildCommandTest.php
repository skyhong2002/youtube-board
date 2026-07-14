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

    public function test_subset_rebuild_updates_selected_keyword_without_erasing_omitted_cache_keywords(): void
    {
        $this->createTables();
        $this->seedRawData();
        $baseArguments = [
            '--u_id' => '10',
            '--days' => '3',
            '--keyword-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ];

        $this->assertSame(0, Artisan::call('reports:channel-cloud:build', $baseArguments));
        $beforeRow = DB::table('urt_show_cloud')->first();
        $before = json_decode($beforeRow->keywords_json, true, flags: JSON_THROW_ON_ERROR);
        $this->assertArrayHasKey('政策', $before);
        $this->assertArrayHasKey('選舉', $before);

        DB::table('urt_video')->where('u_id', 10)->update([
            'title' => '選舉新聞',
            'description' => '選舉新聞',
        ]);
        $exitCode = Artisan::call('reports:channel-cloud:build', $baseArguments + [
            '--keywords' => '政策',
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);
        $afterRow = DB::table('urt_show_cloud')->first();
        $after = json_decode($afterRow->keywords_json, true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('merge_selected_keywords', $payload['rows'][0]['cache_merge_mode']);
        $this->assertArrayNotHasKey('政策', $after);
        $this->assertSame($before['選舉'], $after['選舉']);
    }

    public function test_subset_rebuild_fails_closed_on_malformed_existing_cache(): void
    {
        $this->createTables();
        $this->seedRawData();
        DB::table('urt_show_cloud')->insert([
            'ctime' => '2026-06-01 00:00:00',
            'u_id' => 10,
            'days' => 3,
            'keywords_json' => '{malformed-cache',
        ]);

        $exitCode = Artisan::call('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '3',
            '--keywords' => '政策',
            '--keyword-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('cache_row_processing_failed', $payload['rows'][0]['failure_reason']);
        $this->assertSame('{malformed-cache', DB::table('urt_show_cloud')->value('keywords_json'));
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

    public function test_explicit_channel_period_and_keyword_lists_over_hard_caps_are_blocked(): void
    {
        $this->createTables();
        $this->seedRawData();
        $cases = [
            [
                'arguments' => ['--u_id' => implode(',', range(1, 501)), '--days' => '3'],
                'reason' => 'channel_id_list_limit_exceeded',
                'list' => 'channels',
            ],
            [
                'arguments' => ['--u_id' => '10', '--days' => implode(',', range(1, 11))],
                'reason' => 'period_list_limit_exceeded',
                'list' => 'periods',
            ],
            [
                'arguments' => ['--u_id' => '10', '--days' => '3', '--keywords' => implode(',', array_map(fn (int $id): string => '詞'.$id, range(1, 501)))],
                'reason' => 'keyword_list_limit_exceeded',
                'list' => 'keywords',
            ],
        ];

        foreach ($cases as $case) {
            $exitCode = Artisan::call('reports:channel-cloud:build', $case['arguments'] + [
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame(1, $exitCode);
            $this->assertSame('blocked', $payload['status']);
            $this->assertSame($case['reason'], $payload['blocked_reason']);
            $this->assertTrue($payload['source_truncated']);
            $this->assertTrue($payload['lists'][$case['list']]['truncated']);
            $this->assertSame(0, $payload['lists'][$case['list']]['selected']);
            $this->assertSame([], $payload['rows']);
            $this->assertSame(0, $payload['writes']);
        }

        $this->assertSame(0, DB::table('urt_show_cloud')->count());
    }

    public function test_video_scan_cap_blocks_only_incomplete_channel_period_and_preserves_existing_cache(): void
    {
        $this->createTables();
        $this->seedRawData();

        Artisan::call('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '3',
            '--keyword-limit' => 100,
            '--video-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ]);
        $existing = DB::table('urt_show_cloud')->where('u_id', 10)->where('days', 3)->value('keywords_json');

        $exitCode = Artisan::call('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '1,3',
            '--keyword-limit' => 100,
            '--video-limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame(1, $payload['blocked_rows']);
        $this->assertSame('success', $payload['rows'][0]['status']);
        $this->assertSame('blocked', $payload['rows'][1]['status']);
        $this->assertSame('video_scan_limit_exceeded', $payload['rows'][1]['blocked_reason']);
        $this->assertSame(1, $payload['rows'][1]['videos_scanned']);
        $this->assertSame(1, DB::table('urt_show_cloud')->where('u_id', 10)->where('days', 1)->count());
        $this->assertSame($existing, DB::table('urt_show_cloud')->where('u_id', 10)->where('days', 3)->value('keywords_json'));
    }

    public function test_recent_channel_target_selection_reports_truncation_without_incomplete_per_target_source(): void
    {
        $this->createTables();
        $this->seedRawData();

        $exitCode = Artisan::call('reports:channel-cloud:build', [
            '--days' => '3',
            '--limit' => 1,
            '--recent-days' => 7,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertTrue($payload['channel_selection_truncated']);
        $this->assertTrue($payload['source_complete']);
        $this->assertFalse($payload['source_truncated']);
        $this->assertSame(1, $payload['channels_selected']);
        $this->assertSame(2, $payload['channel_selection_candidates']);
        $this->assertSame(0, $payload['channel_selection_offset']);
        $this->assertSame(1, $payload['channel_selection_next_offset']);
        $this->assertSame(1, $payload['caps']['channel_selection']);
    }

    public function test_recent_channel_target_selection_supports_wrapped_cursor(): void
    {
        $this->createTables();
        $this->seedRawData();

        $exitCode = Artisan::call('reports:channel-cloud:build', [
            '--days' => '3',
            '--limit' => 2,
            '--offset' => 1,
            '--recent-days' => 7,
            '--keyword-limit' => 100,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame([10, 20], $payload['channel_ids']);
        $this->assertSame(2, $payload['channel_selection_candidates']);
        $this->assertSame(1, $payload['channel_selection_offset']);
        $this->assertSame('explicit', $payload['channel_selection_offset_mode']);
        $this->assertSame(1, $payload['channel_selection_next_offset']);
        $this->assertTrue($payload['channel_selection_wrapped']);
        $this->assertFalse($payload['channel_selection_truncated']);
    }

    public function test_keyword_source_scan_cap_blocks_cache_publication(): void
    {
        $this->createTables();
        $this->seedRawData();

        $exitCode = Artisan::call('reports:channel-cloud:build', [
            '--u_id' => '10',
            '--days' => '3',
            '--keyword-limit' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('blocked', $payload['status']);
        $this->assertSame('keyword_scan_limit_exceeded', $payload['rows'][0]['blocked_reason']);
        $this->assertSame(0, DB::table('urt_show_cloud')->count());
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
