<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class LegacySurfaceInventoryTest extends TestCase
{
    /**
     * @var list<string>
     */
    private array $includeOnlyTopLevelFiles = [
        'nav_channel.php',
        'nav_group.php',
        'nav_index.php',
        'nav_keyword.php',
        'nav_live.php',
        'nav_media.php',
        'nav_tag.php',
        'nav_view.php',
        'stopwords.php',
    ];

    public function test_every_legacy_top_level_public_php_file_is_routed_or_documented_as_include_only(): void
    {
        $legacyFiles = $this->inventoryPhpFiles('urtube');
        $routedUris = $this->routedUris();

        $this->assertNotEmpty($legacyFiles, 'Committed legacy top-level inventory must not be empty.');
        $missing = array_values(array_diff($legacyFiles, $routedUris, $this->includeOnlyTopLevelFiles));

        $this->assertSame([], $missing, 'Legacy top-level PHP files missing Laravel routes or include-only notes.');
    }

    public function test_every_legacy_api_php_file_has_a_ingestion_compatibility_route(): void
    {
        $legacyApiUris = array_map(
            fn (string $file): string => 'api/'.$file,
            $this->inventoryPhpFiles('urtube/api')
        );

        $this->assertNotEmpty($legacyApiUris, 'Committed legacy API inventory must not be empty.');
        $missing = array_values(array_diff($legacyApiUris, $this->routedUris()));

        $this->assertSame([], $missing, 'Legacy API PHP files missing real-time YouTube dashboard Laravel compatibility routes.');
    }

    public function test_legacy_redir_and_prompt_php_files_are_guarded(): void
    {
        $redirFiles = $this->inventoryPhpFiles('urtube/redir');
        $promptFiles = $this->inventoryPhpFiles('urtube/prompt');

        $this->assertNotEmpty($redirFiles, 'Committed legacy redir inventory must not be empty.');
        $this->assertNotEmpty($promptFiles, 'Committed legacy prompt inventory must not be empty.');

        foreach ($redirFiles as $file) {
            $this->get('/redir/'.$file)->assertStatus(403);
        }

        foreach ($promptFiles as $file) {
            $this->get('/prompt/'.$file)->assertStatus(403);
        }
    }

    public function test_committed_inventory_matches_the_approved_snapshot_when_it_is_available(): void
    {
        $root = rtrim((string) config('legacy.ground_truth_path'), '/').'/urtube';

        if (! is_dir($root)) {
            $this->markTestSkipped('Optional approved legacy snapshot is not mounted.');
        }

        foreach (['urtube', 'urtube/api', 'urtube/redir', 'urtube/prompt'] as $directory) {
            $this->assertSame(
                $this->inventoryPhpFiles($directory),
                $this->snapshotPhpFiles($directory),
                "Committed legacy inventory is stale for {$directory}.",
            );
        }
    }

    /**
     * @return list<string>
     */
    private function inventoryPhpFiles(string $relativeDirectory): array
    {
        $inventory = file(
            base_path('docs/legacy-inventory/legacy-public-files.txt'),
            FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES,
        ) ?: [];
        $directory = trim($relativeDirectory, '/');

        return collect($inventory)
            ->filter(fn (string $path): bool => dirname($path) === $directory)
            ->map(fn (string $path): string => basename($path))
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function snapshotPhpFiles(string $relativeDirectory): array
    {
        $directory = rtrim((string) config('legacy.ground_truth_path'), '/').'/'.trim($relativeDirectory, '/');

        $files = array_map('basename', glob($directory.'/*.php') ?: []);
        sort($files);

        return array_values($files);
    }

    /**
     * @return list<string>
     */
    private function routedUris(): array
    {
        return collect(Route::getRoutes())
            ->map(fn ($route): string => $route->uri())
            ->unique()
            ->sort()
            ->values()
            ->all();
    }
}
