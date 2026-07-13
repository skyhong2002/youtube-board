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
        $this->assertSame(61, $payload['required_table_count']);
        $this->assertSame([], $payload['missing_tables']);
        $this->assertSame([], $payload['missing_columns']);
        $this->assertSame([], $payload['missing_indexes']);
        $this->assertTrue($payload['quota_unique_index']);
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
        ]);

        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['ready']);
        $this->assertSame(['title'], $payload['missing_columns']['urt_channel']);
        $this->assertSame(['payload'], $payload['missing_columns']['jobs']);
        $this->assertSame(['city_label'], $payload['missing_columns']['urt_mayor_person_ai']);
    }

    public function test_deployment_schema_check_rejects_missing_identity_and_idempotency_indexes(): void
    {
        $this->createCompleteSchema([], [
            'urt_channel' => ['unique(youtube_id)'],
            'users' => ['primary(id)'],
            'urt_mayor_person_ai' => ['primary(pk)'],
        ]);

        $exitCode = Artisan::call('deployment:schema-check', ['--json' => true]);
        $payload = json_decode(Artisan::output(), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $exitCode);
        $this->assertFalse($payload['ready']);
        $this->assertSame(['unique(youtube_id)'], $payload['missing_indexes']['urt_channel']);
        $this->assertSame(['primary(id)'], $payload['missing_indexes']['users']);
        $this->assertSame(['primary(pk)'], $payload['missing_indexes']['urt_mayor_person_ai']);
    }

    /**
     * @param  array<string, list<string>>  $omittedColumns
     * @param  array<string, list<string>>  $omittedIndexes
     */
    private function createCompleteSchema(array $omittedColumns = [], array $omittedIndexes = []): void
    {
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
        ];

        foreach ($tables as $table => [$columns, $primary, $unique]) {
            $this->createTable(
                $table,
                $columns,
                $primary,
                $unique,
                $omittedColumns[$table] ?? [],
                $omittedIndexes[$table] ?? [],
            );
        }
    }

    /**
     * @param  list<string>  $columns
     * @param  list<string>  $primary
     * @param  list<list<string>>  $unique
     * @param  list<string>  $omittedColumns
     * @param  list<string>  $omittedIndexes
     */
    private function createTable(
        string $name,
        array $columns,
        array $primary,
        array $unique,
        array $omittedColumns,
        array $omittedIndexes,
    ): void {
        Schema::create($name, function (Blueprint $table) use (
            $columns,
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
}
