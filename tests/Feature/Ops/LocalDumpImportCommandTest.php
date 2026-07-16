<?php

namespace Tests\Feature\Ops;

use App\Services\LocalDumpImportRunner;
use App\Services\LocalDumpInspector;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Mockery;
use Tests\TestCase;

class LocalDumpImportCommandTest extends TestCase
{
    private string $dumpDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->dumpDirectory = sys_get_temp_dir().'/youtube-board-dump-import-'.bin2hex(random_bytes(8));
        mkdir($this->dumpDirectory, 0700, true);

        config()->set('local_import.directory', $this->dumpDirectory);
        config()->set('local_import.audit_directory', $this->dumpDirectory.'/audit');
        config()->set('local_import.staging_directory', $this->dumpDirectory.'/staging');
        config()->set('database.default', 'mysql');
        config()->set('database.connections.mysql.host', 'mysql');
        config()->set('database.connections.mysql.database', 'youtube_board');
        config()->set('database.connections.mysql.username', 'youtube_board');
        config()->set('database.connections.mysql.password', 'not-used-by-tests');
        config()->set('cache.default', 'array');
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dumpDirectory.'/*') ?: [] as $file) {
            if (is_dir($file)) {
                foreach (glob($file.'/*') ?: [] as $nestedFile) {
                    @unlink($nestedFile);
                }
                @rmdir($file);
            } else {
                @unlink($file);
            }
        }
        @rmdir($this->dumpDirectory);

        parent::tearDown();
    }

    public function test_repository_provides_an_empty_ignored_dump_intake_directory(): void
    {
        $intakeDirectory = storage_path('app/db-dumps');

        $this->assertDirectoryExists($intakeDirectory);
        $this->assertFileExists($intakeDirectory.'/.gitignore');
        $this->assertSame("*\n!.gitignore\n", file_get_contents($intakeDirectory.'/.gitignore'));
        $this->assertStringContainsString(
            '!db-dumps/',
            (string) file_get_contents(storage_path('app/.gitignore')),
        );
        $this->assertStringNotContainsString(
            '/storage/app/db-dumps/',
            (string) file_get_contents(base_path('.gitignore')),
        );
    }

    public function test_preview_verifies_checksum_without_running_the_database_client(): void
    {
        $contents = "CREATE TABLE IF NOT EXISTS `urt_tag` (`tag_id` int NOT NULL);\n";
        file_put_contents($this->dumpDirectory.'/approved.sql', $contents);
        $sha256 = hash('sha256', $contents);

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->once();
        $runner->shouldNotReceive('run');
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--sha256' => $sha256,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('preview', $payload['mode']);
        $this->assertTrue($payload['dry_run']);
        $this->assertSame('ready', $payload['status']);
        $this->assertSame('approved.sql', $payload['file']);
        $this->assertSame($sha256, $payload['sha256']);
        $this->assertSame(['urt_tag'], $payload['tables']);
        $this->assertFalse($payload['replacement_required']);
        $this->assertStringNotContainsString($this->dumpDirectory, Artisan::output());
        $this->assertNoStagedArtifacts();
    }

    public function test_explicit_dry_run_never_invokes_the_database_client(): void
    {
        file_put_contents($this->dumpDirectory.'/approved.sql', "CREATE TABLE `urt_tag` (`tag_id` int);\n");

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->once();
        $runner->shouldNotReceive('run');
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--dry-run' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('preview', $payload['mode']);
        $this->assertTrue($payload['dry_run']);
        $this->assertDirectoryDoesNotExist($this->dumpDirectory.'/audit');
    }

    public function test_dry_run_and_execute_conflict_is_refused_before_any_write(): void
    {
        file_put_contents($this->dumpDirectory.'/approved.sql', "CREATE TABLE `urt_tag` (`tag_id` int);\n");

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldNotReceive('assertLocalTarget');
        $runner->shouldNotReceive('run');
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--dry-run' => true,
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('conflicting_execution_modes', $payload['error_code']);
        $this->assertDirectoryDoesNotExist($this->dumpDirectory.'/audit');
    }

    public function test_execute_requires_explicit_replacement_confirmation_for_drop_statements(): void
    {
        $contents = <<<'SQL'
DROP TABLE IF EXISTS `urt_tag`;
CREATE TABLE `urt_tag` (`tag_id` int NOT NULL);
SQL;
        file_put_contents($this->dumpDirectory.'/replacement.sql', $contents);

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->once();
        $runner->shouldNotReceive('run');
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'replacement.sql',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('replace_existing_confirmation_required', $payload['error_code']);
        $this->assertNoStagedArtifacts();
    }

    public function test_explicit_execute_uses_the_lock_and_sanitized_payload(): void
    {
        $contents = <<<'SQL'
DROP TABLE IF EXISTS `urt_tag`;
CREATE TABLE `urt_tag` (`tag_id` int NOT NULL);
SQL;
        file_put_contents($this->dumpDirectory.'/replacement.sql', $contents);

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->once();
        $runner->shouldReceive('run')
            ->once()
            ->with(Mockery::on(fn (array $inspection): bool => $inspection['file'] === 'replacement.sql'), 900);
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'replacement.sql',
            '--execute' => true,
            '--replace-existing' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('completed', $payload['status']);
        $this->assertSame('local_mysql_only', $payload['write_target']);
        $this->assertSame('not_printed', $payload['secrets']);
        $this->assertMatchesRegularExpression('/\A\d{8}T\d{6}Z-[a-f0-9]{12}-[a-f0-9]{8}\z/', $payload['audit_id']);
        $this->assertStringNotContainsString('not-used-by-tests', Artisan::output());
        $this->assertStringNotContainsString($this->dumpDirectory, Artisan::output());

        $auditFiles = glob($this->dumpDirectory.'/audit/*.json') ?: [];
        $this->assertCount(1, $auditFiles);
        $audit = file_get_contents($auditFiles[0]);
        $this->assertIsString($audit);
        $this->assertStringContainsString('"status": "completed"', $audit);
        $this->assertStringContainsString('"secrets": "not_recorded"', $audit);
        $this->assertStringNotContainsString('not-used-by-tests', $audit);
        $this->assertStringNotContainsString($this->dumpDirectory, $audit);
        $this->assertNoStagedArtifacts();
    }

    public function test_execute_refuses_when_the_checksum_does_not_match(): void
    {
        file_put_contents($this->dumpDirectory.'/approved.sql', "CREATE TABLE `urt_tag` (`tag_id` int);\n");

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->once();
        $runner->shouldNotReceive('run');
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--execute' => true,
            '--sha256' => str_repeat('0', 64),
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('checksum_mismatch', $payload['error_code']);
    }

    public function test_path_traversal_and_tables_outside_the_dashboard_allowlist_are_refused(): void
    {
        file_put_contents($this->dumpDirectory.'/unsafe.sql', "DROP TABLE IF EXISTS `users`;\n");

        $traversalExit = Artisan::call('db:import-local', [
            'file' => '../unsafe.sql',
            '--json' => true,
        ]);
        $traversal = json_decode(trim(Artisan::output()), true);

        $unsafeExit = Artisan::call('db:import-local', [
            'file' => 'unsafe.sql',
            '--json' => true,
        ]);
        $unsafe = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $traversalExit);
        $this->assertContains($traversal['error_code'], ['invalid_dump_filename', 'dump_file_unavailable']);
        $this->assertSame(1, $unsafeExit);
        $this->assertSame('unsafe_sql_refused', $unsafe['error_code']);
    }

    public function test_trigger_routine_and_lock_table_statements_are_refused(): void
    {
        file_put_contents($this->dumpDirectory.'/trigger.sql', <<<'SQL'
CREATE TRIGGER `urt_tag_audit` BEFORE INSERT ON `urt_tag` FOR EACH ROW SET @seen = 1;
LOCK TABLES `urt_tag` WRITE;
CALL rebuild_dashboard();
SQL);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'trigger.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('unsafe_sql_refused', $payload['error_code']);
    }

    public function test_same_line_forbidden_statements_and_mysql_executable_comments_are_refused(): void
    {
        file_put_contents(
            $this->dumpDirectory.'/same-line.sql',
            "CREATE TABLE `urt_tag` (`tag_id` int); DROP DATABASE `youtube_board`;\n",
        );
        file_put_contents(
            $this->dumpDirectory.'/executable-comment.sql',
            "/*!50003 CREATE DEFINER=`root`@`localhost` TRIGGER dangerous BEFORE INSERT ON urt_tag FOR EACH ROW SET @x=1 */;\n",
        );

        foreach (['same-line.sql', 'executable-comment.sql'] as $file) {
            $exitCode = Artisan::call('db:import-local', [
                'file' => $file,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('unsafe_sql_refused', $payload['error_code']);
        }
    }

    public function test_comments_cannot_hide_forbidden_statements_and_load_xml_is_refused(): void
    {
        file_put_contents(
            $this->dumpDirectory.'/comment-hidden.sql',
            "CREATE TABLE `urt_tag` (`tag_id` int); /* reviewed */ DROP DATABASE `youtube_board`;\n",
        );
        file_put_contents(
            $this->dumpDirectory.'/load-xml.sql',
            "LOAD XML LOCAL INFILE 'rows.xml' INTO TABLE `urt_tag`;\n",
        );

        foreach (['comment-hidden.sql', 'load-xml.sql'] as $file) {
            $exitCode = Artisan::call('db:import-local', [
                'file' => $file,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('unsafe_sql_refused', $payload['error_code']);
        }
    }

    public function test_long_cross_chunk_comment_cannot_hide_a_following_drop(): void
    {
        $contents = str_repeat(' ', (1024 * 1024) - 128)
            .'/*'.str_repeat('x', 1024).'*/ DROP DATABASE `youtube_board`;';
        file_put_contents($this->dumpDirectory.'/cross-chunk-comment.sql', $contents);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'cross-chunk-comment.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('unsafe_sql_refused', $payload['error_code']);
    }

    public function test_unknown_and_unterminated_top_level_statements_fail_closed(): void
    {
        file_put_contents($this->dumpDirectory.'/unknown.sql', "SHOW TABLES;\n");
        file_put_contents($this->dumpDirectory.'/unterminated.sql', "INSERT INTO `urt_tag` VALUES (1)\n");

        foreach (['unknown.sql', 'unterminated.sql'] as $file) {
            $exitCode = Artisan::call('db:import-local', [
                'file' => $file,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('unsafe_sql_refused', $payload['error_code']);
        }
    }

    public function test_semicolons_and_comment_markers_inside_insert_strings_are_data(): void
    {
        file_put_contents(
            $this->dumpDirectory.'/quoted-data.sql',
            "INSERT INTO `urt_tag` VALUES (1, 'semi; /* not a comment */ -- still data');\n",
        );

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'quoted-data.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['create_table' => 0, 'drop_table' => 0, 'insert' => 1], $payload['statements']);
        $this->assertSame(['urt_tag'], $payload['tables']);
    }

    public function test_insert_values_accepts_only_literal_rows(): void
    {
        file_put_contents(
            $this->dumpDirectory.'/literal-values.sql',
            <<<'SQL'
INSERT INTO `urt_tag` (`tag_id`, `tag`, `status`) VALUES
  (1, NULL, 'LOAD_FILE(''/etc/passwd'')'),
  (-2, 0x4142, _binary'bytes'),
  (3, 1.25e-3, 'quoted');
SQL,
        );

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'literal-values.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame(['create_table' => 0, 'drop_table' => 0, 'insert' => 1], $payload['statements']);
        $this->assertSame(['urt_tag'], $payload['tables']);
    }

    public function test_insert_values_refuses_expressions_subqueries_and_trailing_clauses(): void
    {
        $unsafeStatements = [
            'load-file.sql' => "INSERT INTO `urt_tag` VALUES (1, LOAD_FILE('/etc/passwd'));\n",
            'subquery.sql' => "INSERT INTO `urt_tag` VALUES ((SELECT MAX(tag_id) FROM urt_tag));\n",
            'expression.sql' => "INSERT INTO `urt_tag` VALUES (1 + 1);\n",
            'on-duplicate.sql' => "INSERT INTO `urt_tag` VALUES (1) ON DUPLICATE KEY UPDATE tag_id=2;\n",
        ];

        foreach ($unsafeStatements as $file => $statement) {
            file_put_contents($this->dumpDirectory.'/'.$file, $statement);

            $exitCode = Artisan::call('db:import-local', [
                'file' => $file,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode, $file);
            $this->assertSame('unsafe_sql_refused', $payload['error_code'], $file);
        }
    }

    public function test_only_narrow_dump_session_set_statements_are_allowed(): void
    {
        file_put_contents($this->dumpDirectory.'/safe-set.sql', <<<'SQL'
SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT;
SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT;
SET FOREIGN_KEY_CHECKS=0;
SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';
SET NAMES utf8mb4;
CREATE TABLE `urt_tag` (`tag_id` int);
SQL);
        file_put_contents($this->dumpDirectory.'/global-set.sql', "SET GLOBAL FOREIGN_KEY_CHECKS=0;\n");
        file_put_contents($this->dumpDirectory.'/unsafe-sql-mode.sql', "SET SQL_MODE='NO_BACKSLASH_ESCAPES';\n");

        $safeExit = Artisan::call('db:import-local', [
            'file' => 'safe-set.sql',
            '--json' => true,
        ]);
        $safe = json_decode(trim(Artisan::output()), true);
        $unsafeExit = Artisan::call('db:import-local', [
            'file' => 'global-set.sql',
            '--json' => true,
        ]);
        $unsafe = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $safeExit);
        $this->assertSame(['create_table' => 1, 'drop_table' => 0, 'insert' => 0], $safe['statements']);
        $this->assertSame(1, $unsafeExit);
        $this->assertSame('unsafe_sql_refused', $unsafe['error_code']);

        $unsafeModeExit = Artisan::call('db:import-local', [
            'file' => 'unsafe-sql-mode.sql',
            '--json' => true,
        ]);
        $unsafeMode = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $unsafeModeExit);
        $this->assertSame('unsafe_sql_refused', $unsafeMode['error_code']);
    }

    public function test_multi_table_drop_cannot_hide_a_framework_table_after_an_allowed_table(): void
    {
        file_put_contents(
            $this->dumpDirectory.'/multi-drop.sql',
            "DROP TABLE IF EXISTS `urt_tag`, `users`;\n",
        );

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'multi-drop.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('unsafe_sql_refused', $payload['error_code']);
    }

    public function test_non_local_database_host_is_refused_before_file_inspection(): void
    {
        file_put_contents($this->dumpDirectory.'/approved.sql', "CREATE TABLE `urt_tag` (`tag_id` int);\n");
        config()->set('database.connections.mysql.host', 'production-db.internal');

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('remote_database_refused', $payload['error_code']);
    }

    public function test_default_allowlist_refuses_localhost_to_prevent_tunneled_production_imports(): void
    {
        file_put_contents($this->dumpDirectory.'/approved.sql', "CREATE TABLE `urt_tag` (`tag_id` int);\n");
        config()->set('local_import.allowed_hosts', ['mysql', 'mariadb']);
        config()->set('database.connections.mysql.host', 'localhost');

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('remote_database_refused', $payload['error_code']);
        $this->assertNoStagedArtifacts();
    }

    public function test_production_environment_is_always_refused(): void
    {
        file_put_contents($this->dumpDirectory.'/approved.sql', "CREATE TABLE `urt_tag` (`tag_id` int);\n");
        $this->app['env'] = 'production';

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(1, $exitCode);
        $this->assertSame('local_environment_required', $payload['error_code']);
    }

    public function test_gzip_preview_inspects_expanded_sql_and_reports_both_size_caps(): void
    {
        $contents = "CREATE TABLE `urt_tag` (`tag_id` int);\n";
        file_put_contents($this->dumpDirectory.'/approved.sql.gz', gzencode($contents));

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql.gz',
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertTrue($payload['compressed']);
        $this->assertSame(strlen($contents), $payload['expanded_bytes']);
        $this->assertGreaterThan(0, $payload['size_bytes']);
    }

    public function test_gzip_execute_imports_the_exact_expanded_bytes_and_cleans_staging(): void
    {
        $contents = "CREATE TABLE `urt_tag` (`tag_id` int);\n";
        $archive = gzencode($contents);
        $captured = $this->dumpDirectory.'/captured.sql';
        $client = $this->dumpDirectory.'/fake-mariadb';
        file_put_contents($this->dumpDirectory.'/approved.sql.gz', $archive);
        file_put_contents($client, "#!/bin/sh\n/bin/cat > ".escapeshellarg($captured)."\n");
        chmod($client, 0700);
        config()->set('local_import.client', $client);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql.gz',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertTrue($payload['compressed']);
        $this->assertSame(hash('sha256', $archive), $payload['sha256']);
        $this->assertSame($contents, file_get_contents($captured));
        $this->assertNoStagedArtifacts();
    }

    public function test_existing_global_import_lock_refuses_a_different_artifact(): void
    {
        $contents = "CREATE TABLE `urt_tag` (`tag_id` int);\n";
        file_put_contents($this->dumpDirectory.'/approved.sql', $contents);
        $lock = Cache::lock('local-dump-import:global', 60);
        $this->assertTrue($lock->get());

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->once();
        $runner->shouldNotReceive('run');
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        try {
            $exitCode = Artisan::call('db:import-local', [
                'file' => 'approved.sql',
                '--execute' => true,
                '--json' => true,
            ]);
            $payload = json_decode(trim(Artisan::output()), true);

            $this->assertSame(1, $exitCode);
            $this->assertSame('dump_import_locked', $payload['error_code']);
        } finally {
            $lock->release();
        }
    }

    public function test_source_path_swap_between_hashing_and_lexing_cannot_change_reviewed_or_imported_bytes(): void
    {
        $path = $this->dumpDirectory.'/approved.sql';
        $captured = $this->dumpDirectory.'/captured.sql';
        $client = $this->dumpDirectory.'/fake-mariadb';
        $original = "CREATE TABLE `urt_tag` (`tag_id` int);\n";
        $replacement = "DROP DATABASE `youtube_board`;\n";
        file_put_contents($path, $original);
        file_put_contents($client, "#!/bin/sh\n/bin/cat > ".escapeshellarg($captured)."\n");
        chmod($client, 0700);
        config()->set('local_import.client', $client);

        $inspector = new class($replacement) extends LocalDumpInspector
        {
            public function __construct(private readonly string $replacement) {}

            protected function afterFirstSourceChunkHashed(string $sourcePath): void
            {
                $replacementPath = $sourcePath.'.replacement';
                file_put_contents($replacementPath, $this->replacement);
                rename($replacementPath, $sourcePath);
            }
        };
        $this->app->instance(LocalDumpInspector::class, $inspector);

        $exitCode = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--execute' => true,
            '--json' => true,
        ]);
        $payload = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $exitCode);
        $this->assertSame('completed', $payload['status']);
        $this->assertSame(hash('sha256', $original), $payload['sha256']);
        $this->assertSame($replacement, file_get_contents($path));
        $this->assertSame($original, file_get_contents($captured));
        $this->assertSame([], glob($this->dumpDirectory.'/staging/*') ?: []);
    }

    public function test_runner_rechecks_the_artifact_before_opening_the_database_client(): void
    {
        $path = $this->dumpDirectory.'/approved.sql';
        file_put_contents($path, "CREATE TABLE `urt_tag` (`tag_id` int);\n");
        $inspection = (new LocalDumpInspector)->inspect('approved.sql', 1024, 1024);
        file_put_contents($inspection['path'], "CREATE TABLE `urt_tag` (`tag_id` bigint);\n");

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('dump_artifact_changed');

        (new LocalDumpImportRunner)->run($inspection, 1);
    }

    public function test_runner_imports_only_staged_bytes_when_the_source_changes_after_staging(): void
    {
        $path = $this->dumpDirectory.'/approved.sql';
        $captured = $this->dumpDirectory.'/captured.sql';
        $client = $this->dumpDirectory.'/fake-mariadb';
        $original = "CREATE TABLE `urt_tag` (`tag_id` int);\n";
        $replacement = "DROP DATABASE `youtube_board`;\n";
        file_put_contents($path, $original);
        $inspector = new LocalDumpInspector;
        $inspection = $inspector->inspect('approved.sql', 1024, 1024);
        $this->assertNotSame($path, $inspection['path']);
        $this->assertSame(0600, fileperms($inspection['path']) & 0777);
        file_put_contents(
            $client,
            "#!/bin/sh\nprintf '%s' ".escapeshellarg($replacement).' > '.escapeshellarg($path)
                ."\n/bin/cat > ".escapeshellarg($captured)."\n",
        );
        chmod($client, 0700);
        config()->set('local_import.client', $client);

        try {
            (new LocalDumpImportRunner)->run($inspection, 5);

            $this->assertSame($replacement, file_get_contents($path));
            $this->assertSame($original, file_get_contents($captured));
        } finally {
            $inspector->cleanup($inspection);
        }

        $this->assertSame([], glob($this->dumpDirectory.'/staging/*') ?: []);
    }

    public function test_repeating_a_successful_checksum_is_an_idempotent_noop(): void
    {
        $contents = "CREATE TABLE `urt_tag` (`tag_id` int);\n";
        file_put_contents($this->dumpDirectory.'/approved.sql', $contents);

        $runner = Mockery::mock(LocalDumpImportRunner::class);
        $runner->shouldReceive('assertLocalTarget')->twice();
        $runner->shouldReceive('run')->once();
        $this->app->instance(LocalDumpImportRunner::class, $runner);

        $firstExit = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--execute' => true,
            '--json' => true,
        ]);
        $first = json_decode(trim(Artisan::output()), true);
        $secondExit = Artisan::call('db:import-local', [
            'file' => 'approved.sql',
            '--execute' => true,
            '--json' => true,
        ]);
        $second = json_decode(trim(Artisan::output()), true);

        $this->assertSame(0, $firstExit);
        $this->assertSame('completed', $first['status']);
        $this->assertSame(0, $secondExit);
        $this->assertSame('already_completed', $second['status']);
        $this->assertTrue($second['idempotent']);
        $this->assertSame($first['audit_id'], $second['prior_audit_id']);
        $this->assertNotSame($first['audit_id'], $second['audit_id']);
        $this->assertNoStagedArtifacts();
    }

    private function assertNoStagedArtifacts(): void
    {
        $this->assertSame([], glob($this->dumpDirectory.'/staging/*') ?: []);
    }
}
