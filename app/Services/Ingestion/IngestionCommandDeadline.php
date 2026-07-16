<?php

namespace App\Services\Ingestion;

use Closure;
use RuntimeException;

class IngestionCommandDeadline
{
    /**
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public function run(int $lockSeconds, Closure $callback): mixed
    {
        if (! function_exists('pcntl_alarm')
            || ! function_exists('pcntl_async_signals')
            || ! function_exists('pcntl_signal')
            || ! function_exists('pcntl_signal_get_handler')) {
            throw new RuntimeException('PCNTL is required for lock-safe ingestion execution.');
        }

        $previousHandler = pcntl_signal_get_handler(SIGALRM);
        $previousAsyncSignals = pcntl_async_signals();
        $previousAlarmSeconds = pcntl_alarm(0);
        $deadlineSeconds = $this->seconds($lockSeconds);
        $effectiveSeconds = $previousAlarmSeconds > 0
            ? min($deadlineSeconds, $previousAlarmSeconds)
            : $deadlineSeconds;
        $startedAt = hrtime(true);

        pcntl_async_signals(true);
        pcntl_signal(SIGALRM, static function (): never {
            try {
                if (defined('STDERR') && is_resource(STDERR)) {
                    @fwrite(STDERR, "Ingestion command exceeded its lock-safe runtime deadline.\n");
                }
            } finally {
                exit(124);
            }
        });
        pcntl_alarm($effectiveSeconds);

        try {
            return $callback();
        } finally {
            pcntl_alarm(0);
            pcntl_signal(SIGALRM, $previousHandler);
            pcntl_async_signals($previousAsyncSignals);

            if ($previousAlarmSeconds > 0) {
                $elapsedSeconds = (int) ceil((hrtime(true) - $startedAt) / 1_000_000_000);
                pcntl_alarm(max(1, $previousAlarmSeconds - $elapsedSeconds));
            }
        }
    }

    public function seconds(int $lockSeconds): int
    {
        $lockSeconds = max(6, min(86400, $lockSeconds));
        $safetyMargin = max(5, min(300, (int) floor($lockSeconds / 10)));

        return max(1, $lockSeconds - $safetyMargin);
    }
}
