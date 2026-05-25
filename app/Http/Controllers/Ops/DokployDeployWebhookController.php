<?php

namespace App\Http\Controllers\Ops;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class DokployDeployWebhookController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $secret = (string) config('services.dokploy.deploy_relay_secret', '');
        $deployUrl = (string) config('services.dokploy.deploy_webhook_url', '');

        if ($secret === '' || $deployUrl === '') {
            abort(404);
        }

        $payload = $request->getContent();
        $expectedSignature = 'sha256='.hash_hmac('sha256', $payload, $secret);
        $actualSignature = (string) $request->header('X-Hub-Signature-256', '');

        if (! hash_equals($expectedSignature, $actualSignature)) {
            abort(403);
        }

        if ($request->header('X-GitHub-Event') !== 'push') {
            return response()->json(['message' => 'ignored'], 202);
        }

        if ($request->input('ref') !== 'refs/heads/main') {
            return response()->json(['message' => 'branch ignored'], 202);
        }

        $response = Http::timeout(15)
            ->asJson()
            ->withHeader('X-GitHub-Event', 'push')
            ->post($deployUrl, [
                'ref' => 'refs/heads/main',
            ]);

        return response()->json([
            'message' => $response->successful() ? 'deploy triggered' : 'deploy trigger failed',
            'status' => $response->status(),
        ], $response->successful() ? 200 : 502);
    }
}
