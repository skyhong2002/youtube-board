<?php

namespace App\Console\Commands\Ingestion;

use App\Services\Ingestion\IngestionJobRegistry;
use Illuminate\Console\Command;

class IngestionListCommand extends Command
{
    protected $signature = 'ingestion:list';

    protected $description = 'List the planned legacy-to-Laravel ingestion command registry';

    public function handle(IngestionJobRegistry $registry): int
    {
        $summary = $registry->summary();

        $this->line(sprintf(
            'scheduler=%s total=%d planned=%d active=%d blocked=%d command_ready=%d command_missing=%d',
            $summary['scheduler_enabled'] ? 'enabled' : 'disabled',
            $summary['total'],
            $summary['planned'],
            $summary['active'],
            $summary['blocked'],
            $summary['command_ready'],
            $summary['command_missing'],
        ));

        foreach ($registry->jobs() as $job) {
            $this->line(sprintf(
                '[P%d] %s command:%s %s -> %s (%s)',
                $job['priority'],
                $job['status'],
                $job['command_exists'] ? 'ready' : 'missing',
                $job['legacy_command'],
                $job['modern_command'],
                $job['schedule'],
            ));
        }

        return 0;
    }
}
