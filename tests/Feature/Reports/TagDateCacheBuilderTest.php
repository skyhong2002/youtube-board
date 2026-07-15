<?php

namespace Tests\Feature\Reports;

use App\Services\Ingestion\TagDateCacheBuilder;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagDateCacheBuilderTest extends TestCase
{
    public function test_invalid_calendar_dates_fail_closed_without_normalizing_or_writing_another_date(): void
    {
        $this->createTables();
        $this->seedRawData();
        $now = CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei');

        $payload = app(TagDateCacheBuilder::class)->buildRange(
            tagIds: [1],
            from: '2026-02-31',
            to: '2026-02-31',
            execute: true,
            now: $now,
        );
        $row = app(TagDateCacheBuilder::class)->build(
            tagIds: [1],
            date: '2026-02-31',
            execute: true,
            now: $now,
        );
        $commandExit = Artisan::call('reports:tag-date:build', [
            '--tagid' => '1',
            '--date' => '2026-02-31',
            '--execute' => true,
            '--json' => true,
        ]);

        $this->assertSame('blocked', $payload['status']);
        $this->assertSame('invalid_date_range', $payload['blocked_reason']);
        $this->assertSame('2026-02-31', $payload['from']);
        $this->assertSame('2026-02-31', $payload['to']);
        $this->assertSame(0, $payload['dates_selected']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame('blocked', $row['status']);
        $this->assertSame('invalid_date', $row['blocked_reason']);
        $this->assertSame('2026-02-31', $row['date']);
        $this->assertSame(0, $row['writes']);
        $this->assertSame(1, $row['exit_code']);
        $this->assertSame(1, $commandExit);
        $this->assertStringContainsString('valid calendar dates in YYYY-MM-DD', Artisan::output());
        $this->assertDatabaseCount('urt_show_tag_date', 0);
    }

    public function test_failed_date_is_sanitized_and_does_not_prevent_the_next_date(): void
    {
        $this->createTables();
        $this->seedRawData();
        Log::spy();

        DB::statement(<<<'SQL'
CREATE TRIGGER fail_first_tag_date
BEFORE INSERT ON urt_show_tag_date
WHEN NEW.the_date = '2026-06-04'
BEGIN
    SELECT RAISE(FAIL, 'token=tag-date-secret');
END
SQL);

        $builder = app(TagDateCacheBuilder::class);
        $payload = $builder->buildRange(
            tagIds: [1],
            from: '2026-06-04',
            to: '2026-06-05',
            keywordLimit: 10,
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
        );
        $failed = $payload['rows'][0];
        $succeeded = $payload['rows'][1];

        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(2, $payload['dates_requested']);
        $this->assertSame(2, $payload['dates_selected']);
        $this->assertFalse($payload['range_truncated']);
        $this->assertSame(1, $payload['failed_rows']);
        $this->assertSame(1, $payload['writes']);
        $this->assertSame('cache_rows_failed', $payload['failure_reason']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame('failed', $failed['status']);
        $this->assertSame(1, $failed['failed_rows']);
        $this->assertSame(1, $failed['exit_code']);
        $this->assertSame('cache_row_processing_failed', $failed['failure_reason']);
        $this->assertStringNotContainsString('tag-date-secret', json_encode($failed, JSON_THROW_ON_ERROR));
        $this->assertSame('success', $succeeded['status']);
        $this->assertSame(0, $succeeded['exit_code']);
        $this->assertSame(1, DB::table('urt_show_tag_date')->where('the_date', '2026-06-05')->count());
        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Tag date cache row failed.'
                    && $context['date'] === '2026-06-04'
                    && $context['failure_reason'] === 'cache_row_processing_failed'
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'tag-date-secret');
            })
            ->once();
        Log::shouldHaveReceived('warning')
            ->withArgs(function (string $message, array $context): bool {
                return $message === 'Tag date cache batch completed with failures.'
                    && $context['failed_rows'] === 1
                    && $context['writes'] === 1
                    && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), 'tag-date-secret');
            })
            ->once();
    }

    public function test_range_over_date_cap_is_blocked_before_any_partial_write(): void
    {
        $this->createTables();
        $this->seedRawData();

        $payload = app(TagDateCacheBuilder::class)->buildRange(
            tagIds: [1],
            from: '2026-06-04',
            to: '2026-06-05',
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
            maxDates: 1,
        );

        $this->assertSame('blocked', $payload['status']);
        $this->assertSame('date_range_limit_exceeded', $payload['blocked_reason']);
        $this->assertSame(2, $payload['dates_requested']);
        $this->assertSame(0, $payload['dates_selected']);
        $this->assertTrue($payload['range_truncated']);
        $this->assertTrue($payload['lists']['dates']['truncated']);
        $this->assertSame(0, $payload['lists']['dates']['selected']);
        $this->assertSame([], $payload['rows']);
        $this->assertSame(0, $payload['writes']);
        $this->assertSame(1, $payload['exit_code']);
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
    }

    public function test_video_scan_cap_isolates_incomplete_date_and_writes_complete_date(): void
    {
        $this->createTables();
        $this->seedRawData();
        DB::table('urt_video')->insert([
            'u_id' => 10,
            'videoId' => 'first-date-extra',
            'publishedAt' => '2026-06-04 11:00:00',
            'title' => '選舉追蹤',
            'description' => '',
            'viewCount' => 50,
        ]);

        $payload = app(TagDateCacheBuilder::class)->buildRange(
            tagIds: [1],
            from: '2026-06-04',
            to: '2026-06-05',
            keywordLimit: 10,
            videoLimit: 1,
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
        );

        $this->assertSame('partial_failure', $payload['status']);
        $this->assertSame(1, $payload['blocked_rows']);
        $this->assertSame(1, $payload['writes']);
        $this->assertFalse($payload['source_complete']);
        $this->assertSame('blocked', $payload['rows'][0]['status']);
        $this->assertSame('video_scan_limit_exceeded', $payload['rows'][0]['blocked_reason']);
        $this->assertSame(1, $payload['rows'][0]['videos_scanned']);
        $this->assertSame('success', $payload['rows'][1]['status']);
        $this->assertSame(['2026-06-05'], DB::table('urt_show_tag_date')->pluck('the_date')->all());
    }

    public function test_explicit_tag_and_keyword_lists_over_hard_caps_are_blocked(): void
    {
        $this->createTables();
        $this->seedRawData();
        $builder = app(TagDateCacheBuilder::class);

        $tagPayload = $builder->build(
            tagIds: range(1, 51),
            date: '2026-06-05',
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
        );
        $keywordPayload = $builder->build(
            tagIds: [1],
            date: '2026-06-05',
            onlyKeywords: array_map(fn (int $id): string => '詞'.$id, range(1, 501)),
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
        );

        $this->assertSame('tagid_list_limit_exceeded', $tagPayload['blocked_reason']);
        $this->assertTrue($tagPayload['lists']['tagid']['truncated']);
        $this->assertSame('keyword_list_limit_exceeded', $keywordPayload['blocked_reason']);
        $this->assertTrue($keywordPayload['lists']['keywords']['truncated']);
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
    }

    public function test_channel_and_keyword_source_caps_block_incomplete_rows(): void
    {
        $this->createTables();
        $this->seedRawData();
        DB::table('urt_count')->insert(['u_id' => 20, 'tags' => '[1]']);
        DB::table('tags')->insert([
            'tag' => '政策',
            'max_count' => 8,
            'hours_count' => 4,
            'max_hours' => '2026-06-05 12:00:00',
            'no_tag' => null,
        ]);
        $builder = app(TagDateCacheBuilder::class);

        $channels = $builder->build(
            tagIds: [1],
            date: '2026-06-05',
            channelLimit: 1,
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
        );
        $keywords = $builder->build(
            tagIds: [1],
            date: '2026-06-05',
            keywordLimit: 1,
            execute: true,
            now: CarbonImmutable::parse('2026-06-05 12:00:00', 'Asia/Taipei'),
        );

        $this->assertSame('channel_scan_limit_exceeded', $channels['blocked_reason']);
        $this->assertSame('keyword_scan_limit_exceeded', $keywords['blocked_reason']);
        $this->assertSame(0, DB::table('urt_show_tag_date')->count());
    }

    private function createTables(): void
    {
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

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
            $table->integer('count_channels')->nullable();
            $table->integer('count_videos')->nullable();
            $table->integer('count_tags')->nullable();
            $table->date('the_date');
            $table->integer('tags_count')->nullable();
            $table->integer('total_views')->nullable();
            $table->longText('tags_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
        });
    }

    private function seedRawData(): void
    {
        DB::table('tags')->insert([
            'tag' => '選舉',
            'max_count' => 10,
            'hours_count' => 5,
            'max_hours' => '2026-06-05 12:00:00',
            'no_tag' => null,
        ]);
        DB::table('urt_count')->insert(['u_id' => 10, 'tags' => '[1]']);
        DB::table('urt_video')->insert([
            ['u_id' => 10, 'videoId' => 'first-date', 'publishedAt' => '2026-06-04 10:00:00', 'title' => '選舉新聞', 'description' => '', 'viewCount' => 100],
            ['u_id' => 10, 'videoId' => 'second-date', 'publishedAt' => '2026-06-05 10:00:00', 'title' => '選舉分析', 'description' => '', 'viewCount' => 200],
        ]);
    }
}
