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

    public function test_ingestion_defaults_fail_closed_without_runtime_environment_values(): void
    {
        $config = file_get_contents($this->projectRoot.'/config/ingestion.php');

        $this->assertIsString($config);
        $this->assertStringContainsString("env('INGESTION_SCHEDULER_ENABLED', false)", $config);
        $this->assertStringContainsString("env('INGESTION_LOCAL_POLLING_ENABLED', false)", $config);
        $this->assertStringContainsString("env('INGESTION_PRODUCTION_POLLING_ENABLED', false)", $config);
        $this->assertStringContainsString("env('INGESTION_SCHEDULED_WRITE_ALLOWLIST', 'off')", $config);
    }
}
