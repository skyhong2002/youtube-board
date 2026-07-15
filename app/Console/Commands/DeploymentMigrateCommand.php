<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;

class DeploymentMigrateCommand extends Command
{
    protected $signature = 'deployment:migrate
        {--lock-timeout=0 : Seconds to wait for the shared MariaDB deployment lock}';

    protected $description = 'Run Laravel migrations under a cross-container database lock';

    public function handle(): int
    {
        $timeout = filter_var($this->option('lock-timeout'), FILTER_VALIDATE_INT);

        if ($timeout === false || $timeout < 0 || $timeout > 300) {
            $this->components->error('lock-timeout must be an integer between 0 and 300 seconds.');

            return self::FAILURE;
        }

        $connection = DB::connection();

        if (! in_array($connection->getDriverName(), ['mysql', 'mariadb'], true)) {
            return $this->runMigrations();
        }

        $lockName = self::lockName($connection->getDatabaseName());
        $row = $connection->selectOne(
            'SELECT GET_LOCK(?, ?) AS lock_acquired',
            [$lockName, $timeout],
        );

        if ((int) ($row->lock_acquired ?? 0) !== 1) {
            $this->components->error('Another deployment migration process owns the database lock.');

            return self::FAILURE;
        }

        try {
            return $this->runMigrations();
        } finally {
            try {
                $connection->selectOne(
                    'SELECT RELEASE_LOCK(?) AS lock_released',
                    [$lockName],
                );
            } catch (\Throwable) {
                // Closing a failed connection also releases its advisory locks.
            }
        }
    }

    public static function lockName(string $database): string
    {
        return 'youtube-board:deployment:'.substr(hash('sha256', $database), 0, 32);
    }

    private function runMigrations(): int
    {
        return $this->call('migrate', [
            '--force' => true,
        ]);
    }
}
