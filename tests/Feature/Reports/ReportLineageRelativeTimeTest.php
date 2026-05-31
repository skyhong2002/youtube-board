<?php

namespace Tests\Feature\Reports;

use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ReportLineageRelativeTimeTest extends TestCase
{
    public function test_lineage_graph_status_uses_short_relative_times_and_keeps_exact_meta_times(): void
    {
        $now = CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei');
        CarbonImmutable::setTestNow($now);
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));

        try {
            Storage::fake('local');
            $this->putRunRecord('20260524-142010-build', '2026-05-24 14:20:10 Asia/Taipei', 'reports.keywords.build');
            $this->putRunRecord('20260524-175930-cache', '2026-05-24 17:59:30 Asia/Taipei', 'reports.keywords.cache');
            $this->createKeywordTables();

            DB::table('tags')->insert([
                'tag' => '柯文哲',
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => '2026-05-24 17:55:00',
                'max_count' => 1200,
                'hours_count' => 80,
                'max_hours' => '2026-05-24 12:00:00',
                'no_tag' => null,
            ]);
            DB::table('urt_show_data')->insert([
                'data_name' => 'tags_all',
                'mtime' => '2026-05-24 12:30:00',
                'the_result' => json_encode([
                    '柯文哲' => ['video' => 8, 'views' => 7000, 'views_all' => 21000],
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $response = $this->get('/keywords?limit=20');

            $response->assertOk();
            $response->assertSee('上次執行：3 小時前');
            $response->assertSee('上次執行：剛剛');
            $response->assertSee('最後更新：5 分鐘前');
            $response->assertSee('最後更新：5 小時前');
            $response->assertSee('2026-05-24 14:20:10');
            $response->assertSee('2026-05-24 17:59:30');
            $response->assertSee('2026-05-24 17:55:00');
            $response->assertSee('2026-05-24 12:30:00');
        } finally {
            CarbonImmutable::setTestNow();
            Carbon::setTestNow();
        }
    }

    public function test_lineage_graph_status_uses_yesterday_and_date_for_older_sources(): void
    {
        $now = CarbonImmutable::parse('2026-05-24 18:00:00', 'Asia/Taipei');
        CarbonImmutable::setTestNow($now);
        Carbon::setTestNow(Carbon::parse('2026-05-24 18:00:00', 'Asia/Taipei'));

        try {
            Storage::fake('local');
            $this->createKeywordTables();

            DB::table('tags')->insert([
                'tag' => '柯文哲',
                'ctime' => '2026-05-20 00:00:00',
                'mtime' => '2026-05-23 14:20:00',
                'max_count' => 1200,
                'hours_count' => 80,
                'max_hours' => '2026-05-24 12:00:00',
                'no_tag' => null,
            ]);
            DB::table('urt_show_data')->insert([
                'data_name' => 'tags_all',
                'mtime' => '2026-04-01 10:00:00',
                'the_result' => json_encode([
                    '柯文哲' => ['video' => 8, 'views' => 7000, 'views_all' => 21000],
                ], JSON_UNESCAPED_UNICODE),
            ]);

            $response = $this->get('/keywords?limit=20');

            $response->assertOk();
            $response->assertSee('最後更新：昨天 14:20');
            $response->assertSee('最後更新：2026-04-01');
        } finally {
            CarbonImmutable::setTestNow();
            Carbon::setTestNow();
        }
    }

    private function putRunRecord(string $id, string $createdAt, string $jobKey): void
    {
        Storage::disk('local')->put('ingestion-runs/'.$id.'.json', json_encode([
            'id' => $id,
            'created_at' => $createdAt,
            'request' => ['mode' => 'execute', 'source' => 'artisan'],
            'result' => [
                'mode' => 'execute',
                'jobs' => [
                    ['key' => $jobKey, 'executed' => true, 'failed' => false, 'exit_code' => 0],
                ],
            ],
        ], JSON_THROW_ON_ERROR));
    }

    private function createKeywordTables(): void
    {
        foreach (['tags', 'urt_show_data'] as $table) {
            Schema::dropIfExists($table);
        }

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
            $table->timestamp('mtime')->nullable();
            $table->longText('the_result')->nullable();
        });
    }
}
