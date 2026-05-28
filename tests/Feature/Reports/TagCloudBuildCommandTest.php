<?php

namespace Tests\Feature\Reports;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TagCloudBuildCommandTest extends TestCase
{
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
