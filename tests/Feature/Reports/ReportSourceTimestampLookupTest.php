<?php

namespace Tests\Feature\Reports;

use App\Support\ReportSourceTimestampLookup;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Tests\TestCase;

class ReportSourceTimestampLookupTest extends TestCase
{
    public function test_lookup_groups_max_columns_and_reuses_prefetched_timestamp_values(): void
    {
        $this->createProbeTable();
        DB::table('report_source_probe')->insert([
            'scope' => 'all',
            'ctime' => '2026-07-13 10:00:00',
            'mtime' => '2026-07-13 12:00:00',
            'date_from' => '2026-07-12 00:00:00',
            'date_to' => '2026-07-12 23:59:59',
        ]);
        $maxQueries = [];
        DB::listen(function ($query) use (&$maxQueries): void {
            $sql = strtolower($query->sql);

            if (str_contains($sql, 'report_source_probe') && str_contains($sql, 'max(')) {
                $maxQueries[] = $query->sql;
            }
        });

        $lookup = app(ReportSourceTimestampLookup::class);
        $latestWrite = $lookup->latest('report_source_probe', ['ctime', 'mtime']);
        $latestRange = $lookup->latest('report_source_probe', ['date_from', 'date_to']);

        $this->assertSame('2026-07-13 12:00:00', $latestWrite?->format('Y-m-d H:i:s'));
        $this->assertSame('2026-07-12 23:59:59', $latestRange?->format('Y-m-d H:i:s'));
        $this->assertCount(1, $maxQueries);
    }

    public function test_lookup_keeps_filtered_scopes_separate(): void
    {
        $this->createProbeTable();
        DB::table('report_source_probe')->insert([
            [
                'scope' => 'all',
                'mtime' => '2026-07-13 12:00:00',
            ],
            [
                'scope' => 'green',
                'mtime' => '2026-07-13 13:00:00',
            ],
        ]);
        $maxQueries = [];
        DB::listen(function ($query) use (&$maxQueries): void {
            $sql = strtolower($query->sql);

            if (str_contains($sql, 'report_source_probe') && str_contains($sql, 'max(')) {
                $maxQueries[] = $query->sql;
            }
        });

        $lookup = app(ReportSourceTimestampLookup::class);
        $all = $lookup->latest('report_source_probe', ['mtime'], ['scope' => 'all']);
        $green = $lookup->latest('report_source_probe', ['mtime'], ['scope' => 'green']);

        $this->assertSame('2026-07-13 12:00:00', $all?->format('Y-m-d H:i:s'));
        $this->assertSame('2026-07-13 13:00:00', $green?->format('Y-m-d H:i:s'));
        $this->assertCount(2, $maxQueries);
    }

    public function test_lookup_returns_null_when_schema_inspection_is_unavailable(): void
    {
        Schema::shouldReceive('hasTable')
            ->once()
            ->with('report_source_probe')
            ->andThrow(new RuntimeException('database unavailable'));

        $this->assertNull((new ReportSourceTimestampLookup)->latest('report_source_probe', ['mtime']));
    }

    public function test_lookup_parses_database_timestamps_in_the_ingestion_timezone(): void
    {
        config()->set('ingestion.timezone', 'America/Los_Angeles');
        $this->createProbeTable();
        DB::table('report_source_probe')->insert([
            'mtime' => '2026-07-13 12:00:00',
        ]);

        $timestamp = app(ReportSourceTimestampLookup::class)->latest('report_source_probe', ['mtime']);

        $this->assertSame('2026-07-13 12:00:00', $timestamp?->format('Y-m-d H:i:s'));
        $this->assertSame('America/Los_Angeles', $timestamp?->getTimezone()->getName());
    }

    private function createProbeTable(): void
    {
        Schema::create('report_source_probe', function (Blueprint $table): void {
            $table->id();
            $table->string('scope')->nullable();
            $table->dateTime('ctime')->nullable();
            $table->dateTime('mtime')->nullable();
            $table->dateTime('date_from')->nullable();
            $table->dateTime('date_to')->nullable();
        });
    }
}
