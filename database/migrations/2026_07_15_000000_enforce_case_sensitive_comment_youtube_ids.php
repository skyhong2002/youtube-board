<?php

use App\Support\YoutubeIdentifierSchema;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
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

        $grammar = $connection->getQueryGrammar();
        $database = $connection->getDatabaseName();
        $prefix = $connection->getTablePrefix();

        foreach (self::COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            $modifications = [];

            foreach (array_keys($columns) as $column) {
                if (! Schema::hasColumn($table, $column)) {
                    continue;
                }

                $metadata = $connection->selectOne(
                    'SELECT DATA_TYPE AS data_type, '
                    .'CHARACTER_MAXIMUM_LENGTH AS character_maximum_length, '
                    .'IS_NULLABLE AS is_nullable, COLLATION_NAME AS collation_name '
                    .'FROM information_schema.COLUMNS '
                    .'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
                    [$database, $prefix.$table, $column],
                );

                if ($metadata === null || strtolower((string) ($metadata->data_type ?? '')) !== 'varchar') {
                    throw new RuntimeException("Unsupported YouTube identifier column: {$table}.{$column}");
                }

                $length = (int) ($metadata->character_maximum_length ?? 0);

                if ($length < 1) {
                    throw new RuntimeException("Invalid YouTube identifier length: {$table}.{$column}");
                }

                if ((string) ($metadata->collation_name ?? '') === 'utf8mb4_bin') {
                    continue;
                }

                $qualifiedColumn = $grammar->wrap($column);
                $nullability = strtoupper((string) ($metadata->is_nullable ?? 'NO')) === 'YES'
                    ? 'NULL'
                    : 'NOT NULL';
                $modifications[] = "MODIFY {$qualifiedColumn} VARCHAR({$length}) "
                    ."CHARACTER SET utf8mb4 COLLATE utf8mb4_bin {$nullability}";
            }

            if ($modifications !== []) {
                DB::statement(sprintf(
                    'ALTER TABLE %s %s',
                    $grammar->wrapTable($table),
                    implode(', ', $modifications),
                ));
            }
        }
    }

    public function down(): void
    {
        // Forward-only: reverting could merge distinct YouTube IDs or violate unique indexes.
    }
};
