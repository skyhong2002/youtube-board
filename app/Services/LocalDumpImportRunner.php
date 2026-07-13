<?php

namespace App\Services;

use RuntimeException;
use Symfony\Component\Process\ExecutableFinder;
use Symfony\Component\Process\Process;

class LocalDumpImportRunner
{
    public function assertLocalTarget(): void
    {
        if (! app()->environment('local', 'testing')) {
            throw new RuntimeException('local_environment_required');
        }

        $connection = (string) config('database.default');
        $driver = (string) config("database.connections.{$connection}.driver");
        $host = strtolower(trim((string) config("database.connections.{$connection}.host")));
        $database = trim((string) config("database.connections.{$connection}.database"));

        if ($driver !== 'mysql') {
            throw new RuntimeException('local_mysql_connection_required');
        }

        $allowedHosts = array_values(array_filter(array_map(
            static fn (mixed $allowedHost): string => is_string($allowedHost)
                ? strtolower(trim($allowedHost))
                : '',
            (array) config('local_import.allowed_hosts'),
        )));

        if (! in_array($host, $allowedHosts, true)) {
            throw new RuntimeException('remote_database_refused');
        }

        if ($database !== (string) config('local_import.database')) {
            throw new RuntimeException('unexpected_database_refused');
        }
    }

    /**
     * @param  array<string, mixed>  $inspection
     */
    public function run(array $inspection, int $timeout): void
    {
        $this->assertLocalTarget();

        $connection = (string) config('database.default');
        $database = (array) config("database.connections.{$connection}");
        $configuredClient = (string) config('local_import.client', 'mariadb');
        $client = str_contains($configuredClient, DIRECTORY_SEPARATOR)
            ? realpath($configuredClient)
            : (new ExecutableFinder)->find($configuredClient);

        if (! is_string($client) || ! is_file($client) || ! is_executable($client)) {
            throw new RuntimeException('mariadb_client_unavailable');
        }

        $stagedPath = $this->stageReviewedArtifact($inspection);
        $inputPath = ($inspection['reviewed_compressed'] ?? false)
            ? 'compress.zlib://'.$stagedPath
            : $stagedPath;
        $input = fopen($inputPath, 'rb');

        if ($input === false) {
            @unlink($stagedPath);
            throw new RuntimeException('dump_read_failed');
        }

        try {
            $process = new Process([
                $client,
                '--protocol=tcp',
                '--host='.(string) ($database['host'] ?? ''),
                '--port='.(string) ($database['port'] ?? 3306),
                '--user='.(string) ($database['username'] ?? ''),
                '--database='.(string) ($database['database'] ?? ''),
                '--binary-mode',
                '--default-character-set=utf8mb4',
            ], null, [
                'MYSQL_PWD' => (string) ($database['password'] ?? ''),
            ]);
            $process->setInput($input);
            $process->setTimeout($timeout);
            $process->disableOutput();
            $process->run();
        } finally {
            fclose($input);
            @unlink($stagedPath);
        }

        if (! $process->isSuccessful()) {
            throw new RuntimeException('mariadb_import_failed');
        }
    }

    /**
     * @param  array<string, mixed>  $inspection
     */
    private function stageReviewedArtifact(array $inspection): string
    {
        $path = (string) ($inspection['path'] ?? '');
        $expectedSize = (int) ($inspection['reviewed_size_bytes'] ?? 0);
        $expectedSha = (string) ($inspection['reviewed_sha256'] ?? '');
        $directory = (string) config('local_import.staging_directory');

        if (
            $path === ''
            || $expectedSize <= 0
            || preg_match('/\A[a-f0-9]{64}\z/', $expectedSha) !== 1
        ) {
            throw new RuntimeException('dump_artifact_changed');
        }

        if (! is_dir($directory) && ! mkdir($directory, 0700, true) && ! is_dir($directory)) {
            throw new RuntimeException('dump_staging_unavailable');
        }

        $source = fopen($path, 'rb');

        if ($source === false) {
            throw new RuntimeException('dump_artifact_changed');
        }

        $stagedPath = tempnam($directory, '.dump-');

        if ($stagedPath === false) {
            fclose($source);
            throw new RuntimeException('dump_staging_unavailable');
        }

        @chmod($stagedPath, 0600);
        $staged = fopen($stagedPath, 'wb');

        if ($staged === false) {
            fclose($source);
            @unlink($stagedPath);
            throw new RuntimeException('dump_staging_unavailable');
        }

        $hash = hash_init('sha256');
        $bytes = 0;

        try {
            while (! feof($source)) {
                $chunk = fread($source, 1024 * 1024);

                if ($chunk === false) {
                    throw new RuntimeException('dump_artifact_changed');
                }

                if ($chunk === '') {
                    continue;
                }

                hash_update($hash, $chunk);
                $bytes += strlen($chunk);
                $this->writeAll($staged, $chunk);
            }

            if (! fflush($staged) || (function_exists('fsync') && ! fsync($staged))) {
                throw new RuntimeException('dump_staging_unavailable');
            }
        } catch (\Throwable $exception) {
            fclose($source);
            fclose($staged);
            @unlink($stagedPath);
            throw $exception;
        }

        fclose($source);
        fclose($staged);
        $sha256 = hash_final($hash);

        if ($bytes !== $expectedSize || ! hash_equals($expectedSha, $sha256)) {
            @unlink($stagedPath);
            throw new RuntimeException('dump_artifact_changed');
        }

        return $stagedPath;
    }

    /**
     * @param  resource  $stream
     */
    private function writeAll($stream, string $contents): void
    {
        $offset = 0;
        $length = strlen($contents);

        while ($offset < $length) {
            $written = fwrite($stream, substr($contents, $offset));

            if ($written === false || $written === 0) {
                throw new RuntimeException('dump_staging_unavailable');
            }

            $offset += $written;
        }
    }
}
