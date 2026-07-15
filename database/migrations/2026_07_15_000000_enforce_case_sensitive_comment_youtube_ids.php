<?php

use App\Support\YoutubeIdentifierSchema;
use Illuminate\Database\Connection;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const LOCK_WAIT_TIMEOUT_SECONDS = 15;

    private const PRODUCTION_APPROVAL_ENV = 'YOUTUBE_IDENTIFIER_SCHEMA_MIGRATION_APPROVED';

    /**
     * @var array<string, array<string, array{length: int, nullable: bool}>>
     */
    private const COLUMNS = YoutubeIdentifierSchema::COLUMNS;

    public function up(): void
    {
        $connection = DB::connection();

        if (! in_array($connection->getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        $metadata = $this->preflight($connection);
        $grammar = $connection->getQueryGrammar();
        $modificationsByTable = [];

        foreach (self::COLUMNS as $table => $columns) {
            foreach ($columns as $column => $definition) {
                if ($metadata[$table][$column]['collation'] === YoutubeIdentifierSchema::COLLATION) {
                    continue;
                }

                $qualifiedColumn = $grammar->wrap($column);
                $nullability = $definition['nullable']
                    ? 'NULL DEFAULT NULL'
                    : 'NOT NULL';
                $modificationsByTable[$table][] = sprintf(
                    'MODIFY %s VARCHAR(%d) CHARACTER SET %s COLLATE %s %s',
                    $qualifiedColumn,
                    $definition['length'],
                    YoutubeIdentifierSchema::CHARACTER_SET,
                    YoutubeIdentifierSchema::COLLATION,
                    $nullability,
                );
            }
        }

        if ($modificationsByTable === []) {
            return;
        }

        $this->assertProductionApproval();
        $originalLockWaitTimeout = $this->lockWaitTimeout($connection);
        $connection->statement('SET SESSION lock_wait_timeout = '.self::LOCK_WAIT_TIMEOUT_SECONDS);

        try {
            foreach ($modificationsByTable as $table => $modifications) {
                DB::statement(sprintf(
                    'ALTER TABLE %s %s',
                    $grammar->wrapTable($table),
                    implode(', ', $modifications),
                ));
            }
        } finally {
            $connection->statement('SET SESSION lock_wait_timeout = '.$originalLockWaitTimeout);
        }
    }

    public function down(): void
    {
        // Forward-only: reverting could merge distinct YouTube IDs or violate unique indexes.
    }

    /**
     * Read and validate the complete 23-table, 32-column graph before the
     * first non-transactional MyISAM ALTER TABLE can run.
     *
     * @return array<string, array<string, array{
     *     data_type: string,
     *     column_type: string,
     *     character_maximum_length: int,
     *     nullable: bool,
     *     character_set: string|null,
     *     collation: string|null,
     *     default_is_null: bool,
     *     extra: string,
     *     comment: string,
     *     generation_expression: string
     * }>>
     */
    private function preflight(Connection $connection): array
    {
        $database = $connection->getDatabaseName();
        $prefix = $connection->getTablePrefix();
        $physicalTables = array_map(
            fn (string $table): string => $prefix.$table,
            array_keys(self::COLUMNS),
        );
        $placeholders = implode(', ', array_fill(0, count($physicalTables), '?'));
        $tableRows = $connection->select(
            'SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type '
            .'FROM information_schema.TABLES '
            .'WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('.$placeholders.')',
            [$database, ...$physicalTables],
        );
        $columnRows = $connection->select(
            'SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, '
            .'DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, '
            .'CHARACTER_MAXIMUM_LENGTH AS character_maximum_length, '
            .'IS_NULLABLE AS is_nullable, CHARACTER_SET_NAME AS character_set_name, '
            ."COLLATION_NAME AS collation_name, CASE WHEN COLUMN_DEFAULT IS NULL "
            ."OR COLUMN_DEFAULT = 'NULL' THEN 1 ELSE 0 END AS default_is_null, "
            .'EXTRA AS extra, COLUMN_COMMENT AS column_comment, '
            .'GENERATION_EXPRESSION AS generation_expression '
            .'FROM information_schema.COLUMNS '
            .'WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('.$placeholders.')',
            [$database, ...$physicalTables],
        );
        $tableTypes = [];
        $rowsByTable = [];

        foreach ($tableRows as $row) {
            $tableTypes[(string) ($row->table_name ?? '')] = strtoupper((string) ($row->table_type ?? ''));
        }

        foreach ($columnRows as $row) {
            $rowsByTable[(string) ($row->table_name ?? '')][(string) ($row->column_name ?? '')] = $row;
        }

        $metadata = [];
        $issues = [];

        foreach (self::COLUMNS as $table => $columns) {
            $physicalTable = $prefix.$table;

            if (! array_key_exists($physicalTable, $tableTypes)) {
                $issues[$table.'.*'][] = 'missing_table';

                continue;
            }

            if ($tableTypes[$physicalTable] !== 'BASE TABLE') {
                $issues[$table.'.*'][] = 'not_base_table';

                continue;
            }

            foreach ($columns as $column => $definition) {
                $row = $rowsByTable[$physicalTable][$column] ?? null;
                $columnMetadata = is_object($row)
                    ? YoutubeIdentifierSchema::normalizeMetadata($row)
                    : null;
                $columnIssues = YoutubeIdentifierSchema::metadataIssues(
                    $definition,
                    $columnMetadata,
                    false,
                );

                if ($columnIssues !== []) {
                    $issues[$table.'.'.$column] = $columnIssues;
                }

                if ($columnMetadata !== null) {
                    $metadata[$table][$column] = $columnMetadata;
                }
            }
        }

        if ($issues !== []) {
            $labels = [];

            foreach ($issues as $qualifiedColumn => $columnIssues) {
                $labels[] = $qualifiedColumn.'['.implode(',', $columnIssues).']';
            }

            throw new RuntimeException('Unsafe YouTube identifier schema: '.implode('; ', $labels));
        }

        return $metadata;
    }

    private function assertProductionApproval(): void
    {
        if (! app()->environment('production')) {
            return;
        }

        $value = $_SERVER[self::PRODUCTION_APPROVAL_ENV]
            ?? $_ENV[self::PRODUCTION_APPROVAL_ENV]
            ?? getenv(self::PRODUCTION_APPROVAL_ENV);
        $approved = $value === true
            || $value === 1
            || in_array(strtolower(trim((string) $value)), ['1', 'true'], true);

        if (! $approved) {
            throw new RuntimeException(
                'Production YouTube identifier migration requires '
                .self::PRODUCTION_APPROVAL_ENV.'=true.',
            );
        }
    }

    private function lockWaitTimeout(Connection $connection): int
    {
        $row = $connection->selectOne(
            'SELECT @@SESSION.lock_wait_timeout AS lock_wait_timeout',
        );
        $value = $row->lock_wait_timeout ?? null;

        if (! is_numeric($value) || (int) $value < 1) {
            throw new RuntimeException('Unable to read the MariaDB session lock_wait_timeout.');
        }

        return (int) $value;
    }
};
