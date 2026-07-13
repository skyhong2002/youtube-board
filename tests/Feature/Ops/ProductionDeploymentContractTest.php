<?php

namespace Tests\Feature\Ops;

use PHPUnit\Framework\TestCase;

class ProductionDeploymentContractTest extends TestCase
{
    private string $projectRoot;

    protected function setUp(): void
    {
        parent::setUp();

        $this->projectRoot = dirname(__DIR__, 3);
    }

    public function test_production_image_runs_verified_migrations_before_binding_the_web_port(): void
    {
        $dockerfile = file_get_contents($this->projectRoot.'/Dockerfile');
        $entrypoint = file_get_contents($this->projectRoot.'/docker/production-start.sh');

        $this->assertIsString($dockerfile);
        $this->assertIsString($entrypoint);
        $this->assertStringContainsString('CMD ["sh", "docker/production-start.sh"]', $dockerfile);
        $this->assertStringContainsString('chmod -R a+rX /var/www/html', $dockerfile);

        $wait = strpos($entrypoint, 'php artisan db:show --no-interaction');
        $clearConfig = strpos($entrypoint, 'rm -f bootstrap/cache/config.php');
        $migrate = strpos($entrypoint, 'php artisan migrate --force --no-interaction');
        $status = strpos($entrypoint, 'php artisan migrate:status --no-interaction');
        $schema = strpos($entrypoint, 'php artisan deployment:schema-check --no-interaction');
        $serve = strpos($entrypoint, 'exec php artisan serve');

        $this->assertIsInt($wait);
        $this->assertIsInt($clearConfig);
        $this->assertIsInt($migrate);
        $this->assertIsInt($status);
        $this->assertIsInt($schema);
        $this->assertIsInt($serve);
        $this->assertLessThan($wait, $clearConfig);
        $this->assertLessThan($migrate, $wait);
        $this->assertLessThan($status, $migrate);
        $this->assertLessThan($schema, $status);
        $this->assertLessThan($serve, $schema);
        $this->assertStringContainsString('set -eu', $entrypoint);
    }

    public function test_production_build_context_excludes_local_generated_runtime_state(): void
    {
        $dockerIgnore = file_get_contents($this->projectRoot.'/.dockerignore');

        $this->assertIsString($dockerIgnore);
        $this->assertStringContainsString('bootstrap/cache/*.php', $dockerIgnore);
        $this->assertStringContainsString('database/*.sqlite*', $dockerIgnore);
        $this->assertStringContainsString('public/hot', $dockerIgnore);
        $this->assertStringContainsString('storage/app/private/dump-import-staging/*', $dockerIgnore);
        $this->assertStringContainsString('storage/app/private/dump-imports/*', $dockerIgnore);
    }

    public function test_quota_ledger_migration_is_adoption_safe_and_explicitly_innodb(): void
    {
        $migration = file_get_contents(
            $this->projectRoot.'/database/migrations/2026_07_13_000000_create_ingestion_youtube_quota_daily_table.php',
        );

        $this->assertIsString($migration);
        $this->assertStringContainsString("Schema::hasTable('ingestion_youtube_quota_daily')", $migration);
        $this->assertStringContainsString("\$table->engine = 'InnoDB';", $migration);
    }

    public function test_ingestion_run_history_migration_is_adoption_safe_and_explicitly_innodb(): void
    {
        $migration = file_get_contents(
            $this->projectRoot.'/database/migrations/2026_07_13_010000_create_ingestion_run_history_tables.php',
        );

        $this->assertIsString($migration);
        $this->assertStringContainsString("Schema::hasTable('ingestion_runs')", $migration);
        $this->assertStringContainsString("Schema::hasTable('ingestion_run_jobs')", $migration);
        $this->assertSame(2, substr_count($migration, "\$table->engine = 'InnoDB';"));
        $this->assertStringContainsString(
            "\$table->primary(['run_id', 'job_key'], 'ingestion_run_jobs_primary');",
            $migration,
        );
        $this->assertStringNotContainsString('Schema::drop', $migration);
        $this->assertStringContainsString(
            'Durable operational history must survive application rollbacks.',
            $migration,
        );
    }

    public function test_deployment_schema_verifier_statically_handles_mariadb_engines(): void
    {
        $verifier = file_get_contents($this->projectRoot.'/app/Services/DeploymentSchemaVerifier.php');

        $this->assertIsString($verifier);
        $this->assertStringContainsString(
            "private const ENGINE_BEARING_DRIVERS = ['mysql', 'mariadb'];",
            $verifier,
        );
        $this->assertStringContainsString(
            'in_array($driver, self::ENGINE_BEARING_DRIVERS, true)',
            $verifier,
        );
    }

    public function test_ingestion_defaults_fail_closed_without_runtime_environment_values(): void
    {
        $config = file_get_contents($this->projectRoot.'/config/ingestion.php');

        $this->assertIsString($config);
        $this->assertStringContainsString("env('INGESTION_SCHEDULER_ENABLED', false)", $config);
        $this->assertStringContainsString("env('INGESTION_LOCAL_POLLING_ENABLED', false)", $config);
        $this->assertStringContainsString("env('INGESTION_PRODUCTION_POLLING_ENABLED', false)", $config);
        $this->assertStringContainsString("env('INGESTION_SCHEDULED_WRITE_ALLOWLIST', 'off')", $config);
    }

    public function test_production_template_keeps_secure_sessions_and_documented_fallback_timeout(): void
    {
        $template = file_get_contents($this->projectRoot.'/deploy/dokploy-env.example');
        $deployment = file_get_contents($this->projectRoot.'/docs/deployment.md');

        $this->assertIsString($template);
        $this->assertIsString($deployment);
        $this->assertStringContainsString('SESSION_SECURE_COOKIE=true', $template);
        $this->assertStringContainsString('SESSION_SECURE_COOKIE=true', $deployment);
        $this->assertStringContainsString('OPENAI_FALLBACK_TIMEOUT=300', $template);
        $this->assertStringContainsString('OPENAI_FALLBACK_TIMEOUT=300', $deployment);
    }
}
