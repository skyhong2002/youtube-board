<?php

namespace App\Console\Commands\Ingestion;

use App\Services\Ingestion\IngestionRunHistory;
use App\Services\Ingestion\IngestionSchedulerRunner;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

class IngestionRunCommand extends Command
{
    protected $signature = 'ingestion:run {--execute : Execute active due jobs instead of dry-running} {--dry-run : Force dry-run even when --execute is also supplied} {--record : Store the run result in local ingestion run history} {--at= : Timestamp to evaluate, for deterministic checks} {--job= : Evaluate one registry job key} {--all : Include jobs that are not currently due}';

    protected $description = 'Evaluate or execute due ingestion jobs from the legacy cron registry';

    public function handle(IngestionSchedulerRunner $runner, IngestionRunHistory $history): int
    {
        $timezone = config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $at = $this->option('at')
            ? CarbonImmutable::parse((string) $this->option('at'), $timezone)
            : CarbonImmutable::now($timezone);

        $result = $runner->run(
            at: $at,
            execute: $execute,
            jobKey: $this->option('job') ? (string) $this->option('job') : null,
            showAll: (bool) $this->option('all'),
        );

        $this->line(sprintf(
            'mode=%s scheduler=%s at=%s evaluated=%d due=%d executed=%d skipped=%d failed=%d yt_quota_estimate=%d runtime_ms=%d',
            $result['mode'],
            $result['scheduler_enabled'] ? 'enabled' : 'disabled',
            $result['at'],
            $result['summary']['evaluated'],
            $result['summary']['due'],
            $result['summary']['executed'],
            $result['summary']['skipped'],
            $result['summary']['failed'],
            (int) ($result['youtube_quota_estimate']['estimated_units'] ?? 0),
            (int) ($result['runtime_ms'] ?? 0),
        ));

        foreach ($result['jobs'] as $job) {
            $this->line(sprintf(
                '[%s] %s %s -> %s (%s) yt_quota=%d',
                $job['due'] ? 'due' : 'not-due',
                $job['key'],
                $job['action'],
                $job['effective_command'] ?? $job['command'],
                $job['schedule'],
                (int) ($job['estimated_youtube_quota_units'] ?? 0),
            ));
        }

        if ((bool) $this->option('record')) {
            $record = $history->record($result, [
                'mode' => $execute ? 'execute' : 'dry-run',
                'job' => $this->option('job') ? (string) $this->option('job') : null,
                'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
                'show_all' => (bool) $this->option('all'),
                'scheduler_enabled_temporarily' => false,
                'original_scheduler_enabled' => (bool) config('ingestion.scheduler_enabled', false),
                'source' => 'artisan',
            ]);

            $this->line(sprintf('recorded=%s path=%s', $record['id'], $record['path']));
        }

        return (int) ($result['summary']['failed'] ?? 0) > 0 ? 1 : 0;

    }
}
