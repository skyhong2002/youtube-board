<?php

namespace App\Support;

/** A signed GitHub push may be skipped only when its complete path list is usable. */
final class LaravelDeployPush
{
    public static function onlyDocumentationOrPlatform(array $payload): bool
    {
        // GitHub caps webhook commits at 2048. At the cap, completeness is unknown.
        // Created/deleted/forced refs are not ordinary incremental deployments.
        if (($payload['created'] ?? null) !== false || ($payload['deleted'] ?? null) !== false
            || ($payload['forced'] ?? null) !== false) {
            return false;
        }
        foreach (['before', 'after'] as $field) {
            if (! is_string($payload[$field] ?? null) || ! preg_match('/\A[a-f0-9]{40}\z/', $payload[$field])
                || $payload[$field] === str_repeat('0', 40)) {
                return false;
            }
        }
        $commits = $payload['commits'] ?? null;
        if (! is_array($commits) || ! array_is_list($commits) || count($commits) < 1 || count($commits) >= 2048
            || ($payload['head_commit']['id'] ?? null) !== $payload['after']) {
            return false;
        }
        // Some deliveries include explicit sizes. Inconsistent sizes cannot prove completeness.
        if (array_key_exists('size', $payload) && $payload['size'] !== count($commits)) {
            return false;
        }
        $ids = [];
        $paths = 0;
        foreach ($commits as $commit) {
            if (! is_array($commit) || ! is_string($commit['id'] ?? null)
                || ! preg_match('/\A[a-f0-9]{40}\z/', $commit['id']) || isset($ids[$commit['id']])) {
                return false;
            }
            $ids[$commit['id']] = true;
            foreach (['added', 'modified', 'removed'] as $field) {
                if (! is_array($commit[$field] ?? null) || ! array_is_list($commit[$field])) {
                    return false;
                }
                foreach ($commit[$field] as $path) {
                    if (! is_string($path) || $path === '' || strlen($path) > 4096
                        || preg_match('/[\x00-\x1f\x7f\\\\]/', $path)
                        || str_starts_with($path, '/') || in_array('..', explode('/', $path), true)
                        || (! str_starts_with($path, 'docs/') && ! str_starts_with($path, 'platform/')
                            && ! in_array($path, ['README.md', 'AGENTS.md'], true))) {
                        return false;
                    }
                    $paths++;
                }
            }
        }

        return $paths > 0 && isset($ids[$payload['after']]);
    }
}
