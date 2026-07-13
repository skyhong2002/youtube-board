<?php

namespace Tests\Feature\Ops;

use App\Support\LegacyDashboardSchema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class DeploymentSchemaCheckTest extends TestCase
{
    public function test_deployment_schema_check_fails_closed_when_required_tables_are_missing(): void
    {
        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['ready']);
        $this->assertContains('urt_channel', $payload['missing_tables']);
        $this->assertSame('not_printed', $payload['secrets']);
    }

    public function test_health_route_fails_closed_when_deployment_schema_is_incomplete(): void
    {
        $this->get('/up')->assertStatus(500);
    }

    public function test_deployment_schema_check_accepts_a_complete_schema(): void
    {
        $this->createCompleteSchema();

        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(0, $exitCode, (string) json_encode($payload, JSON_UNESCAPED_SLASHES));
        $this->assertTrue($payload['ready']);
        $this->assertSame(63, $payload['required_table_count']);
        $this->assertSame([], $payload['missing_tables']);
        $this->assertSame([], $payload['missing_columns']);
        $this->assertSame([], $payload['missing_indexes']);
        $this->assertSame([], $payload['missing_foreign_keys']);
        $this->assertTrue($payload['quota_unique_index']);
        $this->assertNull($payload['quota_engine']);
        $this->assertTrue($payload['quota_engine_valid']);
        $this->assertSame([
            'ingestion_youtube_quota_daily' => null,
            'ingestion_runs' => null,
            'ingestion_run_jobs' => null,
        ], $payload['required_table_engines']);
        $this->assertTrue($payload['required_table_engines_valid']);
    }

    public function test_health_route_accepts_a_complete_deployment_schema(): void
    {
        $this->createCompleteSchema();

        $this->get('/up')->assertOk();
    }

    public function test_deployment_schema_check_rejects_adopted_tables_with_missing_columns(): void
    {
        $this->createCompleteSchema([
            'urt_channel' => ['title'],
            'jobs' => ['payload'],
            'urt_mayor_person_ai' => ['city_label'],
            'ingestion_runs' => ['payload_json'],
            'ingestion_run_jobs' => ['finished_at'],
        ]);

        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['ready']);
        $this->assertSame(['title'], $payload['missing_columns']['urt_channel']);
        $this->assertSame(['payload'], $payload['missing_columns']['jobs']);
        $this->assertSame(['city_label'], $payload['missing_columns']['urt_mayor_person_ai']);
        $this->assertSame(['payload_json'], $payload['missing_columns']['ingestion_runs']);
        $this->assertSame(['finished_at'], $payload['missing_columns']['ingestion_run_jobs']);
    }

    public function test_deployment_schema_check_rejects_missing_critical_indexes(): void
    {
        $this->createCompleteSchema([], [
            'urt_channel' => ['unique(youtube_id)'],
            'users' => ['primary(id)'],
            'urt_mayor_person_ai' => ['primary(pk)'],
            'ingestion_runs' => [
                'primary(id)',
                'index(recorded_at)',
                'index(request_source,request_mode,result_mode,recorded_at)',
            ],
            'ingestion_run_jobs' => [
                'primary(run_id,job_key)',
                'index(job_key,attempted,recorded_at)',
                'index(job_key,succeeded,recorded_at)',
            ],
        ]);

        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['ready']);
        $this->assertSame(['unique(youtube_id)'], $payload['missing_indexes']['urt_channel']);
        $this->assertSame(['primary(id)'], $payload['missing_indexes']['users']);
        $this->assertSame(['primary(pk)'], $payload['missing_indexes']['urt_mayor_person_ai']);
        $this->assertSame([
            'primary(id)',
            'index(recorded_at)',
            'index(request_source,request_mode,result_mode,recorded_at)',
        ], $payload['missing_indexes']['ingestion_runs']);
        $this->assertSame([
            'primary(run_id,job_key)',
            'index(job_key,attempted,recorded_at)',
            'index(job_key,succeeded,recorded_at)',
        ], $payload['missing_indexes']['ingestion_run_jobs']);
    }

    public function test_deployment_schema_check_rejects_missing_ingestion_run_cascade_foreign_key(): void
    {
        $this->createCompleteSchema([], [], [
            'ingestion_run_jobs' => ['foreign(run_id)->ingestion_runs(id) on delete cascade'],
        ]);

        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['ready']);
        $this->assertSame(
            ['foreign(run_id)->ingestion_runs(id) on delete cascade'],
            $payload['missing_foreign_keys']['ingestion_run_jobs'],
        );
    }

    /**
     * @param  array<string, list<string>>  $omittedColumns
     * @param  array<string, list<string>>  $omittedIndexes
     * @param  array<string, list<string>>  $omittedForeignKeys
     */
    private function createCompleteSchema(
        array $omittedColumns = [],
        array $omittedIndexes = [],
        array $omittedForeignKeys = [],
    ): void {
        foreach (LegacyDashboardSchema::statements(database_path('schema/legacy-dashboard-baseline.sql')) as $statement) {
            preg_match_all('/^\s*`([^`]+)`\s+/m', $statement['sql'], $columnMatches);
            preg_match('/^\s*PRIMARY KEY\s*\(([^)]+)\)/mi', $statement['sql'], $primaryMatch);
            preg_match_all('/^\s*UNIQUE KEY\s+`[^`]+`\s*\(([^)]+)\)/mi', $statement['sql'], $uniqueMatches);

            $primary = $this->parseIndexColumns($primaryMatch[1]);
            $unique = array_map($this->parseIndexColumns(...), $uniqueMatches[1] ?? []);

            $this->createTable(
                $statement['table'],
                array_values($columnMatches[1]),
                $primary,
                $unique,
                $omittedColumns[$statement['table']] ?? [],
                $omittedIndexes[$statement['table']] ?? [],
            );
        }

        $tables = [
            'migrations' => [['id', 'migration', 'batch'], ['id'], []],
            'users' => [[
                'id', 'name', 'email', 'email_verified_at', 'password', 'remember_token', 'created_at', 'updated_at',
            ], ['id'], [['email']]],
            'password_reset_tokens' => [['email', 'token', 'created_at'], ['email'], []],
            'sessions' => [[
                'id', 'user_id', 'ip_address', 'user_agent', 'payload', 'last_activity',
            ], ['id'], []],
            'cache' => [['key', 'value', 'expiration'], ['key'], []],
            'cache_locks' => [['key', 'owner', 'expiration'], ['key'], []],
            'jobs' => [[
                'id', 'queue', 'payload', 'attempts', 'reserved_at', 'available_at', 'created_at',
            ], ['id'], []],
            'job_batches' => [[
                'id', 'name', 'total_jobs', 'pending_jobs', 'failed_jobs', 'failed_job_ids', 'options',
                'cancelled_at', 'created_at', 'finished_at',
            ], ['id'], []],
            'failed_jobs' => [[
                'id', 'uuid', 'connection', 'queue', 'payload', 'exception', 'failed_at',
            ], ['id'], [['uuid']]],
            'urt_mayor_person_ai' => [[
                'pk', 'ctime', 'mtime', 'city_key', 'city_label', 'person', 'the_date', 'ai_type', 'provider',
                'user_token', 'prompt_json', 'source_json', 'result_json', 'del_flag',
            ], ['pk'], []],
            'ingestion_runs' => [[
                'id', 'recorded_at', 'request_source', 'request_mode', 'result_mode', 'payload_json',
                'created_at', 'updated_at',
            ], ['id'], []],
            'ingestion_run_jobs' => [[
                'run_id', 'job_key', 'recorded_at', 'attempted', 'succeeded', 'failed', 'action', 'exit_code',
                'started_at', 'finished_at', 'created_at', 'updated_at',
            ], ['run_id', 'job_key'], []],
        ];
        $secondaryIndexes = [
            'ingestion_runs' => [
                ['recorded_at'],
                ['request_source', 'request_mode', 'result_mode', 'recorded_at'],
            ],
            'ingestion_run_jobs' => [
                ['job_key', 'attempted', 'recorded_at'],
                ['job_key', 'succeeded', 'recorded_at'],
            ],
        ];
        $foreignKeys = [
            'ingestion_run_jobs' => [[
                'columns' => ['run_id'],
                'foreign_table' => 'ingestion_runs',
                'foreign_columns' => ['id'],
                'on_delete' => 'cascade',
            ]],
        ];

        $historyOverrides = array_intersect(
            [
                ...array_keys($omittedColumns),
                ...array_keys($omittedIndexes),
                ...array_keys($omittedForeignKeys),
            ],
            ['ingestion_runs', 'ingestion_run_jobs'],
        );

        if ($historyOverrides !== []) {
            Schema::dropIfExists('ingestion_run_jobs');
            Schema::dropIfExists('ingestion_runs');
        }

        foreach ($tables as $table => [$columns, $primary, $unique]) {
            if (Schema::hasTable($table)) {
                continue;
            }

            $this->createTable(
                $table,
                $columns,
                $primary,
                $unique,
                $omittedColumns[$table] ?? [],
                $omittedIndexes[$table] ?? [],
                $secondaryIndexes[$table] ?? [],
                $foreignKeys[$table] ?? [],
                $omittedForeignKeys[$table] ?? [],
            );
        }
    }

    /**
     * @param  list<string>  $columns
     * @param  list<string>  $primary
     * @param  list<list<string>>  $unique
     * @param  list<string>  $omittedColumns
     * @param  list<string>  $omittedIndexes
     * @param  list<list<string>>  $indexes
     * @param  list<array{
     *     columns: list<string>,
     *     foreign_table: string,
     *     foreign_columns: list<string>,
     *     on_delete: string
     * }>  $foreignKeys
     * @param  list<string>  $omittedForeignKeys
     */
    private function createTable(
        string $name,
        array $columns,
        array $primary,
        array $unique,
        array $omittedColumns,
        array $omittedIndexes,
        array $indexes = [],
        array $foreignKeys = [],
        array $omittedForeignKeys = [],
    ): void {
        Schema::create($name, function (Blueprint $table) use (
            $columns,
            $foreignKeys,
            $indexes,
            $omittedForeignKeys,
            $primary,
            $unique,
            $omittedColumns,
            $omittedIndexes,
        ): void {
            foreach (array_diff($columns, $omittedColumns) as $column) {
                $table->string($column)->nullable();
            }

            if (! in_array($this->indexLabel('primary', $primary), $omittedIndexes, true)) {
                $table->primary($primary);
            }

            foreach ($unique as $columns) {
                if (! in_array($this->indexLabel('unique', $columns), $omittedIndexes, true)) {
                    $table->unique($columns);
                }
            }

            foreach ($indexes as $columns) {
                if (! in_array($this->indexLabel('index', $columns), $omittedIndexes, true)) {
                    $table->index($columns);
                }
            }

            foreach ($foreignKeys as $foreignKey) {
                if (in_array($this->foreignKeyLabel($foreignKey), $omittedForeignKeys, true)) {
                    continue;
                }

                $table->foreign($foreignKey['columns'])
                    ->references($foreignKey['foreign_columns'])
                    ->on($foreignKey['foreign_table'])
                    ->onDelete($foreignKey['on_delete']);
            }
        });
    }

    /**
     * @return list<string>
     */
    private function parseIndexColumns(string $definition): array
    {
        preg_match_all('/`([^`]+)`/', $definition, $matches);

        return array_values($matches[1]);
    }

    /**
     * @param  list<string>  $columns
     */
    private function indexLabel(string $kind, array $columns): string
    {
        return sprintf('%s(%s)', $kind, implode(',', $columns));
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
}
