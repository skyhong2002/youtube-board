<?php

namespace App\Console\Commands\Ai;

use App\Services\Ingestion\OpenCodeChatClient;
use App\Support\SensitiveTextRedactor;
use Illuminate\Console\Command;
use Throwable;

class AiProviderProbeCommand extends Command
{
    protected $signature = 'ai:provider:probe {--provider=both : primary/openai, fallback, or both} {--json : Emit JSON instead of text}';

    protected $description = 'Probe configured primary or fallback AI provider with a minimal no-write completion request';

    public function handle(OpenCodeChatClient $client): int
    {
        $providerOption = strtolower(trim((string) $this->option('provider')));
        $providers = match ($providerOption) {
            'primary', 'openai' => ['primary'],
            'fallback' => ['fallback'],
            'both' => ['primary', 'fallback'],
            default => [],
        };

        if ($providers === []) {
            $this->error('ai:provider:probe unavailable: --provider must be primary, fallback, openai, or both');

            return 1;
        }

        $results = [];

        foreach ($providers as $provider) {
            try {
                $probe = $client->probe($provider);
                $results[] = [
                    'provider' => $provider,
                    'ok' => true,
                    'model' => $probe['model'],
                    'configured_model' => $probe['configured_model'],
                    'usage' => $probe['usage'],
                    'latency_ms' => $probe['latency_ms'],
                    'content_chars' => mb_strlen($probe['content'], 'UTF-8'),
                    'error' => null,
                ];
            } catch (Throwable $exception) {
                $results[] = [
                    'provider' => $provider,
                    'ok' => false,
                    'model' => $provider === 'fallback'
                        ? (string) config('services.opencode_go.fallback_model', '')
                        : (string) config('services.opencode_go.model', ''),
                    'configured_model' => $provider === 'fallback'
                        ? (string) config('services.opencode_go.fallback_model', '')
                        : (string) config('services.opencode_go.model', ''),
                    'usage' => null,
                    'latency_ms' => null,
                    'content_chars' => 0,
                    'error' => SensitiveTextRedactor::exception($exception, 240),
                ];
            }
        }

        $failed = collect($results)->where('ok', false)->count();
        $payload = [
            'mode' => 'probe',
            'source' => 'ai_provider_probe',
            'providers' => $results,
            'summary' => [
                'ok' => count($results) - $failed,
                'failed' => $failed,
            ],
            'secrets' => 'not_printed',
        ];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed === 0 ? 0 : 1;
        }

        foreach ($results as $result) {
            $usage = is_array($result['usage']) ? json_encode($result['usage'], JSON_UNESCAPED_SLASHES) : 'null';
            $this->line(sprintf(
                'ai:provider:probe provider=%s status=%s model=%s latency_ms=%s content_chars=%d secrets=not_printed usage=%s error=%s',
                $result['provider'],
                $result['ok'] ? 'ok' : 'failed',
                $result['model'] !== '' ? $result['model'] : '-',
                $result['latency_ms'] === null ? '-' : (string) $result['latency_ms'],
                $result['content_chars'],
                $usage,
                $result['error'] ?? '-',
            ));
        }

        return $failed === 0 ? 0 : 1;

    }
}
