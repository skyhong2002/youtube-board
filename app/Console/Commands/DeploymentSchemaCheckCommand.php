<?php

namespace App\Console\Commands;

use App\Services\DeploymentSchemaVerifier;
use Illuminate\Console\Command;

class DeploymentSchemaCheckCommand extends Command
{
    protected $signature = 'deployment:schema-check {--json : Emit machine-readable output}';

    protected $description = 'Verify required dashboard schema before serving Production traffic';

    public function handle(DeploymentSchemaVerifier $verifier): int
    {
        $payload = $verifier->inspect();

        if ((bool) $this->option('json')) {
            $this->line((string) json_encode($payload, JSON_UNESCAPED_SLASHES));
        } else {
            foreach ($payload as $key => $value) {
                $rendered = is_array($value)
                    ? json_encode($value, JSON_UNESCAPED_SLASHES)
                    : match (true) {
                        is_bool($value) => $value ? 'true' : 'false',
                        $value === null => 'null',
                        default => (string) $value,
                    };
                $this->line("{$key}={$rendered}");
            }
        }

        return (bool) ($payload['ready'] ?? false) ? self::SUCCESS : self::FAILURE;
    }
}
