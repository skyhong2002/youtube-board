<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class OpsBasicAuthTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.ops.basic_auth_user', null);
        config()->set('services.ops.basic_auth_password_hash', null);
    }

    public function test_configured_credentials_allow_ops_route(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));

        $this->withBasicAuth('operator', 'secret')->get('/ops/ingestion')
            ->assertOk();
    }

    public function test_configured_wrong_credentials_are_rejected(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));

        $this->withBasicAuth('operator', 'wrong')->get('/ops/ingestion')
            ->assertUnauthorized()
            ->assertHeader('WWW-Authenticate', 'Basic realm="Operations"');
    }

    public function test_unverifiable_password_hash_is_rejected_without_error(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', 'secret');

        $this->withBasicAuth('operator', 'secret')->get('/ops/ingestion')
            ->assertUnauthorized();
    }

    public function test_unconfigured_production_is_forbidden(): void
    {
        $this->app->detectEnvironment(fn (): string => 'production');

        $this->get('/ops/ingestion')
            ->assertForbidden()
            ->assertSee('Operations authentication is required.');
    }

    public function test_unconfigured_testing_is_allowed(): void
    {
        $this->get('/ops/ingestion')->assertOk();
    }

    public function test_dokploy_webhook_is_unaffected_by_basic_auth(): void
    {
        $this->post('/ops/deploy/dokploy', ['ref' => 'refs/heads/main'])
            ->assertNotFound();
    }

    public function test_dev_route_is_protected_when_configured(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));

        $this->get('/dev/yt-check')->assertUnauthorized();
    }
}
