<?php

namespace Tests\Unit;

use App\Services\Ingestion\IngestionCommandDeadline;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Process\Process;

class IngestionCommandDeadlineTest extends TestCase
{
    protected function tearDown(): void
    {
        pcntl_alarm(0);

        parent::tearDown();
    }

    public function test_deadline_keeps_a_safety_margin_before_lock_expiration(): void
    {
        $deadline = new IngestionCommandDeadline;

        $this->assertSame(14100, $deadline->seconds(14400));
        $this->assertSame(54, $deadline->seconds(60));
        $this->assertSame(1, $deadline->seconds(6));
    }

    public function test_deadline_returns_callback_result_and_clears_alarm(): void
    {
        $deadline = new IngestionCommandDeadline;

        $this->assertSame(42, $deadline->run(60, fn (): int => 42));
        $this->assertSame(0, pcntl_alarm(0));
    }

    public function test_deadline_exit_cannot_be_swallowed_by_callback_exception_isolation(): void
    {
        $autoload = dirname(__DIR__, 2).'/vendor/autoload.php';
        $script = <<<'PHP'
require %s;
$deadline = new App\Services\Ingestion\IngestionCommandDeadline;
$deadline->run(6, function (): void {
    try {
        usleep(2_000_000);
    } catch (Throwable) {
        fwrite(STDOUT, "caught\n");
    }

    fwrite(STDOUT, "continued\n");
});
fwrite(STDOUT, "returned\n");
PHP;
        $process = new Process([
            PHP_BINARY,
            '-r',
            sprintf($script, var_export($autoload, true)),
        ]);
        $process->setTimeout(5);
        $process->run();

        $this->assertSame(124, $process->getExitCode());
        $this->assertStringContainsString('lock-safe runtime deadline', $process->getErrorOutput());
        $this->assertStringNotContainsString('caught', $process->getOutput());
        $this->assertStringNotContainsString('continued', $process->getOutput());
        $this->assertStringNotContainsString('returned', $process->getOutput());
    }

    public function test_deadline_exit_remains_unconditional_when_stderr_is_closed(): void
    {
        $autoload = dirname(__DIR__, 2).'/vendor/autoload.php';
        $script = <<<'PHP'
require %s;
fclose(STDERR);
$deadline = new App\Services\Ingestion\IngestionCommandDeadline;
$deadline->run(6, function (): void {
    try {
        usleep(2_000_000);
    } catch (Throwable) {
        fwrite(STDOUT, "caught\n");
    }

    fwrite(STDOUT, "continued\n");
});
fwrite(STDOUT, "returned\n");
PHP;
        $process = new Process([
            PHP_BINARY,
            '-r',
            sprintf($script, var_export($autoload, true)),
        ]);
        $process->setTimeout(5);
        $process->run();

        $this->assertSame(124, $process->getExitCode());
        $this->assertStringNotContainsString('caught', $process->getOutput());
        $this->assertStringNotContainsString('continued', $process->getOutput());
        $this->assertStringNotContainsString('returned', $process->getOutput());
    }
}
