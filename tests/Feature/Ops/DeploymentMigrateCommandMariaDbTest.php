<?php

namespace Tests\Feature\Ops;

use App\Console\Commands\DeploymentMigrateCommand;
use Illuminate\Database\Connection;
use Illuminate\Database\Events\MigrationsStarted;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class DeploymentMigrateCommandMariaDbTest extends TestCase
{
    public function test_external_mariadb_lock_blocks_deployment_migration_until_released(): void
    {
        if (getenv('DEPLOYMENT_MIGRATE_MARIADB_E2E') !== '1') {
            $this->markTestSkipped('Set DEPLOYMENT_MIGRATE_MARIADB_E2E=1 inside the local Compose app container.');
        }

        $originalConnection = DB::getDefaultConnection();
        $ownerConnectionName = 'deployment_migrate_e2e_owner';
        $commandConnectionName = 'deployment_migrate_e2e_command';
        $prefix = 'deployment_migrate_e2e_'.bin2hex(random_bytes(6)).'_';
        $ownerHasLock = false;
        $migrationStarted = false;

        $this->configureConnection($ownerConnectionName);
        $this->configureConnection($commandConnectionName, $prefix);
        $owner = DB::connection($ownerConnectionName);
        $command = DB::connection($commandConnectionName);
        $lockName = DeploymentMigrateCommand::lockName($command->getDatabaseName());

        try {
            $ownerConnectionId = (int) data_get(
                $owner->selectOne('SELECT CONNECTION_ID() AS connection_id'),
                'connection_id',
            );
            $commandConnectionId = (int) data_get(
                $command->selectOne('SELECT CONNECTION_ID() AS connection_id'),
                'connection_id',
            );
            $this->assertNotSame($ownerConnectionId, $commandConnectionId);

            Schema::connection($commandConnectionName)->create('migrations', function (Blueprint $table): void {
                $table->increments('id');
                $table->string('migration');
                $table->integer('batch');
            });

            foreach (glob(database_path('migrations/*.php')) ?: [] as $migration) {
                if (pathinfo($migration, PATHINFO_FILENAME) === '0001_01_01_000000_create_users_table') {
                    continue;
                }

                $command->table('migrations')->insert([
                    'migration' => pathinfo($migration, PATHINFO_FILENAME),
                    'batch' => 1,
                ]);
            }

            $migrationCount = $command->table('migrations')->count();
            $this->assertGreaterThan(0, $migrationCount);

            $ownerHasLock = $this->acquire($owner, $lockName);
            $this->assertTrue($ownerHasLock);
            DB::setDefaultConnection($commandConnectionName);

            $blockedExitCode = Artisan::call('deployment:migrate', ['--lock-timeout' => 0]);

            $this->assertSame(1, $blockedExitCode);
            $this->assertStringContainsString(
                'Another deployment migration process owns the database lock.',
                Artisan::output(),
            );

            $this->release($owner, $lockName);
            $ownerHasLock = false;

            Event::listen(MigrationsStarted::class, function () use (
                $owner,
                $lockName,
                &$migrationStarted,
                &$ownerHasLock,
            ): void {
                $migrationStarted = true;
                $ownerHasLock = $this->acquire($owner, $lockName);
            });

            $successfulExitCode = Artisan::call('deployment:migrate', ['--lock-timeout' => 0]);

            $this->assertSame(0, $successfulExitCode, Artisan::output());
            $this->assertTrue($migrationStarted);
            $this->assertFalse($ownerHasLock, 'The deployment lock must remain held while migrations run.');
            $this->assertSame($migrationCount + 1, $command->table('migrations')->count());
            $this->assertTrue(Schema::connection($commandConnectionName)->hasTable('users'));

            $ownerHasLock = $this->acquire($owner, $lockName);
            $this->assertTrue($ownerHasLock, 'The command must release its connection-scoped lock after migrating.');
        } finally {
            Event::forget(MigrationsStarted::class);

            try {
                if ($ownerHasLock) {
                    $this->release($owner, $lockName);
                }
            } catch (\Throwable) {
                // Cleanup continues so one failed release cannot contaminate later tests.
            }

            try {
                foreach (['sessions', 'password_reset_tokens', 'users', 'migrations'] as $table) {
                    Schema::connection($commandConnectionName)->dropIfExists($table);
                }
            } finally {
                DB::setDefaultConnection($originalConnection);
                DB::disconnect($ownerConnectionName);
                DB::disconnect($commandConnectionName);
                config()->set('database.connections.'.$ownerConnectionName, null);
                config()->set('database.connections.'.$commandConnectionName, null);
            }
        }
    }

    private function configureConnection(string $name, string $prefix = ''): void
    {
        config()->set('database.connections.'.$name, [
            'driver' => 'mysql',
            'host' => getenv('DEPLOYMENT_MIGRATE_MARIADB_HOST') ?: 'mysql',
            'port' => getenv('DEPLOYMENT_MIGRATE_MARIADB_PORT') ?: '3306',
            'database' => getenv('DEPLOYMENT_MIGRATE_MARIADB_DATABASE') ?: 'youtube_board',
            'username' => getenv('DEPLOYMENT_MIGRATE_MARIADB_USERNAME') ?: 'youtube_board',
            'password' => getenv('DEPLOYMENT_MIGRATE_MARIADB_PASSWORD') ?: 'youtube_board',
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => $prefix,
            'prefix_indexes' => true,
            'strict' => true,
            'engine' => null,
        ]);
        DB::purge($name);
    }

    private function acquire(Connection $connection, string $lockName): bool
    {
        $row = $connection->selectOne(
            'SELECT GET_LOCK(?, 0) AS lock_acquired',
            [$lockName],
        );

        return (int) ($row->lock_acquired ?? 0) === 1;
    }

    private function release(Connection $connection, string $lockName): void
    {
        $connection->selectOne(
            'SELECT RELEASE_LOCK(?) AS lock_released',
            [$lockName],
        );
    }
}
