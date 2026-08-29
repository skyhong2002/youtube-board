<?php

namespace Tests\Feature\Reports;

use App\Services\Ingestion\IngestionJobRegistry;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagCloudBuildCommandTest extends TestCase
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

        $this->artisan('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => '100',
        ])->assertSuccessful();

        $this->assertSame(0, DB::table('urt_show_tag_cloud')->count());
    }

    public function test_execute_writes_tag_cloud_cache(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => '100',
            '--execute' => true,
        ])->assertSuccessful();

        $this->assertSame(1, DB::table('urt_show_tag_cloud')->count());

        $row = DB::table('urt_show_tag_cloud')->first();
        $this->assertSame('1', $row->tagid);
        $this->assertSame(3, (int) $row->days);
        $this->assertGreaterThan(0, (int) $row->tags_count);
        $this->assertNotNull($row->tags_result);

        $decoded = json_decode($row->tags_result, true);
        $this->assertIsArray($decoded);
        $this->assertNotEmpty($decoded);
    }

    public function test_execute_builds_multiple_day_periods(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3,7',
            '--keyword-limit' => '100',
            '--execute' => true,
        ])->assertSuccessful();

        $this->assertSame(2, DB::table('urt_show_tag_cloud')->count());
        $this->assertSame(1, DB::table('urt_show_tag_cloud')->where('days', 3)->count());
        $this->assertSame(1, DB::table('urt_show_tag_cloud')->where('days', 7)->count());
    }

    public function test_requires_tagid_option(): void
    {
        $this->artisan('reports:tag-cloud:build', [
            '--days' => '3',
        ])->assertFailed();
    }

    public function test_json_output_mode(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => '100',
            '--json' => true,
        ])->assertSuccessful();
    }

    public function test_execute_upserts_existing_row(): void
    {
        $this->createTables();
        $this->seedRawData();

        $this->artisan('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => '100',
            '--execute' => true,
        ])->assertSuccessful();

        $firstPk = DB::table('urt_show_tag_cloud')->value('pk');

        $this->artisan('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => '100',
            '--execute' => true,
        ])->assertSuccessful();

        $this->assertSame(1, DB::table('urt_show_tag_cloud')->count());
        $this->assertSame($firstPk, DB::table('urt_show_tag_cloud')->value('pk'));
    }

    public function test_subset_rebuild_updates_selected_keyword_without_erasing_omitted_cache_keywords(): void
    {
        $this->createTables();
        $this->seedRawData();
        $baseArguments = [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ];

        $this->assertSame(0, Artisan::call('reports:tag-cloud:build', $baseArguments));
        $beforeRow = DB::table('urt_show_tag_cloud')->first();
        $before = json_decode($beforeRow->tags_result, true, flags: JSON_THROW_ON_ERROR);
        $this->assertArrayHasKey('政策', $before);
        $this->assertArrayHasKey('選舉', $before);

        DB::table('urt_video')->update([
            'title' => '選舉新聞',
            'description' => '選舉新聞',
        ]);
        $exitCode = Artisan::call('reports:tag-cloud:build', $baseArguments + [
            '--keywords' => '政策',
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);
        $afterRow = DB::table('urt_show_tag_cloud')->first();
        $after = json_decode($afterRow->tags_result, true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode);
        $this->assertSame('merge_selected_keywords', $payload['rows'][0]['cache_merge_mode']);
        $this->assertArrayNotHasKey('政策', $after);
        $this->assertSame($before['選舉'], $after['選舉']);
        $this->assertSame((int) $beforeRow->count_tags, (int) $afterRow->count_tags);
    }

    public function test_subset_rebuild_fails_closed_on_malformed_existing_cache(): void
    {
        $this->createTables();
        $this->seedRawData();
        DB::table('urt_show_tag_cloud')->insert([
            'ctime' => '2026-06-01 00:00:00',
            'tagid' => '1',
            'days' => 3,
            'count_tags' => 99,
            'tags_result' => '{malformed-cache',
        ]);

        $exitCode = Artisan::call('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keywords' => '政策',
            '--keyword-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('failed', $payload['rows'][0]['status']);
        $this->assertSame('cache_period_processing_failed', $payload['rows'][0]['failure_reason']);
        $this->assertSame('{malformed-cache', DB::table('urt_show_tag_cloud')->value('tags_result'));
        $this->assertSame(99, (int) DB::table('urt_show_tag_cloud')->value('count_tags'));
    }

    public function test_failed_period_is_sanitized_and_does_not_prevent_the_next_period(): void
    {
        $this->createTables();
        $this->seedRawData();
        Log::spy();

        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_tag_cloud_period
BEFORE INSERT ON urt_show_tag_cloud
WHEN NEW.days = 3
BEGIN
    SELECT RAISE(FAIL, 'token=tag-cloud-secret');
END
SQL);

        $exitCode = Artisan::call('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3,7',
            '--keyword-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);
        [$failed, $succeeded] = $payload['rows'];

        $this->assertSame(1, $exitCode);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame('failed', $failed['status']);
        $this->assertSame(1, $failed['failed_rows']);
        $this->assertSame(1, $failed['exit_code']);
        $this->assertSame('cache_period_processing_failed', $failed['failure_reason']);
        $this->assertStringNotContainsString('tag-cloud-secret', json_encode($failed, JSON_THROW_ON_ERROR));
        $this->assertSame('success', $succeeded['status']);
        $this->assertSame(0, $succeeded['exit_code']);
        $this->assertSame(1, DB::table('urt_show_tag_cloud')->where('days', 7)->count());
        Log::shouldHaveReceived('warning')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Tag cloud cache period failed.'
                    && $context['days'] === 3
                    && $context['failure_reason'] === 'cache_period_processing_failed'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'tag-cloud-secret');
            });
    }

    public function test_explicit_tag_period_and_keyword_lists_over_hard_caps_are_blocked_before_processing(): void
    {
        $this->createTables();
        $this->seedRawData();
        $cases = [
            [
                'arguments' => ['--tagid' => implode(',', range(1, 51)), '--days' => '3'],
                'reason' => 'tagid_list_limit_exceeded',
                'list' => 'tagid',
            ],
            [
                'arguments' => ['--tagid' => '1', '--days' => implode(',', range(1, 11))],
                'reason' => 'period_list_limit_exceeded',
                'list' => 'periods',
            ],
            [
                'arguments' => ['--tagid' => '1', '--days' => '3', '--keywords' => implode(',', array_map(fn (int $id): string => '詞'.$id, range(1, 501)))],
                'reason' => 'keyword_list_limit_exceeded',
                'list' => 'keywords',
            ],
        ];

        foreach ($cases as $case) {
            $exitCode = Artisan::call('reports:tag-cloud:build', $case['arguments'] + [
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame(1, $exitCode);
            $this->assertSame('blocked', $payload['status']);
            $this->assertSame($case['reason'], $payload['blocked_reason']);
            $this->assertTrue($payload['source_truncated']);
            $this->assertFalse($payload['source_complete']);
            $this->assertTrue($payload['lists'][$case['list']]['truncated']);
            $this->assertSame(0, $payload['lists'][$case['list']]['selected']);
            $this->assertSame([], $payload['rows']);
            $this->assertSame(0, $payload['writes']);
        }

        $this->assertSame(0, DB::table('urt_show_tag_cloud')->count());
    }

    public function test_video_scan_cap_blocks_only_incomplete_period_and_preserves_existing_cache(): void
    {
        $now = CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei');
        CarbonImmutable::setTestNow($now);
        $this->createTables();
        $this->seedRawData();

        Artisan::call('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--keyword-limit' => 100,
            '--video-limit' => 100,
            '--execute' => true,
            '--json' => true,
        ]);
        $existing = DB::table('urt_show_tag_cloud')->where('days', 3)->value('tags_result');

        $exitCode = Artisan::call('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '1,3',
            '--keyword-limit' => 100,
            '--video-limit' => 2,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame(1, $payload['blocked_rows']);
        $this->assertFalse($payload['source_complete']);
        $this->assertSame('success', $payload['rows'][0]['status']);
        $this->assertSame('blocked', $payload['rows'][1]['status']);
        $this->assertSame('video_scan_limit_exceeded', $payload['rows'][1]['blocked_reason']);
        $this->assertSame(2, $payload['rows'][1]['videos_scanned']);
        $this->assertSame(2, $payload['rows'][1]['caps']['video_scan_per_period']);
        $this->assertSame(1, DB::table('urt_show_tag_cloud')->where('days', 1)->count());
        $this->assertSame($existing, DB::table('urt_show_tag_cloud')->where('days', 3)->value('tags_result'));
    }

    public function test_source_channel_scan_cap_blocks_cache_publication(): void
    {
        $this->createTables();
        $this->seedRawData();

        $exitCode = Artisan::call('reports:tag-cloud:build', [
            '--tagid' => '1',
            '--days' => '3',
            '--channel-limit' => 1,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertSame('blocked', $payload['status']);
        $this->assertSame('channel_scan_limit_exceeded', $payload['rows'][0]['blocked_reason']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(0, DB::table('urt_show_tag_cloud')->count());
    }

    public function test_scheduled_cache_build_commands_declare_source_caps_explicitly(): void
    {
        $registry = app(IngestionJobRegistry::class);
        $commands = [
            'reports.tag_cloud.build' => ['--channel-limit=1000', '--video-limit=50000', '--keyword-limit=1000'],
            'reports.channel_cloud.build' => ['--limit=50', '--offset=auto', '--video-limit=10000', '--keyword-limit=5000'],
            'reports.tag_date.build' => ['--days=2', '--date-limit=400', '--channel-limit=1000', '--video-limit=10000', '--keyword-limit=1000'],
        ];

        foreach ($commands as $key => $options) {
            $command = (string) $registry->find($key)['scheduled_execute_command'];

            foreach ($options as $option) {
                $this->assertStringContainsString($option, $command);
            }
        }

        $tagCloudCommand = (string) $registry->find('reports.tag_cloud.build')['scheduled_execute_command'];
        $this->assertStringContainsString('--tagid=1 ', $tagCloudCommand);
        $this->assertStringNotContainsString('--tagid=1,2,3,4,5,6,13,14,81', $tagCloudCommand);
    }

    private function createTables(): void
    {
        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
        });

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

        Schema::create('urt_show_tag_cloud', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->integer('days');
            $table->integer('tags_count')->nullable();
            $table->longText('tags_result')->nullable();
        });

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '社論'],
        ]);
    }

    private function seedRawData(): void
    {
        $now = CarbonImmutable::now('Asia/Taipei');

        DB::table('tags')->insert([
            ['tag' => '選舉', 'max_count' => 10, 'hours_count' => 5, 'max_hours' => $now->subDays(2)->format('Y-m-d H:i:s'), 'no_tag' => null],
            ['tag' => '政策', 'max_count' => 8, 'hours_count' => 4, 'max_hours' => $now->subDays(1)->format('Y-m-d H:i:s'), 'no_tag' => null],
            ['tag' => '新聞', 'max_count' => 20, 'hours_count' => 10, 'max_hours' => $now->format('Y-m-d H:i:s'), 'no_tag' => null],
        ]);

        DB::table('urt_count')->insert([
            ['u_id' => 100, 'tags' => '[1]'],
            ['u_id' => 200, 'tags' => '[1][2]'],
        ]);

        DB::table('urt_video')->insert([
            ['u_id' => 100, 'videoId' => 'v1', 'publishedAt' => $now->subDays(1)->format('Y-m-d H:i:s'), 'title' => '選舉政策新聞報導', 'description' => '關於選舉政策的詳細分析', 'viewCount' => 1000],
            ['u_id' => 100, 'videoId' => 'v2', 'publishedAt' => $now->subDays(2)->format('Y-m-d H:i:s'), 'title' => '新聞選舉專題', 'description' => '選舉新聞專題報導', 'viewCount' => 2000],
            ['u_id' => 200, 'videoId' => 'v3', 'publishedAt' => $now->subHours(12)->format('Y-m-d H:i:s'), 'title' => '政策新聞分析', 'description' => '最新政策新聞分析', 'viewCount' => 500],
        ]);
    }
}
