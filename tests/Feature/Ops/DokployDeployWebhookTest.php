<?php

namespace Tests\Feature\Ops;

use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class DokployDeployWebhookTest extends TestCase
{
    public function test_dokploy_deploy_relay_is_not_exposed_without_runtime_config(): void
    {
        Http::fake();

        $this->post('/ops/deploy/dokploy', ['ref' => 'refs/heads/main'])
            ->assertNotFound();

        Http::assertNothingSent();
    }

    public function test_dokploy_deploy_relay_rejects_invalid_signature(): void
    {
        config()->set('services.dokploy.deploy_webhook_url', 'http://dokploy.example/api/deploy/token');
        config()->set('services.dokploy.deploy_relay_secret', 'relay-secret');
        Http::fake();

        $this->postJson('/ops/deploy/dokploy', ['ref' => 'refs/heads/main'], [
            'X-GitHub-Event' => 'push',
            'X-Hub-Signature-256' => 'sha256=bad',
        ])->assertForbidden();

        Http::assertNothingSent();
    }

    public function test_dokploy_deploy_relay_ignores_non_main_pushes(): void
    {
        config()->set('services.dokploy.deploy_webhook_url', 'http://dokploy.example/api/deploy/token');
        config()->set('services.dokploy.deploy_relay_secret', 'relay-secret');
        Http::fake();

        $payload = json_encode(['ref' => 'refs/heads/feature'], JSON_THROW_ON_ERROR);

        $this->call('POST', '/ops/deploy/dokploy', [], [], [], [
            'HTTP_X_GITHUB_EVENT' => 'push',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $payload, 'relay-secret'),
            'CONTENT_TYPE' => 'application/json',
        ], $payload)->assertAccepted();

        Http::assertNothingSent();
    }

    public function test_dokploy_deploy_relay_ignores_signed_non_push_events(): void
    {
        config()->set('services.dokploy.deploy_webhook_url', 'http://dokploy.example/api/deploy/token');
        config()->set('services.dokploy.deploy_relay_secret', 'relay-secret');
        Http::fake();

        $payload = json_encode(['zen' => 'Keep it logically awesome.'], JSON_THROW_ON_ERROR);

        $this->call('POST', '/ops/deploy/dokploy', [], [], [], [
            'HTTP_X_GITHUB_EVENT' => 'ping',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $payload, 'relay-secret'),
            'CONTENT_TYPE' => 'application/json',
        ], $payload)->assertAccepted();

        Http::assertNothingSent();
    }

    public function test_dokploy_deploy_relay_triggers_internal_webhook_for_signed_main_push(): void
    {
        config()->set('services.dokploy.deploy_webhook_url', 'http://dokploy.example/api/deploy/token');
        config()->set('services.dokploy.deploy_relay_secret', 'relay-secret');
        Http::fake([
            'dokploy.example/*' => Http::response(['message' => 'Application deployed successfully'], 200),
        ]);

        $payload = json_encode(['ref' => 'refs/heads/main'], JSON_THROW_ON_ERROR);

        $this->call('POST', '/ops/deploy/dokploy', [], [], [], [
            'HTTP_X_GITHUB_EVENT' => 'push',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $payload, 'relay-secret'),
            'CONTENT_TYPE' => 'application/json',
        ], $payload)
            ->assertOk()
            ->assertJson([
                'message' => 'deploy triggered',
                'status' => 200,
            ]);

        Http::assertSent(fn ($request): bool => $request->url() === 'http://dokploy.example/api/deploy/token'
            && $request['ref'] === 'refs/heads/main');
    }
}
