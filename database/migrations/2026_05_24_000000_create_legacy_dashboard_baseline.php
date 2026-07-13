<?php

use App\Support\LegacyDashboardSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql') {
            throw new RuntimeException('The legacy dashboard baseline migration requires MariaDB/MySQL.');
        }

        $statements = LegacyDashboardSchema::statements(
            database_path('schema/legacy-dashboard-baseline.sql'),
        );

        foreach ($statements as $statement) {
            if (Schema::hasTable($statement['table'])) {
                continue;
            }

            DB::unprepared($statement['sql']);
        }
    }

    public function down(): void
    {
        // Baseline tables may predate Laravel. Rollback must never remove them.
    }
};
