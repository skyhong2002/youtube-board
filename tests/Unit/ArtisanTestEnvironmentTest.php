<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Input\ArgvInput;
use Symfony\Component\Process\Process;

final class ArtisanTestEnvironmentTest extends TestCase
{
    public function test_artisan_test_bootstraps_testing_without_affecting_other_commands(): void
    {
        $projectRoot = dirname(__DIR__, 2);
        $probeDirectory = sys_get_temp_dir().'/youtube-board-artisan-environment-'.bin2hex(random_bytes(8));
        $this->assertTrue(mkdir($probeDirectory));
        $probe = $probeDirectory.'/ArtisanTestingEnvironmentProbeTest.php';
        $written = file_put_contents($probe, <<<'PHP'
<?php

use Tests\TestCase;

final class ArtisanTestingEnvironmentProbeTest extends TestCase
{
    public function test_artisan_bootstrapped_the_testing_environment(): void
    {
        $this->assertSame('testing', app()->environment());
        $this->assertSame('testing', getenv('APP_ENV'));
        $this->assertSame('testing', $_ENV['APP_ENV'] ?? null);
        $this->assertSame('testing', $_SERVER['APP_ENV'] ?? null);
    }
}
PHP);

        $this->assertNotFalse($written);

        try {
            $this->assertSame(
                'test',
                (new ArgvInput(['artisan', '--no-ansi', 'test', $probe]))->getFirstArgument(),
            );

            $test = new Process(
                [PHP_BINARY, $projectRoot.'/artisan', 'test', $probe, '--no-ansi'],
                $projectRoot,
                ['APP_ENV' => 'local'],
            );
            $test->setTimeout(60);
            $test->run();
            $testOutput = $test->getOutput().$test->getErrorOutput();

            $this->assertSame(0, $test->getExitCode(), $testOutput);
            $this->assertStringContainsString('1 passed', $testOutput);
            $this->assertStringNotContainsString('file_get_contents(', $testOutput);

            $environment = new Process(
                [PHP_BINARY, $projectRoot.'/artisan', 'env', '--no-ansi'],
                $projectRoot,
                ['APP_ENV' => 'production'],
            );
            $environment->setTimeout(30);
            $environment->run();
            $environmentOutput = $environment->getOutput().$environment->getErrorOutput();

            $this->assertSame(0, $environment->getExitCode(), $environmentOutput);
            $this->assertStringContainsString('production', $environmentOutput);
            $this->assertStringNotContainsString('testing', $environmentOutput);
        } finally {
            @unlink($probe);
            @rmdir($probeDirectory);
        }
    }
}
