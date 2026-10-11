<?php

namespace App\Console\Commands\Ingestion;

use App\Services\Ingestion\IngestionHealthCheck;
use Illuminate\Console\Command;

class IngestionHealthCommand extends Command
{
    protected $signature = 'ingestion:health {--date= : Daily report target date, defaults to yesterday in Asia/Taipei} {--json : Emit JSON instead of text}';

    protected $description = 'Health-check ingestion runtimes, YouTube API latency, AI latency, quota, and daily report completeness';

    public function handle(IngestionHealthCheck $health): int
    {
        $payload = $health->check($this->option('date') ? (string) $this->option('date') : null);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $payload['status'] === 'fail' ? 1 : 0;
        }

        $this->line(sprintf(
            'ingestion:health status=%s target_date=%s scheduler=%s yt_requests=%d yt_failed=%d yt_max_ms=%d ai_requests=%d ai_failed=%d ai_max_ms=%d',
            $payload['status'],
            $payload['target_date'],
            ($payload['scheduler']['active'] ?? false) ? 'active' : 'not-observed',
            (int) ($payload['youtube']['requests'] ?? 0),
            (int) ($payload['youtube']['failed_requests'] ?? 0),
            (int) ($payload['youtube']['max_latency_ms'] ?? 0),
            (int) ($payload['ai']['requests'] ?? 0),
            (int) ($payload['ai']['failed_requests'] ?? 0),
            (int) ($payload['ai']['max_latency_ms'] ?? 0),
        ));

        $aiDaily = $payload['targets']['ai_daily'] ?? [];
        $this->line(sprintf(
            'target ai_daily status=%s conditions=%d/%d channel_rows=%s/%d missing="%s" latest_mtime=%s',
            (string) ($aiDaily['status'] ?? 'unknown'),
            count($aiDaily['completed_conditions'] ?? []),
            count($aiDaily['expected_conditions'] ?? []),
            ($aiDaily['channel_rows'] ?? null) === null ? '-' : (string) $aiDaily['channel_rows'],
            (int) ($aiDaily['expected_channel_rows'] ?? 0),
            implode(',', $aiDaily['missing_conditions'] ?? []),
            (string) ($aiDaily['latest_mtime'] ?? '-'),
        ));

        $mayor = $payload['targets']['mayor_person'] ?? [];
        $this->line(sprintf(
            'target mayor_person status=%s city=%s people=%d/%d missing="%s" latest_mtime=%s',
            (string) ($mayor['status'] ?? 'unknown'),
            (string) ($mayor['city'] ?? '-'),
            count($mayor['completed_people'] ?? []),
            count($mayor['expected_people'] ?? []),
            implode(',', $mayor['missing_people'] ?? []),
            (string) ($mayor['latest_mtime'] ?? '-'),
        ));

        foreach (array_slice($payload['processing']['jobs'] ?? [], 0, 12) as $job) {
            $this->line(sprintf(
                'job key=%s status=%s action=%s runtime_ms=%s record=%s',
                (string) ($job['key'] ?? '-'),
                (string) ($job['status'] ?? 'unknown'),
                (string) ($job['last_action'] ?? '-'),
                ($job['last_runtime_ms'] ?? null) === null ? '-' : (string) $job['last_runtime_ms'],
                (string) ($job['last_record_id'] ?? '-'),
            ));
        }

        foreach ($payload['recommendations'] ?? [] as $recommendation) {
            $this->line('recommendation='.$recommendation);
        }

        return $payload['status'] === 'fail' ? 1 : 0;

    }
}
