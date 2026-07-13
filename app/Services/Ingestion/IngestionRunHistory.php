<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class IngestionRunHistory
{
    private const DIRECTORY = 'ingestion-runs';

    private const DATABASE_PATH_PREFIX = 'database:ingestion_runs/';

    private const PRUNE_BATCH_SIZE = 1000;

    private const ID_PATTERN = '/^\d{8}-\d{6}-[0-9a-f-]{36}$/';

    private ?bool $databaseTablesAvailable = null;

    /** @var list<string>|null */
    private ?array $datedFilePaths = null;

    /** @var list<string>|null */
    private ?array $undatedFilePaths = null;

    /** @var array<string, int|null> */
    private array $fileModificationTimes = [];

    /** @var array<string, array{latest_attempt_at: ?CarbonImmutable, latest_attempt_status: ?string, latest_attempt_action: ?string, latest_attempt_exit_code: ?int, latest_success_at: ?CarbonImmutable}> */
    private array $jobHistoryCache = [];

    /** @var array<string, CarbonImmutable|null> */
    private array $successfulJobRunCache = [];

    /**
     * @param  array<string, mixed>  $result
     * @param  array<string, mixed>  $request
     * @return array<string, mixed>
     */
    public function record(array $result, array $request): array
    {
        $createdAt = CarbonImmutable::now($this->timezone());
        $id = $createdAt->format('Ymd-His').'-'.Str::lower((string) Str::uuid());
        $baseRecord = [
            'id' => $id,
            'created_at' => $createdAt->toDateTimeString().' '.$createdAt->getTimezone()->getName(),
            'request' => $request,
            'result' => $result,
        ];

        try {
            $databaseAvailable = $this->databaseTablesAvailable();
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('schema-check', $id, $exception);

            return $this->recordFileFallback($baseRecord, $createdAt);
        }

        if (! $databaseAvailable) {
            return $this->recordFileFallback($baseRecord, $createdAt);
        }

        $record = $baseRecord + [
            'path' => self::DATABASE_PATH_PREFIX.$id,
            'history_storage' => 'database',
        ];

        try {
            $this->persistDatabaseRecord($record, $createdAt);
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('write', $id, $exception);

            return $this->recordFileFallback($baseRecord, $createdAt);
        }

        $this->resetReadCaches();

        try {
            $this->pruneDatabaseIfDue($createdAt);
        } catch (Throwable $exception) {
            Log::warning('Ingestion run history pruning failed.', [
                'run_id' => $id,
                'reason' => SensitiveTextRedactor::exception($exception, 240),
            ]);
        }

        return $record;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function latest(int $limit = 8): array
    {
        $limit = max(1, min(500, $limit));
        $records = [];

        try {
            if ($this->databaseTablesAvailable()) {
                $records = $this->databaseLatest($limit);
            }
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('latest-read', null, $exception);
        }

        $knownIds = array_fill_keys(array_column($records, 'id'), true);

        foreach ($this->undatedFilePaths() as $path) {
            $this->mergeFileRecord($records, $knownIds, $path, $limit);
        }

        foreach ($this->datedFilePaths() as $path) {
            if (count($records) >= $limit && $this->pathPrecedesLatestCutoff($path, $records)) {
                break;
            }

            $this->mergeFileRecord($records, $knownIds, $path, $limit);
        }

        $this->sortRecordsDescending($records);

        return array_slice($records, 0, $limit);
    }

    /**
     * @return array{
     *     active: bool,
     *     window_minutes: int,
     *     latest: array<string, mixed>|null,
     *     latest_created_at: string|null,
     *     latest_age_seconds: int|null,
     *     summary: array<string, mixed>,
     *     not_observed_reasons: list<string>
     * }
     */
    public function externalSchedulerActivity(int $windowMinutes = 3, ?CarbonImmutable $now = null): array
    {
        $windowMinutes = max(1, min(60, $windowMinutes));
        $timezone = $this->timezone();
        $now ??= CarbonImmutable::now($timezone);

        $latest = collect($this->latest(30))
            ->first(fn (array $record): bool => $this->isExternalSchedulerRecord($record));

        $createdAt = $latest !== null ? $this->createdAt($latest, $timezone) : null;
        $ageSeconds = $createdAt !== null ? max(0, $createdAt->diffInSeconds($now)) : null;
        $active = $ageSeconds !== null && $ageSeconds <= ($windowMinutes * 60);

        return [
            'active' => $active,
            'window_minutes' => $windowMinutes,
            'latest' => $latest,
            'latest_created_at' => $createdAt !== null ? $createdAt->toDateTimeString().' '.$createdAt->getTimezone()->getName() : null,
            'latest_age_seconds' => $ageSeconds,
            'summary' => is_array($latest['result']['summary'] ?? null) ? $latest['result']['summary'] : [],
            'not_observed_reasons' => [
                'Dokploy scheduled task may be disabled or paused.',
                'The scheduled command may not include ingestion:run --execute --record.',
                'The app may not be able to persist ingestion run history.',
                'No external scheduler run record was created within the recent activity window.',
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function youtubeQuotaDailyEstimate(?CarbonImmutable $now = null): array
    {
        $quotaTimezone = 'America/Los_Angeles';
        $appTimezone = $this->timezone();
        $now = $now !== null ? $now->setTimezone($quotaTimezone) : CarbonImmutable::now($quotaTimezone);
        $start = $now->startOfDay();
        $dailyLimit = max(1, (int) config('services.youtube.quota.daily_limit', 10000));
        $estimator = app(YoutubeQuotaEstimator::class);
        $total = 0;
        $recordCount = 0;
        $jobBreakdown = [];
        $latestRecordAt = null;

        foreach ($this->recordsInWindow($start, $now, $appTimezone) as $record) {
            if (($record['result']['mode'] ?? $record['request']['mode'] ?? null) !== 'execute') {
                continue;
            }

            $createdAt = $this->createdAt($record, $appTimezone)?->setTimezone($quotaTimezone);

            if ($createdAt === null || $createdAt->lessThan($start) || $createdAt->greaterThan($now)) {
                continue;
            }

            $recordCount++;
            $latestRecordAt = $latestRecordAt === null || $createdAt->greaterThan($latestRecordAt)
                ? $createdAt
                : $latestRecordAt;

            $runUnits = 0;
            $jobs = is_array($record['result']['jobs'] ?? null) ? $record['result']['jobs'] : [];

            foreach ($jobs as $job) {
                if (! is_array($job)) {
                    continue;
                }

                $estimate = $this->jobQuotaEstimate($job, $estimator);
                $units = (int) ($estimate['estimated_units'] ?? 0);
                $runUnits += $units;

                if ($units <= 0) {
                    continue;
                }

                $jobKey = (string) ($job['key'] ?? 'unknown');
                $jobBreakdown[$jobKey] ??= [
                    'job' => $jobKey,
                    'units' => 0,
                    'runs' => 0,
                ];
                $jobBreakdown[$jobKey]['units'] += $units;
                $jobBreakdown[$jobKey]['runs']++;
            }

            if ($runUnits === 0 && is_array($record['result']['youtube_quota_estimate'] ?? null)) {
                $runUnits = (int) ($record['result']['youtube_quota_estimate']['estimated_units'] ?? 0);
            }

            $total += $runUnits;
        }

        $breakdown = array_values($jobBreakdown);
        usort($breakdown, fn (array $a, array $b): int => $b['units'] <=> $a['units']);

        return [
            'estimated_units' => $total,
            'daily_limit' => $dailyLimit,
            'remaining_units' => max(0, $dailyLimit - $total),
            'percent_used' => round(($total / $dailyLimit) * 100, 1),
            'window_start' => $start->format('Y-m-d H:i:s T'),
            'window_end' => $now->format('Y-m-d H:i:s T'),
            'window_timezone' => $quotaTimezone,
            'record_count' => $recordCount,
            'latest_record_at' => $latestRecordAt?->format('Y-m-d H:i:s T'),
            'job_breakdown' => $breakdown,
            'source' => 'durable database-backed ingestion run history',
            'basis' => 'sum of per-job estimated_youtube_quota_units for execute-mode run records in the current YouTube quota day',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function aiProviderUsageDailyEstimate(?CarbonImmutable $now = null): array
    {
        $appTimezone = $this->timezone();
        $now = $now !== null ? $now->setTimezone($appTimezone) : CarbonImmutable::now($appTimezone);
        $start = $now->startOfDay();
        $summarizer = app(AiProviderUsageSummary::class);
        $summary = $summarizer->emptySummary();
        $recordCount = 0;
        $latestRecordAt = null;

        foreach ($this->recordsInWindow($start, $now, $appTimezone) as $record) {
            if (($record['result']['mode'] ?? $record['request']['mode'] ?? null) !== 'execute') {
                continue;
            }

            $createdAt = $this->createdAt($record, $appTimezone);

            if ($createdAt === null || $createdAt->lessThan($start) || $createdAt->greaterThan($now)) {
                continue;
            }

            $result = is_array($record['result'] ?? null) ? $record['result'] : [];
            $recordSummary = $summarizer->summarizePayload($result);

            if (! $summarizer->hasActivity($recordSummary)) {
                continue;
            }

            $recordCount++;
            $latestRecordAt = $latestRecordAt === null || $createdAt->greaterThan($latestRecordAt)
                ? $createdAt
                : $latestRecordAt;
            $summary = $summarizer->merge($summary, $recordSummary);
        }

        $successfulCalls = $summarizer->total($summary, 'successful_calls');
        $failedAttempts = $summarizer->total($summary, 'failed_attempts');

        return $summary + [
            'successful_calls' => $successfulCalls,
            'failed_attempts' => $failedAttempts,
            'prompt_tokens' => $summarizer->total($summary, 'prompt_tokens'),
            'completion_tokens' => $summarizer->total($summary, 'completion_tokens'),
            'total_tokens' => $summarizer->total($summary, 'total_tokens'),
            'window_start' => $start->format('Y-m-d H:i:s T'),
            'window_end' => $now->format('Y-m-d H:i:s T'),
            'window_timezone' => $appTimezone,
            'record_count' => $recordCount,
            'latest_record_at' => $latestRecordAt?->format('Y-m-d H:i:s T'),
            'source' => 'durable database-backed ingestion run history',
            'basis' => 'successful AI completion providers and failed provider attempts recorded in execute-mode ingestion run payloads/output for the current app day',
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        if (! preg_match(self::ID_PATTERN, $id)) {
            return null;
        }

        try {
            if ($this->databaseTablesAvailable()) {
                $row = DB::table('ingestion_runs')->where('id', $id)->first();

                if ($row !== null) {
                    $record = $this->decodeDatabaseRow($row);

                    if ($record !== null) {
                        return $record;
                    }
                }
            }
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('find-read', $id, $exception);
        }

        return $this->readFileRecord(self::DIRECTORY.'/'.$id.'.json');
    }

    /**
     * @return array{latest_attempt_at: ?CarbonImmutable, latest_attempt_status: ?string, latest_attempt_action: ?string, latest_attempt_exit_code: ?int, latest_success_at: ?CarbonImmutable}
     */
    public function latestJobHistory(string $jobKey): array
    {
        $history = $this->emptyJobHistory();
        $jobKey = trim($jobKey);

        if ($jobKey === '') {
            return $history;
        }

        if (array_key_exists($jobKey, $this->jobHistoryCache)) {
            return $this->jobHistoryCache[$jobKey];
        }

        try {
            if ($this->databaseTablesAvailable()) {
                $query = $this->databaseJobHistoryQuery()
                    ->where('jobs.job_key', $jobKey)
                    ->where('jobs.attempted', true);
                $attempt = (clone $query)
                    ->orderByDesc('jobs.recorded_at')
                    ->orderByDesc('jobs.run_id')
                    ->first([
                        'jobs.recorded_at',
                        'jobs.succeeded',
                        'jobs.action',
                        'jobs.exit_code',
                        'jobs.started_at',
                    ]);
                $success = (clone $query)
                    ->where('jobs.succeeded', true)
                    ->orderByDesc('jobs.recorded_at')
                    ->orderByDesc('jobs.run_id')
                    ->first(['jobs.recorded_at']);

                if ($attempt !== null) {
                    $attemptAt = $this->databaseTimestamp($attempt->recorded_at);

                    if ($attemptAt !== null) {
                        $history['latest_attempt_at'] = $attemptAt;
                        $history['latest_attempt_status'] = (bool) $attempt->succeeded
                            ? 'success'
                            : ($this->nonEmptyString($attempt->started_at) !== null ? 'failed' : 'blocked');
                        $history['latest_attempt_action'] = $this->nonEmptyString($attempt->action);
                        $history['latest_attempt_exit_code'] = is_numeric($attempt->exit_code)
                            ? (int) $attempt->exit_code
                            : null;
                    }
                }

                if ($success !== null) {
                    $history['latest_success_at'] = $this->databaseTimestamp($success->recorded_at);
                }
            }
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('job-history-read', null, $exception);
        }

        $fileHistory = $this->fileJobHistory(
            $jobKey,
            $history['latest_attempt_at'],
            $history['latest_success_at'],
        );

        if ($fileHistory['latest_attempt_at'] !== null
            && ($history['latest_attempt_at'] === null
                || $fileHistory['latest_attempt_at']->greaterThan($history['latest_attempt_at']))) {
            foreach (['latest_attempt_at', 'latest_attempt_status', 'latest_attempt_action', 'latest_attempt_exit_code'] as $key) {
                $history[$key] = $fileHistory[$key];
            }
        }

        if ($fileHistory['latest_success_at'] !== null
            && ($history['latest_success_at'] === null
                || $fileHistory['latest_success_at']->greaterThan($history['latest_success_at']))) {
            $history['latest_success_at'] = $fileHistory['latest_success_at'];
        }

        return $this->jobHistoryCache[$jobKey] = $history;
    }

    /**
     * @param  list<string>  $jobKeys
     */
    public function latestSuccessfulJobRun(array $jobKeys): ?CarbonImmutable
    {
        $jobKeys = array_values(array_unique(array_filter(array_map(
            fn (mixed $key): string => is_string($key) ? trim($key) : '',
            $jobKeys,
        ))));

        if ($jobKeys === []) {
            return null;
        }

        sort($jobKeys);
        $cacheKey = implode('|', $jobKeys);

        if (array_key_exists($cacheKey, $this->successfulJobRunCache)) {
            return $this->successfulJobRunCache[$cacheKey];
        }

        $latest = null;

        try {
            if ($this->databaseTablesAvailable()) {
                $row = $this->databaseJobHistoryQuery()
                    ->whereIn('jobs.job_key', $jobKeys)
                    ->where('jobs.attempted', true)
                    ->where('jobs.succeeded', true)
                    ->orderByDesc('jobs.recorded_at')
                    ->orderByDesc('jobs.run_id')
                    ->first(['jobs.recorded_at']);

                if ($row !== null) {
                    $timestamp = $this->databaseTimestamp($row->recorded_at);

                    $latest = $timestamp;
                }
            }
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('job-success-read', null, $exception);
        }

        $latest = $this->latestSuccessfulFileJobRun(array_fill_keys($jobKeys, true), $latest);

        return $this->successfulJobRunCache[$cacheKey] = $latest;
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function recordFileFallback(array $record, CarbonImmutable $createdAt): array
    {
        $id = (string) $record['id'];
        $path = self::DIRECTORY.'/'.$id.'.json';
        $record['path'] = $path;
        $record['history_storage'] = 'file';

        Storage::disk('local')->put($path, $this->encodeRecord($record));
        $this->resetReadCaches();

        try {
            $this->pruneFileFallback($createdAt);
        } catch (Throwable $exception) {
            Log::warning('Ingestion run history file fallback pruning failed.', [
                'run_id' => $id,
                'reason' => SensitiveTextRedactor::exception($exception, 240),
            ]);
        }

        return $record;
    }

    private function pruneFileFallback(CarbonImmutable $now): void
    {
        $paths = $this->datedFilePaths();
        $cutoff = $now->subDays($this->retentionDays());
        $expired = array_values(array_filter(
            $paths,
            fn (string $path): bool => $this->filePathTimestamp($path, $this->timezone())?->lessThan($cutoff) === true,
        ));
        $remaining = array_values(array_diff($paths, $expired));
        $overflow = array_slice($remaining, $this->maxRecords());
        $deletions = array_values(array_unique([...$expired, ...$overflow]));

        if ($deletions === []) {
            return;
        }

        $disk = Storage::disk('local');

        foreach (array_chunk($deletions, self::PRUNE_BATCH_SIZE) as $batch) {
            if (! $disk->delete($batch)) {
                throw new \RuntimeException('ingestion_run_history_file_prune_failed');
            }
        }

        $this->resetReadCaches();
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function persistDatabaseRecord(array $record, CarbonImmutable $createdAt): void
    {
        $recordedAt = $createdAt->utc()->toDateTimeString();
        $timestamp = CarbonImmutable::now('UTC')->toDateTimeString();
        $jobRows = $this->normalizedAttemptedJobRows($record, $recordedAt, $timestamp);

        DB::transaction(function () use ($record, $recordedAt, $timestamp, $jobRows): void {
            DB::table('ingestion_runs')->insert([
                'id' => $record['id'],
                'recorded_at' => $recordedAt,
                'request_source' => $this->boundedString(data_get($record, 'request.source'), 32),
                'request_mode' => $this->boundedString(data_get($record, 'request.mode'), 16),
                'result_mode' => $this->boundedString(data_get($record, 'result.mode'), 16),
                'payload_json' => $this->encodeRecord($record),
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ]);

            if ($jobRows !== []) {
                DB::table('ingestion_run_jobs')->insert(array_values($jobRows));
            }
        });
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, array<string, mixed>>
     */
    private function normalizedAttemptedJobRows(array $record, string $recordedAt, string $timestamp): array
    {
        $rows = [];
        $jobs = data_get($record, 'result.jobs', []);

        if (! is_array($jobs)) {
            return [];
        }

        foreach ($jobs as $job) {
            if (! is_array($job) || ! $this->jobAttempted($job)) {
                continue;
            }

            $jobKey = $this->boundedString($job['key'] ?? null, 120);

            if ($jobKey === null) {
                continue;
            }

            $rows[$jobKey] = [
                'run_id' => $record['id'],
                'job_key' => $jobKey,
                'recorded_at' => $recordedAt,
                'attempted' => true,
                'succeeded' => $this->jobSucceeded($job),
                'failed' => ($job['failed'] ?? false) === true,
                'action' => $this->boundedString($job['action'] ?? null, 120),
                'exit_code' => is_numeric($job['exit_code'] ?? null) ? (int) $job['exit_code'] : null,
                'started_at' => $this->boundedString($job['started_at'] ?? null, 64),
                'finished_at' => $this->boundedString($job['finished_at'] ?? null, 64),
                'created_at' => $timestamp,
                'updated_at' => $timestamp,
            ];
        }

        return $rows;
    }

    private function pruneDatabaseIfDue(CarbonImmutable $now): void
    {
        $cacheKey = 'ingestion-run-history:prune:'.sha1(
            (string) DB::connection()->getDatabaseName().'|'.$now->utc()->format('Y-m-d-H'),
        );
        $retentionDays = $this->retentionDays();
        $maxRecords = $this->maxRecords();
        $ageCleanupDue = false;

        try {
            $ageCleanupDue = Cache::add($cacheKey, true, 7200);
        } catch (Throwable $exception) {
            Log::warning('Ingestion run history age cleanup gate failed; enforcing record cap only.', [
                'reason' => SensitiveTextRedactor::exception($exception, 240),
            ]);
        }

        try {
            if ($ageCleanupDue) {
                do {
                    $expiredIds = DB::table('ingestion_runs')
                        ->where('recorded_at', '<', $now->utc()->subDays($retentionDays)->toDateTimeString())
                        ->orderBy('recorded_at')
                        ->orderBy('id')
                        ->limit(self::PRUNE_BATCH_SIZE)
                        ->pluck('id')
                        ->all();

                    if ($expiredIds !== []) {
                        DB::table('ingestion_runs')->whereIn('id', $expiredIds)->delete();
                    }
                } while (count($expiredIds) === self::PRUNE_BATCH_SIZE);
            }

            do {
                $overflow = max(0, DB::table('ingestion_runs')->count() - $maxRecords);

                if ($overflow === 0) {
                    break;
                }

                $oldestIds = DB::table('ingestion_runs')
                    ->orderBy('recorded_at')
                    ->orderBy('id')
                    ->limit(min(self::PRUNE_BATCH_SIZE, $overflow))
                    ->pluck('id')
                    ->all();

                if ($oldestIds === []) {
                    break;
                }

                DB::table('ingestion_runs')->whereIn('id', $oldestIds)->delete();
            } while (true);
        } catch (Throwable $exception) {
            if ($ageCleanupDue) {
                Cache::forget($cacheKey);
            }

            throw $exception;
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function databaseLatest(int $limit): array
    {
        return DB::table('ingestion_runs')
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (object $row): ?array => $this->decodeDatabaseRow($row))
            ->filter()
            ->values()
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recordsInWindow(CarbonImmutable $start, CarbonImmutable $end, string $timezone): array
    {
        $records = [];

        try {
            if ($this->databaseTablesAvailable()) {
                $records = DB::table('ingestion_runs')
                    ->whereBetween('recorded_at', [
                        $start->utc()->toDateTimeString(),
                        $end->utc()->toDateTimeString(),
                    ])
                    ->orderBy('recorded_at')
                    ->orderBy('id')
                    ->get()
                    ->map(fn (object $row): ?array => $this->decodeDatabaseRow($row))
                    ->filter()
                    ->values()
                    ->all();
            }
        } catch (Throwable $exception) {
            $this->logDatabaseFallback('window-read', null, $exception);
        }

        $knownIds = array_fill_keys(array_column($records, 'id'), true);
        $pathScanStart = $start->setTimezone($timezone)->subDay();
        $pathScanEnd = $end->setTimezone($timezone)->addDay();

        foreach ($this->undatedFilePaths() as $path) {
            $this->mergeWindowFileRecord($records, $knownIds, $path, $start, $end, $timezone);
        }

        foreach ($this->datedFilePaths() as $path) {
            $pathTimestamp = $this->filePathTimestamp($path, $timezone);

            if ($pathTimestamp === null) {
                continue;
            }

            if (($pathTimestamp->greaterThan($pathScanEnd) || $pathTimestamp->lessThan($pathScanStart))
                && ! $this->fileWasModifiedInWindow($path, $pathScanStart, $pathScanEnd)) {
                continue;
            }

            $this->mergeWindowFileRecord($records, $knownIds, $path, $start, $end, $timezone);
        }

        return $records;
    }

    /**
     * @return list<string>
     */
    private function datedFilePaths(): array
    {
        $this->loadFilePaths();

        return $this->datedFilePaths ?? [];
    }

    /**
     * @return list<string>
     */
    private function undatedFilePaths(): array
    {
        $this->loadFilePaths();

        return $this->undatedFilePaths ?? [];
    }

    private function loadFilePaths(): void
    {
        if ($this->datedFilePaths !== null && $this->undatedFilePaths !== null) {
            return;
        }

        try {
            $disk = Storage::disk('local');
            $paths = [];

            if (method_exists($disk, 'getDriver')) {
                foreach ($disk->getDriver()->listContents(self::DIRECTORY, false) as $attributes) {
                    if (! $attributes->isFile()) {
                        continue;
                    }

                    $path = $attributes->path();
                    $paths[] = $path;
                    $this->fileModificationTimes[$path] = $attributes->lastModified();
                }
            } else {
                $paths = $disk->files(self::DIRECTORY);
            }
        } catch (Throwable) {
            try {
                $paths = Storage::disk('local')->files(self::DIRECTORY);
            } catch (Throwable) {
                $paths = [];
            }
        }

        $dated = [];
        $undated = [];

        foreach ($paths as $path) {
            if (! str_ends_with($path, '.json')) {
                continue;
            }

            $id = pathinfo($path, PATHINFO_FILENAME);

            if (preg_match(self::ID_PATTERN, $id)) {
                $dated[] = $path;
            } else {
                $undated[] = $path;
            }
        }

        rsort($dated, SORT_STRING);
        sort($undated, SORT_STRING);

        $this->datedFilePaths = $dated;
        $this->undatedFilePaths = $undated;
    }

    /**
     * @param  list<array<string, mixed>>  $records
     * @param  array<string, bool>  $knownIds
     */
    private function mergeFileRecord(array &$records, array &$knownIds, string $path, int $limit): void
    {
        $record = $this->readFileRecord($path);
        $id = $record['id'] ?? null;

        if (! is_string($id) || isset($knownIds[$id])) {
            return;
        }

        $records[] = $record;
        $knownIds[$id] = true;

        if (count($records) > $limit) {
            $this->sortRecordsDescending($records);
            $records = array_slice($records, 0, $limit);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $records
     * @param  array<string, bool>  $knownIds
     */
    private function mergeWindowFileRecord(
        array &$records,
        array &$knownIds,
        string $path,
        CarbonImmutable $start,
        CarbonImmutable $end,
        string $timezone,
    ): void {
        $record = $this->readFileRecord($path);
        $id = $record['id'] ?? null;
        $createdAt = $record !== null ? $this->createdAt($record, $timezone) : null;

        if (! is_string($id) || isset($knownIds[$id]) || $createdAt === null) {
            return;
        }

        if ($createdAt->lessThan($start) || $createdAt->greaterThan($end)) {
            return;
        }

        $records[] = $record;
        $knownIds[$id] = true;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function readFileRecord(string $path): ?array
    {
        try {
            $payload = json_decode((string) Storage::disk('local')->get($path), true);
        } catch (Throwable) {
            return null;
        }

        if (! is_array($payload)) {
            return null;
        }

        $payload['path'] = $path;
        $payload['history_storage'] = 'file';

        return $payload;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeDatabaseRow(object $row): ?array
    {
        $payload = json_decode((string) ($row->payload_json ?? ''), true);

        if (! is_array($payload) || ! is_string($row->id ?? null)) {
            return null;
        }

        $payload['id'] = $row->id;
        $payload['path'] = self::DATABASE_PATH_PREFIX.$row->id;
        $payload['history_storage'] = 'database';

        return $payload;
    }

    /**
     * @param  list<array<string, mixed>>  $records
     */
    private function sortRecordsDescending(array &$records): void
    {
        $timezone = $this->timezone();

        usort($records, function (array $left, array $right) use ($timezone): int {
            $leftTimestamp = $this->createdAt($left, $timezone)?->getTimestamp() ?? 0;
            $rightTimestamp = $this->createdAt($right, $timezone)?->getTimestamp() ?? 0;

            return ($rightTimestamp <=> $leftTimestamp)
                ?: strcmp((string) ($right['id'] ?? ''), (string) ($left['id'] ?? ''));
        });
    }

    /**
     * @param  list<array<string, mixed>>  $records
     */
    private function pathPrecedesLatestCutoff(string $path, array $records): bool
    {
        $pathTimestamp = $this->filePathTimestamp($path, $this->timezone());

        if ($pathTimestamp === null) {
            return false;
        }

        $cutoff = null;

        foreach ($records as $record) {
            $recordTimestamp = $this->createdAt($record, $this->timezone());

            if ($recordTimestamp === null) {
                return false;
            }

            if ($cutoff === null || $recordTimestamp->lessThan($cutoff)) {
                $cutoff = $recordTimestamp;
            }
        }

        return $cutoff !== null && $pathTimestamp->lessThan($cutoff);
    }

    private function filePathTimestamp(string $path, string $timezone): ?CarbonImmutable
    {
        $id = pathinfo($path, PATHINFO_FILENAME);

        if (! preg_match(self::ID_PATTERN, $id)) {
            return null;
        }

        try {
            $timestamp = CarbonImmutable::createFromFormat('Ymd-His', substr($id, 0, 15), $timezone);

            return $timestamp instanceof CarbonImmutable ? $timestamp : null;
        } catch (Throwable) {
            return null;
        }
    }

    private function fileWasModifiedInWindow(
        string $path,
        CarbonImmutable $start,
        CarbonImmutable $end,
    ): bool {
        if (! array_key_exists($path, $this->fileModificationTimes)) {
            try {
                $this->fileModificationTimes[$path] = Storage::disk('local')->lastModified($path);
            } catch (Throwable) {
                $this->fileModificationTimes[$path] = null;
            }
        }

        $modifiedAt = $this->fileModificationTimes[$path];

        return is_int($modifiedAt)
            && $modifiedAt >= $start->getTimestamp()
            && $modifiedAt <= $end->getTimestamp();
    }

    /**
     * @return array{latest_attempt_at: ?CarbonImmutable, latest_attempt_status: ?string, latest_attempt_action: ?string, latest_attempt_exit_code: ?int, latest_success_at: ?CarbonImmutable}
     */
    private function fileJobHistory(
        string $jobKey,
        ?CarbonImmutable $attemptFloor,
        ?CarbonImmutable $successFloor,
    ): array {
        $history = $this->emptyJobHistory();

        foreach ($this->undatedFilePaths() as $path) {
            $record = $this->readFileRecord($path);

            if ($record !== null) {
                $this->mergeFileJobHistory($history, $record, $jobKey, $attemptFloor, $successFloor);
            }
        }

        foreach ($this->datedFilePaths() as $path) {
            $pathTimestamp = $this->filePathTimestamp($path, $this->timezone());
            $latestAttempt = $this->laterTimestamp($attemptFloor, $history['latest_attempt_at']);
            $latestSuccess = $this->laterTimestamp($successFloor, $history['latest_success_at']);

            if ($pathTimestamp !== null
                && $latestAttempt !== null
                && $latestSuccess !== null
                && ! $pathTimestamp->greaterThan($latestAttempt)
                && ! $pathTimestamp->greaterThan($latestSuccess)) {
                break;
            }

            $record = $this->readFileRecord($path);

            if ($record !== null) {
                $this->mergeFileJobHistory($history, $record, $jobKey, $attemptFloor, $successFloor);
            }
        }

        return $history;
    }

    /**
     * @param  array{latest_attempt_at: ?CarbonImmutable, latest_attempt_status: ?string, latest_attempt_action: ?string, latest_attempt_exit_code: ?int, latest_success_at: ?CarbonImmutable}  $history
     * @param  array<string, mixed>  $record
     */
    private function mergeFileJobHistory(
        array &$history,
        array $record,
        string $jobKey,
        ?CarbonImmutable $attemptFloor,
        ?CarbonImmutable $successFloor,
    ): void {
        if (! $this->isExternalSchedulerRecord($record)) {
            return;
        }

        $timestamp = $this->createdAt($record, $this->timezone());

        if ($timestamp === null) {
            return;
        }

        foreach ($record['result']['jobs'] ?? [] as $job) {
            if (! is_array($job) || ($job['key'] ?? null) !== $jobKey || ! $this->jobAttempted($job)) {
                continue;
            }

            if (($attemptFloor === null || $timestamp->greaterThan($attemptFloor))
                && ($history['latest_attempt_at'] === null || $timestamp->greaterThan($history['latest_attempt_at']))) {
                $history['latest_attempt_at'] = $timestamp;
                $history['latest_attempt_status'] = $this->jobAttemptStatus($job);
                $history['latest_attempt_action'] = $this->nonEmptyString($job['action'] ?? null);
                $history['latest_attempt_exit_code'] = is_numeric($job['exit_code'] ?? null)
                    ? (int) $job['exit_code']
                    : null;
            }

            if ($this->jobSucceeded($job)
                && ($successFloor === null || $timestamp->greaterThan($successFloor))
                && ($history['latest_success_at'] === null || $timestamp->greaterThan($history['latest_success_at']))) {
                $history['latest_success_at'] = $timestamp;
            }
        }
    }

    /**
     * @param  array<string, bool>  $wanted
     */
    private function latestSuccessfulFileJobRun(array $wanted, ?CarbonImmutable $latest): ?CarbonImmutable
    {
        foreach ($this->undatedFilePaths() as $path) {
            $latest = $this->successfulFileJobRunTimestamp($this->readFileRecord($path), $wanted, $latest);
        }

        foreach ($this->datedFilePaths() as $path) {
            $pathTimestamp = $this->filePathTimestamp($path, $this->timezone());

            if ($pathTimestamp !== null && $latest !== null && ! $pathTimestamp->greaterThan($latest)) {
                break;
            }

            $candidate = $this->successfulFileJobRunTimestamp($this->readFileRecord($path), $wanted, $latest);

            if ($candidate !== $latest) {
                $latest = $candidate;
                break;
            }
        }

        return $latest;
    }

    /**
     * @param  array<string, mixed>|null  $record
     * @param  array<string, bool>  $wanted
     */
    private function successfulFileJobRunTimestamp(
        ?array $record,
        array $wanted,
        ?CarbonImmutable $floor,
    ): ?CarbonImmutable {
        if ($record === null || ! $this->isExternalSchedulerRecord($record)) {
            return $floor;
        }

        $timestamp = $this->createdAt($record, $this->timezone());

        if ($timestamp === null || ($floor !== null && ! $timestamp->greaterThan($floor))) {
            return $floor;
        }

        foreach ($record['result']['jobs'] ?? [] as $job) {
            if (is_array($job)
                && isset($wanted[(string) ($job['key'] ?? '')])
                && $this->jobSucceeded($job)) {
                return $timestamp;
            }
        }

        return $floor;
    }

    private function laterTimestamp(?CarbonImmutable $left, ?CarbonImmutable $right): ?CarbonImmutable
    {
        if ($left === null) {
            return $right;
        }

        if ($right === null) {
            return $left;
        }

        return $right->greaterThan($left) ? $right : $left;
    }

    /**
     * @return array{latest_attempt_at: ?CarbonImmutable, latest_attempt_status: ?string, latest_attempt_action: ?string, latest_attempt_exit_code: ?int, latest_success_at: ?CarbonImmutable}
     */
    private function emptyJobHistory(): array
    {
        return [
            'latest_attempt_at' => null,
            'latest_attempt_status' => null,
            'latest_attempt_action' => null,
            'latest_attempt_exit_code' => null,
            'latest_success_at' => null,
        ];
    }

    private function databaseJobHistoryQuery(): Builder
    {
        return DB::table('ingestion_run_jobs as jobs')
            ->join('ingestion_runs as runs', 'runs.id', '=', 'jobs.run_id')
            ->where('runs.request_source', 'artisan')
            ->where('runs.request_mode', 'execute')
            ->where('runs.result_mode', 'execute');
    }

    private function databaseTimestamp(mixed $value): ?CarbonImmutable
    {
        if ($value === null) {
            return null;
        }

        try {
            return CarbonImmutable::parse((string) $value, 'UTC')->setTimezone($this->timezone());
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $job
     * @return array<string, mixed>
     */
    private function jobQuotaEstimate(array $job, YoutubeQuotaEstimator $estimator): array
    {
        if (is_array($job['youtube_quota_estimate'] ?? null)) {
            return $job['youtube_quota_estimate'];
        }

        return $estimator->estimateJob($job);
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function isExternalSchedulerRecord(array $record): bool
    {
        return ($record['request']['source'] ?? null) === 'artisan'
            && ($record['request']['mode'] ?? null) === 'execute'
            && ($record['result']['mode'] ?? null) === 'execute';
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function jobSucceeded(array $job): bool
    {
        return ($job['executed'] ?? false) === true
            && ($job['failed'] ?? false) !== true
            && ((int) ($job['exit_code'] ?? 0)) === 0;
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function jobAttempted(array $job): bool
    {
        return ($job['executed'] ?? false) === true || ($job['failed'] ?? false) === true;
    }

    /**
     * @param  array<string, mixed>  $job
     */
    private function jobAttemptStatus(array $job): string
    {
        if ($this->jobSucceeded($job)) {
            return 'success';
        }

        return $this->nonEmptyString($job['started_at'] ?? null) !== null ? 'failed' : 'blocked';
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function createdAt(array $record, string $timezone): ?CarbonImmutable
    {
        $createdAt = $record['created_at'] ?? null;

        if (is_string($createdAt) && trim($createdAt) !== '') {
            try {
                return CarbonImmutable::parse($createdAt, $timezone)->setTimezone($timezone);
            } catch (Throwable) {
                return null;
            }
        }

        $id = $record['id'] ?? null;

        if (is_string($id) && preg_match('/^(\d{8})-(\d{6})-/', $id, $matches)) {
            $parsed = CarbonImmutable::createFromFormat('Ymd His', $matches[1].' '.$matches[2], $timezone);

            return $parsed instanceof CarbonImmutable ? $parsed : null;
        }

        return null;
    }

    private function databaseTablesAvailable(): bool
    {
        return $this->databaseTablesAvailable ??= Schema::hasTable('ingestion_runs')
            && Schema::hasTable('ingestion_run_jobs');
    }

    private function retentionDays(): int
    {
        return max(1, min(3650, (int) config('ingestion.run_history.retention_days', 14)));
    }

    private function maxRecords(): int
    {
        return max(1, min(1000000, (int) config('ingestion.run_history.max_records', 25000)));
    }

    private function resetReadCaches(): void
    {
        $this->datedFilePaths = null;
        $this->undatedFilePaths = null;
        $this->fileModificationTimes = [];
        $this->jobHistoryCache = [];
        $this->successfulJobRunCache = [];
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function encodeRecord(array $record): string
    {
        return json_encode(
            $record,
            JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE,
        );
    }

    private function boundedString(mixed $value, int $length): ?string
    {
        $value = $this->nonEmptyString($value);

        return $value !== null ? mb_substr($value, 0, $length) : null;
    }

    private function nonEmptyString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value !== '' ? $value : null;
    }

    private function timezone(): string
    {
        return (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    }

    private function logDatabaseFallback(string $operation, ?string $runId, Throwable $exception): void
    {
        Log::warning('Database ingestion run history unavailable; using local file fallback.', [
            'operation' => $operation,
            'run_id' => $runId,
            'reason' => SensitiveTextRedactor::exception($exception, 240),
        ]);
    }
}
