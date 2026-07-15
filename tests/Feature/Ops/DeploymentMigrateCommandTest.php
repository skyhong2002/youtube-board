<?php

namespace Tests\Feature\Ops;

use App\Console\Commands\DeploymentMigrateCommand;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class DeploymentMigrateCommandTest extends TestCase
{
    public function test_non_mysql_database_runs_migrations_without_a_table_backed_lock(): void
    {
        Schema::create('migrations', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('migration');
            $table->integer('batch');
        });

        foreach (glob(database_path('migrations/*.php')) ?: [] as $migration) {
            DB::table('migrations')->insert([
                'migration' => pathinfo($migration, PATHINFO_FILENAME),
                'batch' => 1,
            ]);
        }

        $this->artisan('deployment:migrate', ['--lock-timeout' => 0])
            ->expectsOutputToContain('Nothing to migrate')
            ->assertExitCode(0);
    }

    public function test_invalid_lock_timeout_fails_before_running_migrations(): void
    {
        $this->artisan('deployment:migrate', ['--lock-timeout' => 'invalid'])
            ->expectsOutputToContain('lock-timeout must be an integer between 0 and 300 seconds.')
            ->assertExitCode(1);
    }

    public function test_lock_name_is_bounded_and_does_not_disclose_database_name(): void
    {
        $database = 'private-production-database-name';
        $name = DeploymentMigrateCommand::lockName($database);

        $this->assertLessThanOrEqual(64, strlen($name));
        $this->assertStringNotContainsString($database, $name);
        $this->assertSame($name, DeploymentMigrateCommand::lockName($database));
    }
}
