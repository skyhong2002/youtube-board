<?php

namespace Tests\Feature\Ops;

use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class IngestionPeopleBuildCommandTest extends TestCase
{
    public function test_reports_people_build_previews_legacy_tag_period_jobs_with_cache_job_preview(): void
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
        $this->assertSame('ingestion-preview', $payload['mode']);
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

    public function test_ingestion_scheduler_can_execute_ingestion_people_preview_when_due(): void
    {
        $this->createTables();
        config()->set('ingestion.scheduler_enabled', true);
        config()->set('ingestion.local_polling_enabled', true);
        config()->set('ingestion.scheduled_write_allowlist', ['reports.people.build']);

        $result = app(IngestionSchedulerRunner::class)->run(
            at: CarbonImmutable::parse('2026-05-25 03:27:00', 'Asia/Taipei'),
            execute: true,
            jobKey: 'reports.people.build',
        );

        $this->assertSame('execute', $result['mode']);
        $this->assertSame(['evaluated' => 1, 'due' => 1, 'executed' => 1, 'skipped' => 0, 'failed' => 0], $result['summary']);
        $this->assertSame('executed:local-polling', $result['jobs'][0]['action']);
    }

    public function test_reports_people_build_execute_writes_people_tag_date_cache(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('tag_group')->insert([
            'ctime' => '2026-05-20 10:00:00',
            'latest_time' => '2026-05-24 10:00:00',
            'tag' => '柯文哲',
            'group_name' => '政治人物',
            'del_flag' => '0',
        ]);
        DB::table('tags')->insert([
            'tag' => '柯文哲',
            'ctime' => '2026-05-25 10:00:00',
            'mtime' => '2026-05-25 10:00:00',
            'max_count' => 100,
            'hours_count' => 50,
            'max_hours' => '2026-05-25 10:00:00',
            'no_tag' => 0,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 1001,
            'tags' => '[13]',
        ]);
        DB::table('urt_video')->insert([
            'u_id' => 1001,
            'videoId' => 'video-1',
            'publishedAt' => '2026-05-25 08:00:00',
            'title' => '柯文哲 柯文哲 新聞',
            'description' => '柯文哲',
            'viewCount' => 1234,
        ]);

        $exitCode = Artisan::call('reports:people:build', [
            '--execute' => true,
            '--days' => 1,
            '--limit' => 1,
            '--keyword-limit' => 10,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('execute', $payload['mode']);
        $this->assertSame(1, $payload['cache_writes']);
        $this->assertSame(['urt_show_tag_date'], $payload['writes']);
        $this->assertSame(1, DB::table('urt_show_tag_date')->count());
        $this->assertSame('13', DB::table('urt_show_tag_date')->value('tagid'));
        $this->assertSame('2026-05-25', DB::table('urt_show_tag_date')->value('the_date'));
        $this->assertStringContainsString('柯文哲', (string) DB::table('urt_show_tag_date')->value('tags_result'));
    }

    public function test_reports_people_build_execute_scans_focused_keywords_missing_from_tags_table(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('tag_group')->insert([
            'ctime' => '2026-05-20 10:00:00',
            'latest_time' => '2026-05-24 10:00:00',
            'tag' => '陳瑩',
            'group_name' => '政治人物',
            'del_flag' => '0',
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 1001,
            'tags' => '[13]',
        ]);
        DB::table('urt_video')->insert([
            'u_id' => 1001,
            'videoId' => 'video-1',
            'publishedAt' => '2026-05-25 08:00:00',
            'title' => '陳瑩 台東新聞',
            'description' => '陳瑩',
            'viewCount' => 4321,
        ]);

        $exitCode = Artisan::call('reports:people:build', [
            '--execute' => true,
            '--days' => 1,
            '--limit' => 1,
            '--keyword-limit' => 10,
            '--json' => true,
        ]);
        $tagsViews = json_decode((string) DB::table('urt_show_tag_date')->value('tags_views'), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, DB::table('urt_show_tag_date')->count());
        $this->assertSame(4321, $tagsViews['陳瑩']);
    }

    public function test_reports_people_build_execute_merges_focused_keywords_into_existing_tag_date_cache(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-05-25 12:00:00', 'Asia/Taipei'));
        $this->createTables();

        DB::table('tag_group')->insert([
            'ctime' => '2026-05-20 10:00:00',
            'latest_time' => '2026-05-24 10:00:00',
            'tag' => '柯文哲',
            'group_name' => '政治人物',
            'del_flag' => '0',
        ]);
        DB::table('tags')->insert([
            'tag' => '柯文哲',
            'ctime' => '2026-05-25 10:00:00',
            'mtime' => '2026-05-25 10:00:00',
            'max_count' => 100,
            'hours_count' => 50,
            'max_hours' => '2026-05-25 10:00:00',
            'no_tag' => 0,
        ]);
        DB::table('urt_count')->insert([
            'u_id' => 1001,
            'tags' => '[13]',
        ]);
        DB::table('urt_video')->insert([
            'u_id' => 1001,
            'videoId' => 'video-1',
            'publishedAt' => '2026-05-25 08:00:00',
            'title' => '柯文哲 柯文哲 新聞',
            'description' => '柯文哲',
            'viewCount' => 1234,
        ]);
        DB::table('urt_show_tag_date')->insert([
            'ctime' => '2026-05-24 10:00:00',
            'mtime' => '2026-05-24 10:00:00',
            'stime' => '2026-05-24 10:00:00',
            'count_channels' => 10,
            'count_videos' => 50,
            'count_tags' => 500,
            'the_date' => '2026-05-25',
            'tags_count' => 1,
            'total_views' => 9999,
            'tags_result' => json_encode(['既有關鍵字' => '7.500'], JSON_UNESCAPED_UNICODE),
            'tags_video' => json_encode(['既有關鍵字' => 2], JSON_UNESCAPED_UNICODE),
            'tags_views' => json_encode(['既有關鍵字' => 300], JSON_UNESCAPED_UNICODE),
            'tagid' => '13',
            'tag_or' => null,
            'tag_not' => null,
        ]);

        $exitCode = Artisan::call('reports:people:build', [
            '--execute' => true,
            '--days' => 1,
            '--limit' => 1,
            '--keyword-limit' => 10,
            '--json' => true,
        ]);
        $row = DB::table('urt_show_tag_date')->where('tagid', '13')->where('the_date', '2026-05-25')->first();
        $tagsResult = json_decode((string) $row->tags_result, true);
        $tagsVideo = json_decode((string) $row->tags_video, true);
        $tagsViews = json_decode((string) $row->tags_views, true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(1, DB::table('urt_show_tag_date')->count());
        $this->assertArrayHasKey('既有關鍵字', $tagsResult);
        $this->assertArrayHasKey('柯文哲', $tagsResult);
        $this->assertSame(2, $tagsVideo['既有關鍵字']);
        $this->assertSame(1, $tagsVideo['柯文哲']);
        $this->assertSame(300, $tagsViews['既有關鍵字']);
        $this->assertSame(1234, $tagsViews['柯文哲']);
        $this->assertSame(2, (int) $row->tags_count);
        $this->assertSame(9999, (int) $row->total_views);
    }

    private function createTables(): void
    {
        Schema::dropIfExists('tag_group');
        Schema::dropIfExists('tags');
        Schema::dropIfExists('urt_count');
        Schema::dropIfExists('urt_video');
        Schema::dropIfExists('urt_show_tag_date');

        Schema::create('tag_group', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('latest_time')->nullable();
            $table->string('tag');
            $table->string('group_name');
            $table->string('del_flag')->nullable();
        });

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

        Schema::create('urt_count', function ($table): void {
            $table->increments('pk');
            $table->unsignedInteger('u_id');
            $table->text('tags')->nullable();
        });

        Schema::create('urt_video', function ($table): void {
            $table->increments('pk');
            $table->unsignedInteger('u_id');
            $table->string('videoId')->nullable();
            $table->dateTime('publishedAt');
            $table->text('title')->nullable();
            $table->text('description')->nullable();
            $table->unsignedInteger('viewCount')->default(0);
        });

        Schema::create('urt_show_tag_date', function ($table): void {
            $table->increments('pk');
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('stime')->nullable();
            $table->unsignedInteger('count_channels')->default(0);
            $table->unsignedInteger('count_videos')->default(0);
            $table->unsignedInteger('count_tags')->default(0);
            $table->date('the_date');
            $table->unsignedInteger('tags_count')->default(0);
            $table->unsignedInteger('total_views')->default(0);
            $table->longText('tags_result')->nullable();
            $table->longText('tags_video')->nullable();
            $table->longText('tags_views')->nullable();
            $table->string('tagid')->nullable();
            $table->string('tag_or')->nullable();
            $table->string('tag_not')->nullable();
        });
    }
}
