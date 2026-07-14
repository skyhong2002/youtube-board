<?php

namespace App\Services\Ingestion;

class AiProviderUsageSummary
{
    /**
     * @return array<string, mixed>
     */
    public function emptySummary(): array
    {
        return [
            'providers' => [
                'primary' => $this->emptyProvider('Primary provider'),
                'fallback' => $this->emptyProvider('Fallback provider'),
                'unknown' => $this->emptyProvider('Unknown provider'),
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function summarizePayload(array $payload): array
    {
        $summary = $this->emptySummary();

        if (is_array($payload['jobs'] ?? null)) {
            foreach ($payload['jobs'] as $job) {
                if (! is_array($job)) {
                    continue;
                }

                if (is_array($job['result'] ?? null)) {
                    $summary = $this->merge($summary, $this->summarizePayload($job['result']));
                }

                $telemetryRequests = data_get($job, 'telemetry.ai_requests');
                $hasTelemetry = is_array($telemetryRequests) && count($telemetryRequests) > 0;

                if ($hasTelemetry && is_array($job['telemetry'] ?? null)) {
                    $summary = $this->merge($summary, $this->summarizePayload($job['telemetry']));
                }

                if (! $hasTelemetry && is_string($job['output'] ?? null)) {
                    $summary = $this->merge($summary, $this->summarizeOutput($job['output']));
                }
            }
        }

        foreach ($this->payloadRows($payload) as $row) {
            $this->addRow($summary, $row);
        }

        return $summary;
    }

    /**
     * @return array<string, mixed>
     */
    public function summarizeOutput(string $output): array
    {
        $summary = $this->emptySummary();
        $output = trim($output);

        if ($output === '') {
            return $summary;
        }

        $decoded = json_decode($output, true);

        if (is_array($decoded)) {
            return $this->summarizePayload($decoded);
        }

        if (preg_match('/\bprovider_usage="([^"]+)"/', $output, $matches)) {
            return $this->summaryFromCompactLine($matches[1]);
        }

        if (preg_match('/\bprovider=(primary|fallback|openai|unknown)\b/', $output, $matches)) {
            $usage = $this->usageFromOutput($output);
            $this->addSuccessfulCalls($summary, $matches[1], 1, $usage);

            if (preg_match('/\bprovider_failures="([^"]+)"/', $output, $failureMatches)) {
                $this->addFailuresFromList($summary, $failureMatches[1]);
            }

            return $summary;
        }

        if (preg_match('/\bai_calls_used=(\d+)\b/', $output, $matches)) {
            $calls = max(0, (int) $matches[1]);

            if ($calls > 0) {
                $this->addSuccessfulCalls($summary, 'unknown', $calls);
            }
        }

        return $summary;
    }

    /**
     * @param  array<string, mixed>  $left
     * @param  array<string, mixed>  $right
     * @return array<string, mixed>
     */
    public function merge(array $left, array $right): array
    {
        $summary = $left + $this->emptySummary();

        foreach (['primary', 'fallback', 'unknown'] as $provider) {
            foreach (['successful_calls', 'failed_attempts', 'prompt_tokens', 'completion_tokens', 'total_tokens'] as $field) {
                $summary['providers'][$provider][$field] =
                    (int) ($summary['providers'][$provider][$field] ?? 0)
                    + (int) data_get($right, "providers.$provider.$field", 0);
            }
        }

        return $summary;
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    public function hasActivity(array $summary): bool
    {
        foreach (['primary', 'fallback', 'unknown'] as $provider) {
            if ((int) data_get($summary, "providers.$provider.successful_calls", 0) > 0) {
                return true;
            }

            if ((int) data_get($summary, "providers.$provider.failed_attempts", 0) > 0) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    public function compactLine(array $summary): string
    {
        return sprintf(
            'primary_success=%d fallback_success=%d unknown_success=%d primary_failed=%d fallback_failed=%d unknown_failed=%d primary_prompt_tokens=%d primary_completion_tokens=%d primary_total_tokens=%d fallback_prompt_tokens=%d fallback_completion_tokens=%d fallback_total_tokens=%d unknown_prompt_tokens=%d unknown_completion_tokens=%d unknown_total_tokens=%d prompt_tokens=%d completion_tokens=%d total_tokens=%d',
            (int) data_get($summary, 'providers.primary.successful_calls', 0),
            (int) data_get($summary, 'providers.fallback.successful_calls', 0),
            (int) data_get($summary, 'providers.unknown.successful_calls', 0),
            (int) data_get($summary, 'providers.primary.failed_attempts', 0),
            (int) data_get($summary, 'providers.fallback.failed_attempts', 0),
            (int) data_get($summary, 'providers.unknown.failed_attempts', 0),
            (int) data_get($summary, 'providers.primary.prompt_tokens', 0),
            (int) data_get($summary, 'providers.primary.completion_tokens', 0),
            (int) data_get($summary, 'providers.primary.total_tokens', 0),
            (int) data_get($summary, 'providers.fallback.prompt_tokens', 0),
            (int) data_get($summary, 'providers.fallback.completion_tokens', 0),
            (int) data_get($summary, 'providers.fallback.total_tokens', 0),
            (int) data_get($summary, 'providers.unknown.prompt_tokens', 0),
            (int) data_get($summary, 'providers.unknown.completion_tokens', 0),
            (int) data_get($summary, 'providers.unknown.total_tokens', 0),
            $this->total($summary, 'prompt_tokens'),
            $this->total($summary, 'completion_tokens'),
            $this->total($summary, 'total_tokens'),
        );
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    public function total(array $summary, string $field): int
    {
        return (int) data_get($summary, 'providers.primary.'.$field, 0)
            + (int) data_get($summary, 'providers.fallback.'.$field, 0)
            + (int) data_get($summary, 'providers.unknown.'.$field, 0);
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyProvider(string $label): array
    {
        return [
            'label' => $label,
            'successful_calls' => 0,
            'failed_attempts' => 0,
            'prompt_tokens' => 0,
            'completion_tokens' => 0,
            'total_tokens' => 0,
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return list<array<string, mixed>>
     */
    private function payloadRows(array $payload): array
    {
        $rows = [];

        foreach (['channel_ai', 'daily_ai', 'period_ai', 'event_ai'] as $group) {
            if (! is_array(data_get($payload, $group.'.rows'))) {
                continue;
            }

            foreach (data_get($payload, $group.'.rows') as $row) {
                if (is_array($row)) {
                    $rows[] = $row;
                }
            }
        }

        if (is_array($payload['rows'] ?? null)) {
            foreach ($payload['rows'] as $row) {
                if (is_array($row)) {
                    $rows[] = $row;
                }
            }
        }

        if (is_array($payload['ai_requests'] ?? null)) {
            foreach ($payload['ai_requests'] as $row) {
                if (is_array($row)) {
                    $rows[] = $row + ['ai_call_attempted' => true];
                }
            }
        }

        if ($rows === [] && (
            is_string($payload['provider'] ?? null)
            || is_array($payload['usage'] ?? null)
            || ($payload['ai_call_attempted'] ?? false) === true
        )) {
            $rows[] = $payload;
        }

        return $rows;
    }

    /**
     * @param  array<string, mixed>  $summary
     * @param  array<string, mixed>  $row
     */
    private function addRow(array &$summary, array $row): void
    {
        $provider = is_string($row['provider'] ?? null) ? $row['provider'] : null;
        $usage = is_array($row['usage'] ?? null) ? $row['usage'] : null;
        $skipped = ($row['skipped'] ?? false) === true;
        $attempted = ($row['ai_call_attempted'] ?? false) === true || $provider !== null || $usage !== null;
        $ok = $row['ok'] ?? null;

        if ($ok === false && $provider !== null) {
            $this->addFailedAttempt($summary, $provider);
        } elseif ($ok === false) {
            $this->addFailedAttempt($summary, 'unknown');
        } elseif ($provider !== null && ! $skipped) {
            $this->addSuccessfulCalls($summary, $provider, 1, $usage);
        } elseif ($attempted && ! $skipped) {
            $this->addSuccessfulCalls($summary, 'unknown', 1, $usage);
        } elseif ($attempted) {
            $this->addFailedAttempt($summary, 'unknown');
        }

        if (is_array($row['provider_failures'] ?? null)) {
            foreach ($row['provider_failures'] as $failure) {
                if (is_string($failure)) {
                    $this->addFailureFromText($summary, $failure);
                }
            }
        }
    }

    /**
     * @param  array<string, mixed>  $summary
     * @param  array<string, mixed>|null  $usage
     */
    private function addSuccessfulCalls(array &$summary, string $provider, int $calls = 1, ?array $usage = null): void
    {
        $provider = $this->providerKey($provider);
        $summary['providers'][$provider]['successful_calls'] += max(0, $calls);

        if ($usage === null) {
            return;
        }

        $tokens = $this->usageTokens($usage);
        $summary['providers'][$provider]['prompt_tokens'] += $tokens['prompt'];
        $summary['providers'][$provider]['completion_tokens'] += $tokens['completion'];
        $summary['providers'][$provider]['total_tokens'] += $tokens['total'];
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    private function addFailedAttempt(array &$summary, string $provider, int $count = 1): void
    {
        $summary['providers'][$this->providerKey($provider)]['failed_attempts'] += max(0, $count);
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    private function addFailuresFromList(array &$summary, string $failures): void
    {
        if ($failures === 'none') {
            return;
        }

        foreach (explode('|', $failures) as $failure) {
            $this->addFailureFromText($summary, trim($failure));
        }
    }

    /**
     * @param  array<string, mixed>  $summary
     */
    private function addFailureFromText(array &$summary, string $failure): void
    {
        if (preg_match('/^(primary|fallback|openai|unknown)\s*:/', $failure, $matches)) {
            $this->addFailedAttempt($summary, $matches[1]);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function summaryFromCompactLine(string $line): array
    {
        $summary = $this->emptySummary();
        $values = [];

        if (preg_match_all('/([a-z_]+)=(\d+)/', $line, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $values[$match[1]] = (int) $match[2];
            }
        }

        $this->addSuccessfulCalls($summary, 'primary', $values['primary_success'] ?? 0);
        $this->addSuccessfulCalls($summary, 'fallback', $values['fallback_success'] ?? $values['openai_success'] ?? 0);
        $this->addSuccessfulCalls($summary, 'unknown', $values['unknown_success'] ?? 0);
        $this->addFailedAttempt($summary, 'primary', $values['primary_failed'] ?? 0);
        $this->addFailedAttempt($summary, 'fallback', $values['fallback_failed'] ?? $values['openai_failed'] ?? 0);
        $this->addFailedAttempt($summary, 'unknown', $values['unknown_failed'] ?? 0);

        $this->addProviderTokens($summary, 'primary', $values, 'primary');
        $this->addProviderTokens($summary, 'fallback', $values, 'fallback', 'openai');
        $this->addProviderTokens($summary, 'unknown', $values, 'unknown');

        if (($values['primary_prompt_tokens'] ?? $values['fallback_prompt_tokens'] ?? $values['openai_prompt_tokens'] ?? $values['unknown_prompt_tokens'] ?? null) === null) {
            $summary['providers']['unknown']['prompt_tokens'] += $values['prompt_tokens'] ?? 0;
            $summary['providers']['unknown']['completion_tokens'] += $values['completion_tokens'] ?? 0;
            $summary['providers']['unknown']['total_tokens'] += $values['total_tokens'] ?? 0;
        }

        return $summary;
    }

    /**
     * @param  array<string, mixed>  $summary
     * @param  array<string, int>  $values
     */
    private function addProviderTokens(array &$summary, string $provider, array $values, string $prefix, ?string $legacyPrefix = null): void
    {
        foreach (['prompt_tokens', 'completion_tokens', 'total_tokens'] as $field) {
            $summary['providers'][$provider][$field] += $values[$prefix.'_'.$field]
                ?? ($legacyPrefix === null ? 0 : ($values[$legacyPrefix.'_'.$field] ?? 0));
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function usageFromOutput(string $output): ?array
    {
        if (! preg_match('/\busage=({.+})\s*$/', $output, $matches)) {
            return null;
        }

        $usage = json_decode($matches[1], true);

        return is_array($usage) ? $usage : null;
    }

    /**
     * @param  array<string, mixed>  $usage
     * @return array{prompt: int, completion: int, total: int}
     */
    private function usageTokens(array $usage): array
    {
        $prompt = $this->intValue($usage['prompt_tokens'] ?? null) + $this->intValue($usage['input_tokens'] ?? null);
        $completion = $this->intValue($usage['completion_tokens'] ?? null) + $this->intValue($usage['output_tokens'] ?? null);
        $total = $this->intValue($usage['total_tokens'] ?? null);

        if ($total <= 0) {
            $total = $prompt + $completion;
        }

        return [
            'prompt' => $prompt,
            'completion' => $completion,
            'total' => $total,
        ];
    }

    private function intValue(mixed $value): int
    {
        if (is_numeric($value)) {
            return max(0, (int) $value);
        }

        return 0;
    }

    private function providerKey(string $provider): string
    {
        $provider = strtolower(trim($provider));

        return match ($provider) {
            'primary' => 'primary',
            'fallback', 'openai', 'secondary' => 'fallback',
            default => 'unknown',
        };
    }
}
