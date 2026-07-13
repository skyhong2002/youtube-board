<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class PhotoCacheBuilder
{
    private const LOCK_KEY = 'ingestion:reports.photos.build';

    private const MIN_LOCK_SECONDS = 600;

    private const MAX_LOCK_SECONDS = 3600;

    private const REQUEST_BUDGET_SECONDS = 25;

    private const MAX_TAGS = 100;

    private const MAX_TAG_LENGTH = 32;

    private const MAX_URL_LENGTH = 256;

    private const ENDPOINT = 'https://zh.wikipedia.org/w/api.php';

    public function __construct(private readonly HttpFactory $http) {}

    /**
     * @param  list<string>  $onlyTags
     * @return array<string, mixed>
     */
    public function build(
        array $onlyTags = [],
        int $limit = 20,
        bool $refresh = false,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now ??= CarbonImmutable::now($timezone);
        $limit = max(1, min(self::MAX_TAGS, $limit));
        $lockSeconds = $this->lockSeconds($limit);
        $explicit = collect($onlyTags)->contains(fn (mixed $tag): bool => trim((string) $tag) !== '');
        $schemaBlock = $this->schemaBlock($explicit);

        if ($schemaBlock !== null) {
            return $this->emptyPayload($now, $execute, $limit, $refresh, $schemaBlock);
        }

        try {
            $selection = $this->selectTags($onlyTags, $limit, $explicit);
        } catch (Throwable) {
            return $this->emptyPayload($now, $execute, $limit, $refresh, 'source_query_failed');
        }

        if ($selection['tags'] === []) {
            return $this->emptyPayload(
                $now,
                $execute,
                $limit,
                $refresh,
                'no_candidate_tags',
                selection: $selection,
            );
        }

        $lock = null;

        if ($execute) {
            $lock = Cache::lock(self::LOCK_KEY, $lockSeconds);

            if (! $lock->get()) {
                return $this->emptyPayload(
                    $now,
                    true,
                    $limit,
                    $refresh,
                    'lock_busy',
                    available: true,
                    selection: $selection,
                );
            }
        }

        try {
            return $this->process($selection, $limit, $refresh, $execute, $lockSeconds, $now);
        } finally {
            $this->release($lock);
        }
    }

    /**
     * @param  array{tags: list<string>, source: string, source_rows_scanned: int, tags_requested: int, tags_ignored: int}  $selection
     * @return array<string, mixed>
     */
    private function process(
        array $selection,
        int $limit,
        bool $refresh,
        bool $execute,
        int $lockSeconds,
        CarbonImmutable $now,
    ): array {
        $rows = [];
        $cached = 0;
        $wouldInsert = 0;
        $wouldUpdate = 0;
        $inserted = 0;
        $updated = 0;
        $unchanged = 0;
        $skippedNoImage = 0;
        $failed = 0;
        $externalRequests = 0;
        $timestamp = $now->format('Y-m-d H:i:s');

        foreach ($selection['tags'] as $tag) {
            try {
                $existing = DB::table('urt_show_photo')
                    ->where('tag', $tag)
                    ->orderByDesc('pk')
                    ->first();
                $hasUsableCache = $this->isStoredUrlValid($existing->image_url ?? null);

                if ($hasUsableCache && ! $refresh) {
                    $cached++;
                    $unchanged++;
                    $rows[] = $this->row($tag, 'cached', null, (string) $existing->image_url);

                    continue;
                }

                if (! $execute) {
                    $status = $existing === null ? 'would_insert' : 'would_update';
                    $existing === null ? $wouldInsert++ : $wouldUpdate++;
                    $rows[] = $this->row($tag, $status, $hasUsableCache ? 'refresh_requested' : 'cache_missing');

                    continue;
                }

                $externalRequests++;
                $photo = $this->fetchPhoto($tag);

                if ($photo['failed']) {
                    $failed++;
                    $rows[] = $this->row($tag, 'failed', $photo['reason']);
                    Log::warning('Photo cache tag fetch failed.', [
                        'tag' => $tag,
                        'reason' => $photo['reason'],
                        'status' => $photo['status'],
                    ]);

                    continue;
                }

                if ($photo['url'] === null) {
                    $skippedNoImage++;
                    $rows[] = $this->row($tag, 'skipped', 'no_thumbnail');

                    continue;
                }

                $url = $photo['url'];

                if ($existing !== null
                    && hash_equals((string) ($existing->image_url ?? ''), $url)
                    && (string) ($existing->image_source ?? '') === 'wiki') {
                    $unchanged++;
                    $rows[] = $this->row($tag, 'unchanged', null, $url);

                    continue;
                }

                DB::transaction(function () use ($existing, $tag, $url, $timestamp): void {
                    if ($existing === null) {
                        DB::table('urt_show_photo')->insert([
                            'ctime' => $timestamp,
                            'mtime' => null,
                            'tag' => $tag,
                            'image_url' => $url,
                            'image_source' => 'wiki',
                        ]);

                        return;
                    }

                    DB::table('urt_show_photo')
                        ->where('pk', (int) $existing->pk)
                        ->update([
                            'mtime' => $timestamp,
                            'image_url' => $url,
                            'image_source' => 'wiki',
                        ]);
                });

                if ($existing === null) {
                    $inserted++;
                    $rows[] = $this->row($tag, 'inserted', null, $url);
                } else {
                    $updated++;
                    $rows[] = $this->row($tag, 'updated', null, $url);
                }
            } catch (Throwable) {
                $failed++;
                $rows[] = $this->row($tag, 'failed', 'row_processing_failed');
                Log::warning('Photo cache tag processing failed.', [
                    'tag' => $tag,
                    'reason' => 'row_processing_failed',
                ]);
            }
        }

        $payload = [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => true,
            'blocked_reason' => null,
            'generated_at' => $timestamp,
            'source' => $selection['source'],
            'source_rows_scanned' => $selection['source_rows_scanned'],
            'tag_limit' => $limit,
            'tags_requested' => $selection['tags_requested'],
            'tags_selected' => count($selection['tags']),
            'tags_ignored' => $selection['tags_ignored'],
            'selected_tags' => $selection['tags'],
            'refresh' => $refresh,
            'cached' => $cached,
            'would_insert' => $wouldInsert,
            'would_update' => $wouldUpdate,
            'inserted' => $inserted,
            'updated' => $updated,
            'unchanged' => $unchanged,
            'skipped_no_image' => $skippedNoImage,
            'failed_tags' => $failed,
            'external_requests' => $externalRequests,
            'writes' => $execute ? $inserted + $updated : 0,
            'write_targets' => ['urt_show_photo'],
            'rows' => $rows,
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => $execute,
                'ttl_seconds' => $lockSeconds,
            ],
        ];

        Log::info('Photo cache build completed.', [
            'mode' => $payload['mode'],
            'source' => $payload['source'],
            'tags_selected' => $payload['tags_selected'],
            'external_requests' => $payload['external_requests'],
            'writes' => $payload['writes'],
            'failed_tags' => $payload['failed_tags'],
        ]);

        return $payload;
    }

    /**
     * @return array{url: string|null, reason: string|null, failed: bool, status: int|null}
     */
    private function fetchPhoto(string $tag): array
    {
        try {
            $response = $this->http
                ->acceptJson()
                ->withUserAgent('youtube-board photo-cache-builder/1.0')
                ->connectTimeout(5)
                ->timeout(10)
                ->retry(2, 200, fn (Throwable $exception): bool => $this->shouldRetry($exception), false)
                ->get(self::ENDPOINT, [
                    'action' => 'query',
                    'format' => 'json',
                    'prop' => 'pageimages',
                    'titles' => $tag,
                    'pithumbsize' => 500,
                ]);
        } catch (Throwable) {
            return ['url' => null, 'reason' => 'connection_failed', 'failed' => true, 'status' => null];
        }

        if (! $response->successful()) {
            return [
                'url' => null,
                'reason' => 'http_'.$response->status(),
                'failed' => true,
                'status' => $response->status(),
            ];
        }

        $payload = $response->json();

        if (! is_array($payload) || isset($payload['error'])) {
            return ['url' => null, 'reason' => 'invalid_response', 'failed' => true, 'status' => $response->status()];
        }

        $pages = data_get($payload, 'query.pages');

        if (! is_array($pages)) {
            return ['url' => null, 'reason' => 'no_thumbnail', 'failed' => false, 'status' => $response->status()];
        }

        foreach ($pages as $page) {
            if (! is_array($page)) {
                continue;
            }

            $url = data_get($page, 'thumbnail.source');

            if (! is_string($url) || trim($url) === '') {
                continue;
            }

            $url = trim($url);

            if (! $this->isFetchedUrlValid($url)) {
                return ['url' => null, 'reason' => 'unsafe_thumbnail_url', 'failed' => true, 'status' => $response->status()];
            }

            return ['url' => $url, 'reason' => null, 'failed' => false, 'status' => $response->status()];
        }

        return ['url' => null, 'reason' => 'no_thumbnail', 'failed' => false, 'status' => $response->status()];
    }

    private function shouldRetry(Throwable $exception): bool
    {
        if ($exception instanceof ConnectionException) {
            return true;
        }

        if (! $exception instanceof RequestException || $exception->response === null) {
            return false;
        }

        $status = $exception->response->status();

        return $status === 429 || $status >= 500;
    }

    private function isFetchedUrlValid(string $url): bool
    {
        if (! $this->isStoredUrlValid($url)) {
            return false;
        }

        $host = strtolower((string) parse_url($url, PHP_URL_HOST));

        return $host === 'upload.wikimedia.org' || str_ends_with($host, '.wikimedia.org');
    }

    private function isStoredUrlValid(mixed $url): bool
    {
        if (! is_string($url) || strlen($url) > self::MAX_URL_LENGTH || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return false;
        }

        return strtolower((string) parse_url($url, PHP_URL_SCHEME)) === 'https';
    }

    /**
     * @param  list<string>  $onlyTags
     * @return array{tags: list<string>, source: string, source_rows_scanned: int, tags_requested: int, tags_ignored: int}
     */
    private function selectTags(array $onlyTags, int $limit, bool $explicit): array
    {
        if ($explicit) {
            $raw = collect($onlyTags)
                ->map(fn (mixed $tag): string => trim((string) $tag))
                ->filter()
                ->unique()
                ->values();
            $tags = $raw
                ->filter(fn (string $tag): bool => mb_strlen($tag, 'UTF-8') <= self::MAX_TAG_LENGTH)
                ->take($limit)
                ->values()
                ->all();

            return [
                'tags' => $tags,
                'source' => 'explicit',
                'source_rows_scanned' => count($raw),
                'tags_requested' => count($raw),
                'tags_ignored' => max(0, count($raw) - count($tags)),
            ];
        }

        $query = DB::table('tags')->select('tag');

        if (Schema::hasColumn('tags', 'no_tag')) {
            $query->where(function ($query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', 0);
            });
        }

        if (Schema::hasColumn('tags', 'max_count')) {
            $query->orderByDesc('max_count');
        }

        if (Schema::hasColumn('tags', 'pk')) {
            $query->orderBy('pk');
        }

        $sourceRows = $query
            ->limit(min(500, max($limit, $limit * 4)))
            ->get();
        $tags = $sourceRows
            ->map(fn (object $row): string => trim((string) ($row->tag ?? '')))
            ->filter(fn (string $tag): bool => $tag !== '' && mb_strlen($tag, 'UTF-8') <= self::MAX_TAG_LENGTH)
            ->unique()
            ->take($limit)
            ->values()
            ->all();

        return [
            'tags' => $tags,
            'source' => 'local_tags',
            'source_rows_scanned' => $sourceRows->count(),
            'tags_requested' => $sourceRows->count(),
            'tags_ignored' => max(0, $sourceRows->count() - count($tags)),
        ];
    }

    private function schemaBlock(bool $explicit): ?string
    {
        if (! Schema::hasTable('urt_show_photo')) {
            return 'missing_table:urt_show_photo';
        }

        if (! Schema::hasColumns('urt_show_photo', ['pk', 'ctime', 'mtime', 'tag', 'image_url', 'image_source'])) {
            return 'missing_columns:urt_show_photo';
        }

        if (! $explicit && ! Schema::hasTable('tags')) {
            return 'missing_table:tags';
        }

        if (! $explicit && ! Schema::hasColumn('tags', 'tag')) {
            return 'missing_columns:tags';
        }

        return null;
    }

    /**
     * @param  array{tags: list<string>, source: string, source_rows_scanned: int, tags_requested: int, tags_ignored: int}|null  $selection
     * @return array<string, mixed>
     */
    private function emptyPayload(
        CarbonImmutable $now,
        bool $execute,
        int $limit,
        bool $refresh,
        string $reason,
        bool $available = false,
        ?array $selection = null,
    ): array {
        $selection ??= [
            'tags' => [],
            'source' => 'unavailable',
            'source_rows_scanned' => 0,
            'tags_requested' => 0,
            'tags_ignored' => 0,
        ];

        $payload = [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => $available,
            'blocked_reason' => $reason,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $selection['source'],
            'source_rows_scanned' => $selection['source_rows_scanned'],
            'tag_limit' => $limit,
            'tags_requested' => $selection['tags_requested'],
            'tags_selected' => count($selection['tags']),
            'tags_ignored' => $selection['tags_ignored'],
            'selected_tags' => $selection['tags'],
            'refresh' => $refresh,
            'cached' => 0,
            'would_insert' => 0,
            'would_update' => 0,
            'inserted' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'skipped_no_image' => 0,
            'failed_tags' => 0,
            'external_requests' => 0,
            'writes' => 0,
            'write_targets' => ['urt_show_photo'],
            'rows' => [],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => false,
                'ttl_seconds' => $this->lockSeconds($limit),
            ],
        ];

        Log::warning('Photo cache build blocked.', [
            'mode' => $payload['mode'],
            'reason' => $reason,
            'source' => $payload['source'],
            'tags_selected' => $payload['tags_selected'],
        ]);

        return $payload;
    }

    private function lockSeconds(int $limit): int
    {
        return max(
            self::MIN_LOCK_SECONDS,
            min(self::MAX_LOCK_SECONDS, ($limit * self::REQUEST_BUDGET_SECONDS) + 120),
        );
    }

    /**
     * @return array{tag: string, status: string, reason: string|null, image_url: string|null}
     */
    private function row(string $tag, string $status, ?string $reason = null, ?string $url = null): array
    {
        return [
            'tag' => $tag,
            'status' => $status,
            'reason' => $reason,
            'image_url' => $url,
        ];
    }

    private function release(?Lock $lock): void
    {
        if ($lock === null) {
            return;
        }

        try {
            $lock->release();
        } catch (Throwable) {
            // Expired locks are safe to ignore after the command has finished.
        }
    }
}
