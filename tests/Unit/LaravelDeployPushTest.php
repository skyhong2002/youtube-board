<?php

namespace Tests\Unit;

use App\Support\LaravelDeployPush;
use PHPUnit\Framework\TestCase;

class LaravelDeployPushTest extends TestCase
{
    private function push(): array
    {
        $head = str_repeat('b', 40);

        return [
            'before' => str_repeat('a', 40), 'after' => $head,
            'created' => false, 'deleted' => false, 'forced' => false,
            'head_commit' => ['id' => $head],
            'commits' => [['id' => $head, 'added' => [], 'modified' => ['platform/web/app.ts'], 'removed' => []]],
        ];
    }

    public function test_only_complete_ordinary_pushes_can_skip_laravel(): void
    {
        $this->assertTrue(LaravelDeployPush::onlyDocumentationOrPlatform($this->push()));
        foreach (['app/Models/User.php', 'database/migrations/new.php', 'Dockerfile', 'composer.lock', 'platform/../routes/web.php', 'platform\\app.ts', '/platform/app.ts', ''] as $path) {
            $push = $this->push();
            $push['commits'][0]['removed'][] = $path;
            $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push), $path);
        }
        foreach (['before', 'after', 'commits', 'head_commit', 'created', 'deleted', 'forced'] as $field) {
            $push = $this->push();
            unset($push[$field]);
            $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push), $field);
        }
    }

    public function test_partial_commit_files_force_pushes_and_truncated_arrays_are_not_skipped(): void
    {
        $base = $this->push();
        foreach (['added', 'modified', 'removed'] as $field) {
            $push = $base;
            unset($push['commits'][0][$field]);
            $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push));
        }
        foreach (['created', 'deleted', 'forced'] as $field) {
            $push = $base;
            $push[$field] = true;
            $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push));
        }
        $push = $base;
        $push['commits'] = array_fill(0, 2048, $base['commits'][0]);
        $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push));
        $push = $base;
        $push['size'] = 2;
        $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push));
        $push = $base;
        $push['commits'][0]['modified'] = [];
        $this->assertFalse(LaravelDeployPush::onlyDocumentationOrPlatform($push));
    }
}
