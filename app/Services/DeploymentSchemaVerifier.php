<?php

namespace App\Services;

use App\Support\LegacyDashboardSchema;
use App\Support\YoutubeIdentifierSchema;
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
        'ingestion_runs' => [
            'id',
            'recorded_at',
            'request_source',
            'request_mode',
            'result_mode',
            'payload_json',
            'created_at',
            'updated_at',
        ],
        'ingestion_run_jobs' => [
            'run_id',
            'job_key',
            'recorded_at',
            'attempted',
            'succeeded',
            'failed',
            'action',
            'exit_code',
            'started_at',
            'finished_at',
            'created_at',
            'updated_at',
        ],
    ];

    /**
     * Identity, idempotency, and durable run-history lookup indexes are
     * deployment critical. Other query acceleration indexes remain optional.
     *
     * @var array<string, list<array{kind: 'index'|'primary'|'unique', columns: list<string>}>>
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
        'ingestion_runs' => [
            ['kind' => 'primary', 'columns' => ['id']],
            ['kind' => 'index', 'columns' => ['recorded_at']],
            [
                'kind' => 'index',
                'columns' => ['request_source', 'request_mode', 'result_mode', 'recorded_at'],
            ],
        ],
        'ingestion_run_jobs' => [
            ['kind' => 'primary', 'columns' => ['run_id', 'job_key']],
            ['kind' => 'index', 'columns' => ['job_key', 'attempted', 'recorded_at']],
            ['kind' => 'index', 'columns' => ['job_key', 'succeeded', 'recorded_at']],
        ],
    ];

    /**
     * @var array<string, list<array{
     *     columns: list<string>,
     *     foreign_table: string,
     *     foreign_columns: list<string>,
     *     on_delete: string
     * }>>
     */
    private const REQUIRED_FOREIGN_KEYS = [
        'ingestion_run_jobs' => [[
            'columns' => ['run_id'],
            'foreign_table' => 'ingestion_runs',
            'foreign_columns' => ['id'],
            'on_delete' => 'cascade',
        ]],
    ];

    /** @var list<string> */
    private const ENGINE_BEARING_DRIVERS = ['mysql', 'mariadb'];

    /** @var list<string> */
    private const REQUIRED_INNODB_TABLES = [
        'ingestion_youtube_quota_daily',
        'ingestion_runs',
        'ingestion_run_jobs',
    ];

    /**
     * YouTube resource IDs are case-sensitive. These collations protect both
     * lookup semantics and the legacy unique indexes that own those IDs.
     *
     * @var array<string, array<string, array{length: int, nullable: bool}>>
     */
    private const REQUIRED_BINARY_COLLATION_COLUMNS = YoutubeIdentifierSchema::COLUMNS;

    /**
     * @return array<string, mixed>
     */
    public function inspect(): array
    {
        try {
            $requirements = $this->requirements();
            $requiredTables = array_keys($requirements['columns']);
            $existingTables = array_values(array_unique(array_map(
                $this->logicalTableName(...),
                Schema::getTableListing(),
            )));
            $missingTables = array_values(array_diff($requiredTables, $existingTables));
            $missingColumns = [];
            $missingIndexes = [];
            $missingForeignKeys = [];

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

            foreach (self::REQUIRED_FOREIGN_KEYS as $table => $requiredForeignKeys) {
                if (! in_array($table, $existingTables, true)) {
                    continue;
                }

                $existingForeignKeys = Schema::getForeignKeys($table);

                foreach ($requiredForeignKeys as $requiredForeignKey) {
                    if (! $this->hasRequiredForeignKey($existingForeignKeys, $requiredForeignKey)) {
                        $missingForeignKeys[$table][] = $this->foreignKeyLabel($requiredForeignKey);
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
            $requiredTableEngines = $this->requiredTableEngines($driver, $existingTables);
            $requiredTableEnginesValid = ! $this->hasTableEngines($driver)
                || collect($requiredTableEngines)->every(
                    fn (?string $engine): bool => $engine === 'InnoDB',
                );
            $requiredBinaryCollations = $this->requiredBinaryCollations($driver, $existingTables);
            $requiredBinaryCollationsValid = ! $this->hasTableEngines($driver)
                || collect($requiredBinaryCollations)
                    ->flatten()
                    ->every(fn (?string $collation): bool => $collation === 'utf8mb4_bin');
            $quotaEngine = $requiredTableEngines['ingestion_youtube_quota_daily'];
            $quotaEngineValid = ! $this->hasTableEngines($driver) || $quotaEngine === 'InnoDB';
            $ready = $missingTables === []
                && $missingColumns === []
                && $missingIndexes === []
                && $missingForeignKeys === []
                && $quotaUnique
                && $requiredTableEnginesValid
                && $requiredBinaryCollationsValid;

            return [
                'status' => $ready ? 'ready' : 'failed',
                'ready' => $ready,
                'driver' => $driver,
                'required_table_count' => count($requiredTables),
                'existing_required_table_count' => count($requiredTables) - count($missingTables),
                'missing_tables' => $missingTables,
                'missing_columns' => $missingColumns,
                'missing_indexes' => $missingIndexes,
                'missing_foreign_keys' => $missingForeignKeys,
                'quota_unique_index' => $quotaUnique,
                'quota_engine' => $quotaEngine,
                'quota_engine_valid' => $quotaEngineValid,
                'required_table_engines' => $requiredTableEngines,
                'required_table_engines_valid' => $requiredTableEnginesValid,
                'required_binary_collations' => $requiredBinaryCollations,
                'required_binary_collations_valid' => $requiredBinaryCollationsValid,
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
     *     indexes: array<string, list<array{kind: 'index'|'primary'|'unique', columns: list<string>}>>
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
     * @return list<array{kind: 'index'|'primary'|'unique', columns: list<string>}>
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
     * @param  array{kind: 'index'|'primary'|'unique', columns: list<string>}  $requiredIndex
     */
    private function hasRequiredIndex(array $existingIndexes, array $requiredIndex): bool
    {
        $requiredColumns = array_map('strtolower', $requiredIndex['columns']);

        foreach ($existingIndexes as $index) {
            $columns = array_map('strtolower', array_values($index['columns'] ?? []));
            $primary = (bool) ($index['primary'] ?? false);
            $unique = (bool) ($index['unique'] ?? false);
            $kindMatches = match ($requiredIndex['kind']) {
                'primary' => $primary,
                'unique' => $unique && ! $primary,
                'index' => ! $unique && ! $primary,
            };

            if ($kindMatches && $columns === $requiredColumns) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array{kind: 'index'|'primary'|'unique', columns: list<string>}  $index
     */
    private function indexLabel(array $index): string
    {
        return sprintf('%s(%s)', $index['kind'], implode(',', $index['columns']));
    }

    /**
     * @param  list<array<string, mixed>>  $existingForeignKeys
     * @param  array{
     *     columns: list<string>,
     *     foreign_table: string,
     *     foreign_columns: list<string>,
     *     on_delete: string
     * }  $requiredForeignKey
     */
    private function hasRequiredForeignKey(array $existingForeignKeys, array $requiredForeignKey): bool
    {
        $requiredColumns = array_map('strtolower', $requiredForeignKey['columns']);
        $requiredForeignColumns = array_map('strtolower', $requiredForeignKey['foreign_columns']);

        foreach ($existingForeignKeys as $foreignKey) {
            $columns = array_map('strtolower', array_values($foreignKey['columns'] ?? []));
            $foreignColumns = array_map('strtolower', array_values($foreignKey['foreign_columns'] ?? []));
            $foreignTable = strtolower($this->logicalTableName(
                (string) ($foreignKey['foreign_table'] ?? ''),
            ));
            $onDelete = strtolower((string) ($foreignKey['on_delete'] ?? ''));

            if (
                $columns === $requiredColumns
                && $foreignTable === strtolower($requiredForeignKey['foreign_table'])
                && $foreignColumns === $requiredForeignColumns
                && $onDelete === strtolower($requiredForeignKey['on_delete'])
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array{
     *     columns: list<string>,
     *     foreign_table: string,
     *     foreign_columns: list<string>,
     *     on_delete: string
     * }  $foreignKey
     */
    private function foreignKeyLabel(array $foreignKey): string
    {
        return sprintf(
            'foreign(%s)->%s(%s) on delete %s',
            implode(',', $foreignKey['columns']),
            $foreignKey['foreign_table'],
            implode(',', $foreignKey['foreign_columns']),
            $foreignKey['on_delete'],
        );
    }

    private function hasTableEngines(string $driver): bool
    {
        return in_array($driver, self::ENGINE_BEARING_DRIVERS, true);
    }

    /**
     * @param  list<string>  $existingTables
     * @return array<string, string|null>
     */
    private function requiredTableEngines(string $driver, array $existingTables): array
    {
        $engines = array_fill_keys(self::REQUIRED_INNODB_TABLES, null);

        if (! $this->hasTableEngines($driver)) {
            return $engines;
        }

        $tables = array_values(array_intersect(self::REQUIRED_INNODB_TABLES, $existingTables));

        if ($tables === []) {
            return $engines;
        }

        $prefix = DB::connection()->getTablePrefix();
        $physicalTables = array_map(
            fn (string $table): string => $prefix.$table,
            $tables,
        );
        $placeholders = implode(', ', array_fill(0, count($physicalTables), '?'));
        $storedEngines = collect(DB::select(
            'SELECT TABLE_NAME AS table_name, ENGINE AS engine '
            .'FROM information_schema.TABLES '
            .'WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('.$placeholders.')',
            [DB::connection()->getDatabaseName(), ...$physicalTables],
        ))->pluck('engine', 'table_name');

        foreach ($tables as $table) {
            $engine = $storedEngines->get($prefix.$table);
            $engines[$table] = is_string($engine) ? $engine : null;
        }

        return $engines;
    }

    /**
     * @param  list<string>  $existingTables
     * @return array<string, array<string, string|null>>
     */
    private function requiredBinaryCollations(string $driver, array $existingTables): array
    {
        $collations = [];

        foreach (self::REQUIRED_BINARY_COLLATION_COLUMNS as $table => $columns) {
            foreach (array_keys($columns) as $column) {
                $collations[$table][$column] = null;
            }
        }

        if (! $this->hasTableEngines($driver)) {
            return $collations;
        }

        $tables = array_values(array_intersect(
            array_keys(self::REQUIRED_BINARY_COLLATION_COLUMNS),
            $existingTables,
        ));

        if ($tables === []) {
            return $collations;
        }

        $prefix = DB::connection()->getTablePrefix();
        $physicalTables = array_map(
            fn (string $table): string => $prefix.$table,
            $tables,
        );
        $placeholders = implode(', ', array_fill(0, count($physicalTables), '?'));
        $rows = DB::select(
            'SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, '
            .'COLLATION_NAME AS collation_name FROM information_schema.COLUMNS '
            .'WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('.$placeholders.')',
            [DB::connection()->getDatabaseName(), ...$physicalTables],
        );

        foreach ($rows as $row) {
            $table = $this->logicalTableName((string) ($row->table_name ?? ''));
            $column = (string) ($row->column_name ?? '');

            if (array_key_exists($column, $collations[$table] ?? [])) {
                $collation = $row->collation_name ?? null;
                $collations[$table][$column] = is_string($collation) ? $collation : null;
            }
        }

        return $collations;
    }

    private function logicalTableName(string $table): string
    {
        if (str_contains($table, '.')) {
            $table = substr($table, (int) strrpos($table, '.') + 1);
        }

        $prefix = DB::connection()->getTablePrefix();

        return $prefix !== '' && str_starts_with($table, $prefix)
            ? substr($table, strlen($prefix))
            : $table;
    }
}
