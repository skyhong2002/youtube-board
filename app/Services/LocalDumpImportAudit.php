<?php

namespace App\Services;

use RuntimeException;

class LocalDumpImportAudit
{
    public function completedId(string $sha256): ?string
    {
        if (preg_match('/\A[a-f0-9]{64}\z/', $sha256) !== 1) {
            return null;
        }

        $directory = (string) config('local_import.audit_directory');
        $records = glob($directory.DIRECTORY_SEPARATOR.'*.json') ?: [];
        rsort($records, SORT_STRING);

        foreach ($records as $path) {
            $contents = file_get_contents($path);
            $record = is_string($contents) ? json_decode($contents, true) : null;

            if (
                is_array($record)
                && ($record['status'] ?? null) === 'completed'
                && isset($record['sha256'])
                && is_string($record['sha256'])
                && hash_equals($sha256, $record['sha256'])
                && isset($record['id'])
                && is_string($record['id'])
            ) {
                return $record['id'];
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function record(array $payload): string
    {
        $directory = (string) config('local_import.audit_directory');

        if (! is_dir($directory) && ! mkdir($directory, 0700, true) && ! is_dir($directory)) {
            throw new RuntimeException('import_audit_directory_unavailable');
        }

        $sha256 = preg_match('/\A[a-f0-9]{64}\z/', (string) ($payload['sha256'] ?? '')) === 1
            ? (string) $payload['sha256']
            : str_repeat('0', 64);
        $id = gmdate('Ymd\THis\Z').'-'.substr($sha256, 0, 12).'-'.bin2hex(random_bytes(4));
        $record = [
            'id' => $id,
            'recorded_at' => now()->utc()->toIso8601String(),
            'mode' => 'execute',
            'status' => (string) ($payload['status'] ?? 'failed'),
            'error_code' => $payload['error_code'] ?? null,
            'sha256' => $sha256,
            'size_bytes' => isset($payload['size_bytes']) ? (int) $payload['size_bytes'] : null,
            'expanded_bytes' => isset($payload['expanded_bytes']) ? (int) $payload['expanded_bytes'] : null,
            'tables' => array_values(array_filter(
                (array) ($payload['tables'] ?? []),
                fn (mixed $table): bool => is_string($table) && preg_match('/\A[a-z0-9_]+\z/', $table) === 1,
            )),
            'replacement_confirmed' => (bool) ($payload['replacement_confirmed'] ?? false),
            'write_target' => 'local_mysql_only',
            'secrets' => 'not_recorded',
        ];
        $json = json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        if ($json === false) {
            throw new RuntimeException('import_audit_encoding_failed');
        }

        $temporary = $directory.DIRECTORY_SEPARATOR.'.'.$id.'.tmp';
        $destination = $directory.DIRECTORY_SEPARATOR.$id.'.json';

        if (file_put_contents($temporary, $json."\n", LOCK_EX) === false || ! rename($temporary, $destination)) {
            @unlink($temporary);

            throw new RuntimeException('import_audit_write_failed');
        }

        @chmod($destination, 0600);

        return $id;
    }
}
