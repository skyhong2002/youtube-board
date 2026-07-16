<?php

namespace Tests\Feature;

use PHPUnit\Framework\TestCase;

class LegacyFeatureParityStatusTest extends TestCase
{
    public function test_current_feature_parity_backlog_contains_only_final_statuses(): void
    {
        $path = dirname(__DIR__, 2).'/docs/legacy-inventory/feature-parity.md';
        $contents = file_get_contents($path);

        $this->assertIsString($contents);
        $statuses = [];

        foreach (preg_split('/\R/', $contents) ?: [] as $line) {
            if (! str_starts_with($line, '|')) {
                continue;
            }

            $cells = array_map('trim', explode('|', trim($line, '|')));

            foreach ($cells as $cell) {
                if (in_array($cell, [
                    'done',
                    'intentionally replaced',
                    'scaffolded',
                    'pending',
                    'blocked',
                ], true)) {
                    $statuses[] = $cell;
                }
            }
        }

        $this->assertCount(101, $statuses);
        $this->assertSame(
            [],
            array_values(array_filter(
                $statuses,
                fn (string $status): bool => in_array($status, ['scaffolded', 'pending', 'blocked'], true),
            )),
        );
        $this->assertSame(
            [],
            array_values(array_diff($statuses, ['done', 'intentionally replaced'])),
        );
    }
}
