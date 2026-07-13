<?php

namespace App\Services;

use App\Support\LegacyDashboardSchema;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class DeploymentSchemaVerifier
{
    /**
     * @var array<string, list<string>>
     */
    private const REQUIRED_COLUMNS = [
        'migrations' => ['id', 'migration', 'batch'],
        'users' => ['id', 'name', 'email', 'email_verified_at', 'password', 'remember_token', 'created_at', 'updated_at'],
        'password_reset_tokens' => ['email', 'token', 'created_at'],
        'sessions' => ['id', 'user_id', 'ip_address', 'user_agent', 'payload', 'last_activity'],
        'cache' => ['key', 'value', 'expiration'],
        'cache_locks' => ['key', 'owner', 'expiration'],
        'jobs' => ['id', 'queue', 'payload', 'attempts', 'reserved_at', 'available_at', 'created_at'],
        'job_batches' => [
            'id',
            'name',
            'total_jobs',
            'pending_jobs',
            'failed_jobs',
            'failed_job_ids',
            'options',
            'cancelled_at',
            'created_at',
            'finished_at',
        ],
        'failed_jobs' => ['id', 'uuid', 'connection', 'queue', 'payload', 'exception', 'failed_at'],
        'urt_mayor_person_ai' => [
            'pk',
            'ctime',
            'mtime',
            'city_key',
            'city_label',
            'person',
            'the_date',
            'ai_type',
            'provider',
            'user_token',
            'prompt_json',
            'source_json',
            'result_json',
            'del_flag',
        ],
        'ingestion_youtube_quota_daily' => [
            'id',
            'provider',
            'quota_date',
            'consumed_units',
            'reserved_units',
            'created_at',
            'updated_at',
        ],
    ];

    /**
     * Only identity and idempotency constraints are deployment critical. Query
     * acceleration indexes can be added independently without blocking startup.
     *
     * @var array<string, list<array{kind: 'primary'|'unique', columns: list<string>}>>
     */
    private const REQUIRED_INDEXES = [
        'migrations' => [
            ['kind' => 'primary', 'columns' => ['id']],
        ],
        'users' => [
            ['kind' => 'primary', 'columns' => ['id']],
            ['kind' => 'unique', 'columns' => ['email']],
        ],
        'password_reset_tokens' => [
            ['kind' => 'primary', 'columns' => ['email']],
        ],
        'sessions' => [
            ['kind' => 'primary', 'columns' => ['id']],
        ],
        'cache' => [
            ['kind' => 'primary', 'columns' => ['key']],
        ],
        'cache_locks' => [
            ['kind' => 'primary', 'columns' => ['key']],
        ],
        'jobs' => [
            ['kind' => 'primary', 'columns' => ['id']],
        ],
        'job_batches' => [
            ['kind' => 'primary', 'columns' => ['id']],
        ],
        'failed_jobs' => [
            ['kind' => 'primary', 'columns' => ['id']],
            ['kind' => 'unique', 'columns' => ['uuid']],
        ],
        'urt_mayor_person_ai' => [
            ['kind' => 'primary', 'columns' => ['pk']],
        ],
        'ingestion_youtube_quota_daily' => [
            ['kind' => 'primary', 'columns' => ['id']],
            ['kind' => 'unique', 'columns' => ['provider', 'quota_date']],
        ],
    ];

    /**
     * @return array<string, mixed>
     */
    public function inspect(): array
    {
        try {
            $requirements = $this->requirements();
            $requiredTables = array_keys($requirements['columns']);
            $existingTables = array_map(
                fn (string $table): string => str_contains($table, '.')
                    ? substr($table, (int) strrpos($table, '.') + 1)
                    : $table,
                Schema::getTableListing(),
            );
            $missingTables = array_values(array_diff($requiredTables, $existingTables));
            $missingColumns = [];
            $missingIndexes = [];

            foreach ($requirements['columns'] as $table => $columns) {
                if (! in_array($table, $existingTables, true)) {
                    continue;
                }

                $existingColumns = array_map('strtolower', Schema::getColumnListing($table));
                $missing = array_values(array_filter(
                    $columns,
                    fn (string $column): bool => ! in_array(strtolower($column), $existingColumns, true),
                ));

                if ($missing !== []) {
                    $missingColumns[$table] = $missing;
                }
            }

            foreach ($requirements['indexes'] as $table => $requiredIndexes) {
                if (! in_array($table, $existingTables, true)) {
                    continue;
                }

                $existingIndexes = Schema::getIndexes($table);

                foreach ($requiredIndexes as $requiredIndex) {
                    if (! $this->hasRequiredIndex($existingIndexes, $requiredIndex)) {
                        $missingIndexes[$table][] = $this->indexLabel($requiredIndex);
                    }
                }
            }

            $quotaUnique = in_array('ingestion_youtube_quota_daily', $existingTables, true)
                && ! in_array(
                    'unique(provider,quota_date)',
                    $missingIndexes['ingestion_youtube_quota_daily'] ?? [],
                    true,
                );
            $driver = DB::connection()->getDriverName();
            $quotaEngine = $this->quotaEngine($driver, $existingTables);
            $engineValid = $driver !== 'mysql' || $quotaEngine === 'InnoDB';
            $ready = $missingTables === []
                && $missingColumns === []
                && $missingIndexes === []
                && $quotaUnique
                && $engineValid;

            return [
                'status' => $ready ? 'ready' : 'failed',
                'ready' => $ready,
                'driver' => $driver,
                'required_table_count' => count($requiredTables),
                'existing_required_table_count' => count($requiredTables) - count($missingTables),
                'missing_tables' => $missingTables,
                'missing_columns' => $missingColumns,
                'missing_indexes' => $missingIndexes,
                'quota_unique_index' => $quotaUnique,
                'quota_engine' => $quotaEngine,
                'quota_engine_valid' => $engineValid,
                'secrets' => 'not_printed',
            ];
        } catch (Throwable) {
            return [
                'status' => 'failed',
                'ready' => false,
                'reason' => 'deployment_schema_check_failed',
                'secrets' => 'not_printed',
            ];
        }
    }

    public function assertReady(): void
    {
        if (! $this->inspect()['ready']) {
            throw new RuntimeException('deployment_schema_not_ready');
        }
    }

    /**
     * @return array{
     *     columns: array<string, list<string>>,
     *     indexes: array<string, list<array{kind: 'primary'|'unique', columns: list<string>}>>
     * }
     */
    private function requirements(): array
    {
        $columns = self::REQUIRED_COLUMNS;
        $indexes = self::REQUIRED_INDEXES;

        foreach (LegacyDashboardSchema::statements(database_path('schema/legacy-dashboard-baseline.sql')) as $statement) {
            $table = $statement['table'];
            $columns[$table] = $this->baselineColumns($table, $statement['sql']);
            $indexes[$table] = $this->baselineIndexes($table, $statement['sql']);
        }

        ksort($columns);
        ksort($indexes);

        return ['columns' => $columns, 'indexes' => $indexes];
    }

    /**
     * @return list<string>
     */
    private function baselineColumns(string $table, string $sql): array
    {
        preg_match_all('/^\s*`([^`]+)`\s+/m', $sql, $matches);
        $columns = array_values(array_unique($matches[1] ?? []));

        if ($columns === []) {
            throw new RuntimeException("Legacy dashboard table {$table} has no parsed columns.");
        }

        return $columns;
    }

    /**
     * @return list<array{kind: 'primary'|'unique', columns: list<string>}>
     */
    private function baselineIndexes(string $table, string $sql): array
    {
        if (preg_match('/^\s*PRIMARY KEY\s*\(([^)]+)\)/mi', $sql, $primaryMatch) !== 1) {
            throw new RuntimeException("Legacy dashboard table {$table} has no parsed primary key.");
        }

        $indexes = [[
            'kind' => 'primary',
            'columns' => $this->indexColumns($primaryMatch[1]),
        ]];

        preg_match_all('/^\s*UNIQUE KEY\s+`[^`]+`\s*\(([^)]+)\)/mi', $sql, $uniqueMatches);

        foreach ($uniqueMatches[1] ?? [] as $definition) {
            $indexes[] = [
                'kind' => 'unique',
                'columns' => $this->indexColumns($definition),
            ];
        }

        return $indexes;
    }

    /**
     * @return list<string>
     */
    private function indexColumns(string $definition): array
    {
        preg_match_all('/`([^`]+)`/', $definition, $matches);
        $columns = array_values($matches[1] ?? []);

        if ($columns === []) {
            throw new RuntimeException('Deployment schema index has no parsed columns.');
        }

        return $columns;
    }

    /**
     * @param  list<array<string, mixed>>  $existingIndexes
     * @param  array{kind: 'primary'|'unique', columns: list<string>}  $requiredIndex
     */
    private function hasRequiredIndex(array $existingIndexes, array $requiredIndex): bool
    {
        $requiredColumns = array_map('strtolower', $requiredIndex['columns']);

        foreach ($existingIndexes as $index) {
            $columns = array_map('strtolower', array_values($index['columns'] ?? []));
            $kindMatches = $requiredIndex['kind'] === 'primary'
                ? (bool) ($index['primary'] ?? false)
                : (bool) ($index['unique'] ?? false) && ! (bool) ($index['primary'] ?? false);

            if ($kindMatches && $columns === $requiredColumns) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array{kind: 'primary'|'unique', columns: list<string>}  $index
     */
    private function indexLabel(array $index): string
    {
        return sprintf('%s(%s)', $index['kind'], implode(',', $index['columns']));
    }

    /**
     * @param  list<string>  $existingTables
     */
    private function quotaEngine(string $driver, array $existingTables): ?string
    {
        if ($driver !== 'mysql' || ! in_array('ingestion_youtube_quota_daily', $existingTables, true)) {
            return null;
        }

        $engine = DB::table('information_schema.TABLES')
            ->where('TABLE_SCHEMA', DB::connection()->getDatabaseName())
            ->where('TABLE_NAME', 'ingestion_youtube_quota_daily')
            ->value('ENGINE');

        return is_string($engine) ? $engine : null;
    }
}
