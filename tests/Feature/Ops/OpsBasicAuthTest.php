<?php

namespace Tests\Feature\Ops;

use App\Http\Middleware\OpsBasicAuth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
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

    public function test_failed_auth_is_limited_before_password_hash_work_and_expires(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $this->withBasicAuth('operator', 'wrong')->get('/ops/ingestion')->assertUnauthorized();
        }
        Hash::shouldReceive('check')->never();
        $this->withBasicAuth('operator', 'secret')->get('/ops/ingestion')
            ->assertStatus(429)->assertHeader('Retry-After')->assertHeader('Cache-Control', 'no-store, private');
        $this->travel(61)->seconds();
        // A new wrong username can be rejected without hash work once the bucket expires.
        $this->withBasicAuth('different', 'wrong')->get('/ops/ingestion')->assertUnauthorized();
    }

    public function test_rotating_usernames_and_forwarded_headers_does_not_bypass_peer_budget(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $this->withBasicAuth('other-'.$attempt, 'wrong')
                ->withHeader('X-Forwarded-For', '192.0.2.'.($attempt + 1))
                ->get('/ops/ingestion')->assertUnauthorized();
        }
        $this->withBasicAuth('another-user', 'wrong')->get('/dev/yt-check')->assertStatus(429);
    }

    public function test_auth_lock_contention_fails_closed_before_hashing(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));
        $lock = Cache::lock('ops-auth:budget-lock', 30);
        $this->assertTrue($lock->get());
        Hash::shouldReceive('check')->never();
        try {
            $this->withBasicAuth('operator', 'secret')->get('/ops/ingestion')
                ->assertStatus(429)->assertHeader('Retry-After', '1');
            $this->assertSame(0, RateLimiter::attempts('ops-auth:global'));
        } finally {
            $lock->release();
        }
    }

    public function test_success_releases_auth_lock_before_running_the_route(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));
        $request = Request::create('/ops/ingestion', server: [
            'PHP_AUTH_USER' => 'operator', 'PHP_AUTH_PW' => 'secret',
        ]);
        $response = (new OpsBasicAuth)->handle($request, function () {
            $lock = Cache::lock('ops-auth:budget-lock', 30);
            $this->assertTrue($lock->get());
            $lock->release();

            return response('authorized');
        });
        $this->assertSame(200, $response->getStatusCode());
    }

    public function test_global_budget_applies_across_peers_without_counting_successful_auth(): void
    {
        config()->set('services.ops.basic_auth_user', 'operator');
        config()->set('services.ops.basic_auth_password_hash', Hash::make('secret'));
        $this->withBasicAuth('operator', 'secret')->get('/ops/ingestion')->assertOk();
        $this->assertSame(0, RateLimiter::attempts('ops-auth:global'));
        for ($attempt = 0; $attempt < 120; $attempt++) {
            $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.'.($attempt + 1)])
                ->withBasicAuth('unknown', 'wrong')->get('/ops/ingestion')->assertUnauthorized();
        }
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])
            ->withBasicAuth('operator', 'secret')->get('/ops/ingestion')->assertStatus(429);
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
