<?php

namespace App\Console;

use App\Services\Ingestion\IngestionCommandLock;
use Illuminate\Foundation\Console\ClosureCommand;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

class GuardedClosureCommand extends ClosureCommand
{
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $execute = $input->hasOption('execute') && (bool) $input->getOption('execute');
        $dryRun = $input->hasOption('dry-run') && (bool) $input->getOption('dry-run');

        if (! $execute || $dryRun) {
            return parent::execute($input, $output);
        }

        $result = $this->laravel->make(IngestionCommandLock::class)->run(
            (string) $this->getName(),
            fn (): int => parent::execute($input, $output),
        );

        if ($result['executed']) {
            return $result['exit_code'];
        }

        $payload = [
            'mode' => 'execute',
            'available' => false,
            'blocked_reason' => $result['blocked_reason'],
            'writes' => 0,
            'job_key' => $result['job_key'],
            'lock' => $result['lock'],
            'secrets' => 'not_printed',
            'exit_code' => 1,
        ];

        if ($input->hasOption('json') && (bool) $input->getOption('json')) {
            $output->writeln((string) json_encode($payload, JSON_UNESCAPED_SLASHES));
        } else {
            $output->writeln(sprintf(
                '<error>%s unavailable: %s secrets=not_printed</error>',
                $this->getName(),
                $result['blocked_reason'],
            ));
        }

        return self::FAILURE;
    }
}
