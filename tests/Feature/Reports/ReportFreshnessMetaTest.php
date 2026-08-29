<?php

namespace Tests\Feature\Reports;

use App\Support\ReportFreshness;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReportFreshnessMetaTest extends TestCase
{
    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_report_header_uses_database_update_time_instead_of_render_time(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-28 12:00:00', 'Asia/Taipei'));
        Storage::fake('local');
        $this->createHomeTables();

        DB::table('urt_tag')->insert([
            ['tag_id' => 1, 'tag_name' => '新聞'],
        ]);
        DB::table('urt_count')->insert([
            ['u_id' => 10, 'tags' => '[1]', 'view_week' => 100],
        ]);
        DB::table('tags')->insert([
            [
                'tag' => '柯文哲',
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => '2026-05-24 12:00:00',
                'max_count' => 1200,
                'hours_count' => 80,
                'max_hours' => '2026-05-24 12:00:00',
                'no_tag' => null,
            ],
        ]);

        $response = $this->get('/');

        $response->assertOk();
        $response->assertSee('資料更新 2026-05-24 12:00:00');
        $response->assertDontSee('2026-05-28 12:00:00');
    }

    public function test_report_freshness_falls_back_to_latest_matching_ingestion_run(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('ingestion-runs/20260526-194718-test.json', json_encode([
            'id' => '20260526-194718-test',
            'created_at' => '2026-05-26 19:47:18 Asia/Taipei',
            'request' => [
                'mode' => 'execute',
                'source' => 'artisan',
            ],
            'result' => [
                'mode' => 'execute',
                'jobs' => [
                    [
                        'key' => 'youtube.live.poll',
                        'executed' => true,
                        'failed' => false,
                        'exit_code' => 0,
                    ],
                ],
            ],
        ], JSON_THROW_ON_ERROR));

        $freshness = app(ReportFreshness::class)->forRoute('live.current');

        $this->assertSame('資料更新 2026-05-26 19:47:18', $freshness['display'] ?? null);
        $this->assertSame('ingestion-run', $freshness['source'] ?? null);
    }

    public function test_mayor_freshness_only_uses_mayor_tag_rows(): void
    {
        Schema::dropIfExists('urt_show_tag_date');
        Schema::create('urt_show_tag_date', function ($table): void {
            $table->string('tagid');
            $table->timestamp('ctime')->nullable();
            $table->timestamp('mtime')->nullable();
            $table->date('the_date');
        });
        DB::table('urt_show_tag_date')->insert([
            ['tagid' => '3', 'ctime' => '2026-05-10 01:00:00', 'mtime' => '2026-05-10 02:00:00', 'the_date' => '2026-05-09'],
            ['tagid' => '102', 'ctime' => '2026-05-28 01:00:00', 'mtime' => '2026-05-28 02:00:00', 'the_date' => '2026-05-27'],
        ]);

        $freshness = app(ReportFreshness::class)->forRoute('mayor.show');

        $this->assertSame('資料更新 2026-05-10 02:00:00', $freshness['display'] ?? null);
    }

    private function createHomeTables(): void
    {
        foreach (['urt_count', 'urt_tag', 'tags', 'urt_show_data'] as $table) {
            Schema::dropIfExists($table);
        }

        Schema::create('urt_tag', function ($table): void {
            $table->integer('tag_id');
            $table->string('tag_name');
        });

        Schema::create('urt_count', function ($table): void {
            $table->integer('u_id');
            $table->string('tags')->nullable();
            $table->integer('view_week')->nullable();
        });

        Schema::create('tags', function ($table): void {
            $table->string('tag');
            $table->timestamp('ctime')->nullable();
            $table->timestamp('mtime')->nullable();
            $table->integer('max_count')->nullable();
            $table->integer('hours_count')->nullable();
            $table->timestamp('max_hours')->nullable();
            $table->integer('no_tag')->nullable();
        });

        Schema::create('urt_show_data', function ($table): void {
            $table->string('data_name');
            $table->longText('the_result')->nullable();
        });
    }
}
