<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReportFreshnessTimestampIndexMigrationTest extends TestCase
{
    private const MIGRATION = __DIR__.'/../../database/migrations/2026_09_14_000000_add_report_freshness_timestamp_indexes.php';

    public function test_migration_skips_indexes_that_already_exist_with_mixed_case_names(): void
    {
        Schema::create('urt_video', function (Blueprint $table): void {
            $table->increments('pk');
            $table->dateTime('ctime');
            $table->dateTime('mtime')->nullable();
            $table->dateTime('publishedAt');
            $table->integer('u_id');
            $table->index('publishedAt', 'publishedAt');
            $table->index(['u_id', 'publishedAt'], 'u_id_publishedAt');
        });

        $migration = require self::MIGRATION;
        $migration->up();
        $migration->up();

        $names = array_map('strtolower', Schema::getIndexListing('urt_video'));

        $this->assertContains('ctime', $names);
        $this->assertContains('mtime', $names);
        $this->assertContains('publishedat', $names);
        $this->assertContains('u_id_publishedat', $names);
    }

    public function test_migration_is_a_no_op_without_the_legacy_tables(): void
    {
        $migration = require self::MIGRATION;
        $migration->up();

        $this->assertFalse(Schema::hasTable('urt_video'));
    }
}
