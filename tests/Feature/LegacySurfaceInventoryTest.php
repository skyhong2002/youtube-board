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
        $legacyFiles = $this->legacyPhpFiles('urtube');
        $routedUris = $this->routedUris();

        $missing = array_values(array_diff($legacyFiles, $routedUris, $this->includeOnlyTopLevelFiles));

        $this->assertSame([], $missing, 'Legacy top-level PHP files missing Laravel routes or include-only notes.');
    }

    public function test_every_legacy_api_php_file_has_a_read_only_compatibility_route(): void
    {
        $legacyApiUris = array_map(
            fn (string $file): string => 'api/'.$file,
            $this->legacyPhpFiles('urtube/api')
        );

        $missing = array_values(array_diff($legacyApiUris, $this->routedUris()));

        $this->assertSame([], $missing, 'Legacy API PHP files missing read-only Laravel compatibility routes.');
    }

    public function test_legacy_redir_and_prompt_php_files_are_guarded(): void
    {
        foreach ($this->legacyPhpFiles('urtube/redir') as $file) {
            $this->get('/redir/'.$file)->assertStatus(403);
        }

        foreach ($this->legacyPhpFiles('urtube/prompt') as $file) {
            $this->get('/prompt/'.$file)->assertStatus(403);
        }
    }

    /**
     * @return list<string>
     */
    private function legacyPhpFiles(string $relativeDirectory): array
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
