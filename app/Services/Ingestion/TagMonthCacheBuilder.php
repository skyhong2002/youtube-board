<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TagMonthCacheBuilder
{
    private const LOCK_KEY = 'ingestion:reports.tag_month.build';

    private const LOCK_SECONDS = 1800;

    private const MAX_MONTHS = 24;

    private const MAX_SUBJECTS = 100;

    private const MAX_SOURCE_ROWS = 31;

    /**
     * @param  list<string>  $months
     * @param  list<string>  $subjects
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @return array<string, mixed>
     */
    public function build(
        array $months,
        array $subjects,
        array $tagIds = [],
        array $orTagIds = [],
        array $notTagIds = [],
        int $monthLimit = 12,
        int $subjectLimit = 20,
        int $sourceRowLimit = 31,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', 'Asia/Taipei');
        $now ??= CarbonImmutable::now($timezone);
        $monthLimit = max(1, min(self::MAX_MONTHS, $monthLimit));
        $subjectLimit = max(1, min(self::MAX_SUBJECTS, $subjectLimit));
        $sourceRowLimit = max(1, min(self::MAX_SOURCE_ROWS, $sourceRowLimit));
        $monthRequests = $this->requestedValues($months);
        $subjectRequests = $this->requestedValues($subjects);
        $months = $this->months($months, $monthLimit, $timezone);
        $subjects = $this->subjects($subjects, $subjectLimit);
        $selection = [
            'months_requested' => count($monthRequests),
            'months_ignored' => max(0, count($monthRequests) - count($months)),
            'subjects_requested' => count($subjectRequests),
            'subjects_ignored' => max(0, count($subjectRequests) - count($subjects)),
        ];
        $tagIds = $this->ids($tagIds);
        $orTagIds = $this->ids($orTagIds);
        $notTagIds = $this->ids($notTagIds);
        $blockedReason = match (true) {
            count($monthRequests) > $monthLimit => 'month_list_limit_exceeded',
            count($subjectRequests) > $subjectLimit => 'subject_list_limit_exceeded',
            count($tagIds) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT => 'tagid_list_limit_exceeded',
            count($orTagIds) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT => 'or_tag_list_limit_exceeded',
            count($notTagIds) > ReportCacheBuildGuardrails::TAG_ID_LIST_LIMIT => 'not_tag_list_limit_exceeded',
            $months === [] => 'explicit_months_required',
            $subjects === [] => 'explicit_subjects_required',
            default => $this->schemaBlock(),
        };

        if ($blockedReason !== null) {
            return $this->emptyPayload(
                now: $now,
                execute: $execute,
                months: $months,
                subjects: $subjects,
                tagIds: $tagIds,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                monthLimit: $monthLimit,
                subjectLimit: $subjectLimit,
                sourceRowLimit: $sourceRowLimit,
                selection: $selection,
                reason: $blockedReason,
            );
        }

        $lock = null;

        if ($execute) {
            $lock = Cache::lock(self::LOCK_KEY, self::LOCK_SECONDS);

            if (! $lock->get()) {
                return $this->emptyPayload(
                    now: $now,
                    execute: true,
                    months: $months,
                    subjects: $subjects,
                    tagIds: $tagIds,
                    orTagIds: $orTagIds,
                    notTagIds: $notTagIds,
                    monthLimit: $monthLimit,
                    subjectLimit: $subjectLimit,
                    sourceRowLimit: $sourceRowLimit,
                    selection: $selection,
                    reason: 'cache_build_locked',
                    available: true,
                );
            }
        }

        try {
            return $this->process(
                now: $now,
                months: $months,
                subjects: $subjects,
                tagIds: $tagIds,
                orTagIds: $orTagIds,
                notTagIds: $notTagIds,
                monthLimit: $monthLimit,
                subjectLimit: $subjectLimit,
                sourceRowLimit: $sourceRowLimit,
                selection: $selection,
                execute: $execute,
            );
        } finally {
            $this->release($lock);
        }
    }

    /**
     * @param  list<string>  $months
     * @param  list<string>  $subjects
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @param  array{months_requested: int, months_ignored: int, subjects_requested: int, subjects_ignored: int}  $selection
     * @return array<string, mixed>
     */
    private function process(
        CarbonImmutable $now,
        array $months,
        array $subjects,
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        int $monthLimit,
        int $subjectLimit,
        int $sourceRowLimit,
        array $selection,
        bool $execute,
    ): array {
        $generatedAt = $now->format('Y-m-d H:i:s');
        $rows = [];
        $wouldInsert = 0;
        $wouldUpdate = 0;
        $inserted = 0;
        $updated = 0;
        $unchanged = 0;
        $skipped = 0;
        $failed = 0;
        $blockedMonths = 0;
        $truncatedMonths = 0;
        $invalidDailyRows = 0;
        $sourceRows = 0;

        foreach ($months as $month) {
            try {
                $dailySelection = $this->dailyRows($month, $tagIds, $orTagIds, $notTagIds, $sourceRowLimit);
                $dailyRows = $dailySelection['rows'];
            } catch (Throwable) {
                $failed += count($subjects);

                foreach ($subjects as $subject) {
                    $rows[] = $this->resultRow($month, $subject, 'failed', 'source_query_failed');
                }

                continue;
            }

            $sourceRows += count($dailyRows);
            $invalidDailyRows += $dailySelection['invalid_rows'];

            if ($dailySelection['truncated']) {
                $blockedMonths++;
                $truncatedMonths++;
                $failed += count($subjects);

                foreach ($subjects as $subject) {
                    $rows[] = $this->resultRow($month, $subject, 'blocked', 'source_row_limit_exceeded', sourceDates: count($dailyRows));
                }

                continue;
            }

            if ($dailySelection['invalid_rows'] > 0) {
                $blockedMonths++;
                $failed += count($subjects);

                foreach ($subjects as $subject) {
                    $rows[] = $this->resultRow($month, $subject, 'blocked', 'invalid_daily_json', sourceDates: count($dailyRows));
                }

                continue;
            }

            foreach ($subjects as $subject) {
                try {
                    $metrics = $this->subjectMetrics($dailyRows, $subject);
                    $existingRows = $this->cacheQuery($month, $subject, $tagIds, $orTagIds, $notTagIds)
                        ->orderByDesc('pk')
                        ->get();
                    $existing = $existingRows->first();
                    $status = 'unchanged';

                    if ($existing === null && $metrics['daily'] === []) {
                        $skipped++;
                        $status = 'skipped';
                    } elseif ($existing === null) {
                        $wouldInsert++;
                        $status = 'would_insert';
                    } elseif ($existingRows->contains(fn (object $row): bool => ! $this->sameCache($row, $metrics))) {
                        $wouldUpdate++;
                        $status = 'would_update';
                    } else {
                        $unchanged++;
                    }

                    if ($execute && in_array($status, ['would_insert', 'would_update'], true)) {
                        DB::transaction(function () use (
                            $existing,
                            $metrics,
                            $month,
                            $subject,
                            $tagIds,
                            $orTagIds,
                            $notTagIds,
                            $generatedAt,
                            &$inserted,
                            &$updated,
                            &$status,
                        ): void {
                            $payload = $this->cachePayload($metrics, $generatedAt);

                            if ($existing === null) {
                                DB::table('urt_show_tag_month')->insert($payload + [
                                    'ctime' => $generatedAt,
                                    'tag' => $subject,
                                    'tagid' => $this->filterValue($tagIds),
                                    'tag_or' => $this->filterValue($orTagIds),
                                    'tag_not' => $this->filterValue($notTagIds),
                                    'the_month' => $month,
                                ]);
                                $inserted++;
                                $status = 'inserted';

                                return;
                            }

                            $this->cacheQuery($month, $subject, $tagIds, $orTagIds, $notTagIds)->update($payload);
                            $updated++;
                            $status = 'updated';
                        });
                    }

                    $rows[] = $this->resultRow(
                        month: $month,
                        subject: $subject,
                        status: $status,
                        reason: $status === 'skipped' ? 'subject_not_present_in_daily_cache' : null,
                        sourceDates: $metrics['source_dates'],
                        countVideos: $metrics['count_videos'],
                        totalViews: $metrics['total_views'],
                    );
                } catch (Throwable) {
                    $failed++;
                    $rows[] = $this->resultRow($month, $subject, 'failed', 'subject_cache_processing_failed');
                }
            }
        }

        $payload = [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => true,
            'blocked_reason' => $blockedMonths > 0 ? 'source_incomplete' : null,
            'source_complete' => $failed === 0,
            'source_truncated' => $truncatedMonths > 0,
            'generated_at' => $generatedAt,
            'months' => $months,
            'subjects' => $subjects,
            'month_limit' => $monthLimit,
            'subject_limit' => $subjectLimit,
            'source_row_limit' => $sourceRowLimit,
            'months_requested' => $selection['months_requested'],
            'months_ignored' => $selection['months_ignored'],
            'subjects_requested' => $selection['subjects_requested'],
            'subjects_ignored' => $selection['subjects_ignored'],
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'source_rows' => $sourceRows,
            'rows_planned' => count($months) * count($subjects),
            'would_insert' => $wouldInsert,
            'would_update' => $wouldUpdate,
            'inserted' => $inserted,
            'updated' => $updated,
            'unchanged' => $unchanged,
            'skipped' => $skipped,
            'failed_subjects' => $failed,
            'blocked_months' => $blockedMonths,
            'invalid_daily_rows' => $invalidDailyRows,
            'writes' => $execute ? $inserted + $updated : 0,
            'write_targets' => ['urt_show_tag_month'],
            'rows' => $rows,
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => $execute,
                'ttl_seconds' => self::LOCK_SECONDS,
            ],
        ];

        Log::log($failed > 0 ? 'warning' : 'info', 'Tag month cache build completed.', [
            'mode' => $payload['mode'],
            'months' => count($months),
            'subjects' => count($subjects),
            'source_rows' => $sourceRows,
            'writes' => $payload['writes'],
            'failed_subjects' => $failed,
            'blocked_months' => $blockedMonths,
            'invalid_daily_rows' => $invalidDailyRows,
        ]);

        return $payload;
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @return array{rows: list<object>, truncated: bool, invalid_rows: int}
     */
    private function dailyRows(string $month, array $tagIds, array $orTagIds, array $notTagIds, int $sourceRowLimit): array
    {
        $from = $month;
        $to = CarbonImmutable::parse($month, 'Asia/Taipei')->endOfMonth()->toDateString();
        $latest = DB::table('urt_show_tag_date')
            ->selectRaw('MAX(pk)')
            ->whereBetween('the_date', [$from, $to])
            ->groupBy('the_date');
        $this->applyFilters($latest, $tagIds, $orTagIds, $notTagIds);

        $rows = DB::table('urt_show_tag_date')
            ->whereIn('pk', $latest)
            ->orderByDesc('the_date')
            ->limit($sourceRowLimit + 1)
            ->get(['pk', 'the_date', 'tags_result', 'tags_video', 'tags_views'])
            ->all();

        $selectedRows = array_slice($rows, 0, $sourceRowLimit);

        return [
            'rows' => $selectedRows,
            'truncated' => count($rows) > $sourceRowLimit,
            'invalid_rows' => collect($selectedRows)
                ->filter(fn (object $row): bool => ! $this->validDailyJson($row))
                ->count(),
        ];
    }

    private function validDailyJson(object $row): bool
    {
        $columns = [
            'tags_result' => ['tags_result', 'score', 'weight', 'value', 'count'],
            'tags_video' => ['tags_video', 'videos', 'count_videos', 'count', 'value', 'score'],
            'tags_views' => ['tags_views', 'views', 'total_views', 'value', 'count', 'score'],
        ];

        foreach ($columns as $column => $valueKeys) {
            $json = $row->{$column} ?? null;

            if (! is_string($json) || trim($json) === '') {
                return false;
            }

            try {
                $decoded = json_decode($json, true, 512, JSON_THROW_ON_ERROR);

                if (! is_array($decoded) || ! $this->validMetricCollection($decoded, $valueKeys)) {
                    return false;
                }
            } catch (Throwable) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<mixed>  $decoded
     * @param  list<string>  $valueKeys
     */
    private function validMetricCollection(array $decoded, array $valueKeys): bool
    {
        foreach (['tags_result', 'tags_views', 'tags_video', 'result', 'data', 'keywords'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];

                break;
            }
        }

        if ($decoded === []) {
            return true;
        }

        if (array_is_list($decoded)) {
            foreach ($decoded as $item) {
                if (! is_array($item)
                    || trim((string) ($item['tag'] ?? $item['keyword'] ?? $item['name'] ?? '')) === ''
                    || ! $this->containsNumericMetric($item, $valueKeys)) {
                    return false;
                }
            }

            return true;
        }

        foreach ($decoded as $subject => $value) {
            if (! is_string($subject) || trim($subject) === '') {
                return false;
            }

            if (is_numeric($value)) {
                continue;
            }

            if (! is_array($value) || ! $this->containsNumericMetric($value, $valueKeys)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  array<mixed>  $value
     * @param  list<string>  $valueKeys
     */
    private function containsNumericMetric(array $value, array $valueKeys): bool
    {
        foreach ($valueKeys as $key) {
            if (array_key_exists($key, $value) && is_numeric($value[$key])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<object>  $rows
     * @return array{daily: array<string, array<string, int|float|string>>, source_dates: int, count_videos: int, total_views: int}
     */
    private function subjectMetrics(array $rows, string $subject): array
    {
        $daily = [];
        $countVideos = 0;
        $totalViews = 0;

        foreach ($rows as $row) {
            $date = substr((string) ($row->the_date ?? ''), 0, 10);
            $views = $this->metricValue($row->tags_views ?? null, $subject, ['tags_views', 'views', 'total_views', 'value', 'count', 'score']);
            $videos = $this->metricValue($row->tags_video ?? null, $subject, ['tags_video', 'videos', 'count_videos', 'count', 'value', 'score']);
            $score = $this->metricValue($row->tags_result ?? null, $subject, ['tags_result', 'score', 'weight', 'value', 'count']);

            if ($views === null && $videos === null && $score === null) {
                continue;
            }

            $entry = [
                'tags_views' => max(0, (int) ($views ?? 0)),
                'tags_video' => max(0, (int) ($videos ?? 0)),
                'total_views' => max(0, (int) ($views ?? 0)),
                'count_videos' => max(0, (int) ($videos ?? 0)),
            ];

            if ($score !== null) {
                $entry['tags_result'] = $score;
            }

            $daily[$date] = $entry;
            $countVideos += $entry['tags_video'];
            $totalViews += $entry['tags_views'];
        }

        ksort($daily);

        return [
            'daily' => $daily,
            'source_dates' => count($daily),
            'count_videos' => $countVideos,
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param  list<string>  $valueKeys
     */
    private function metricValue(mixed $json, string $subject, array $valueKeys): int|float|string|null
    {
        if (! is_string($json) || trim($json) === '' || trim($json) === 'null') {
            return null;
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded)) {
            return null;
        }

        foreach (['tags_result', 'tags_views', 'tags_video', 'result', 'data', 'keywords'] as $key) {
            if (isset($decoded[$key]) && is_array($decoded[$key])) {
                $decoded = $decoded[$key];
                break;
            }
        }

        if (array_key_exists($subject, $decoded)) {
            if (is_numeric($decoded[$subject])) {
                return $decoded[$subject];
            }

            if (is_array($decoded[$subject])) {
                foreach ($valueKeys as $key) {
                    if (isset($decoded[$subject][$key]) && is_numeric($decoded[$subject][$key])) {
                        return $decoded[$subject][$key];
                    }
                }
            }
        }

        foreach ($decoded as $item) {
            if (! is_array($item)) {
                continue;
            }

            $name = (string) ($item['tag'] ?? $item['keyword'] ?? $item['name'] ?? '');

            if ($name !== $subject) {
                continue;
            }

            foreach ($valueKeys as $key) {
                if (isset($item[$key]) && is_numeric($item[$key])) {
                    return $item[$key];
                }
            }
        }

        return null;
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     */
    private function cacheQuery(string $month, string $subject, array $tagIds, array $orTagIds, array $notTagIds): Builder
    {
        $query = DB::table('urt_show_tag_month')
            ->where('tag', $subject)
            ->where('the_month', $month);
        $this->applyFilters($query, $tagIds, $orTagIds, $notTagIds);

        return $query;
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     */
    private function applyFilters(Builder $query, array $tagIds, array $orTagIds, array $notTagIds): void
    {
        $this->whereFilter($query, 'tagid', $this->filterValue($tagIds));
        $this->whereFilter($query, 'tag_or', $this->filterValue($orTagIds));
        $this->whereFilter($query, 'tag_not', $this->filterValue($notTagIds));
    }

    private function whereFilter(Builder $query, string $column, ?string $value): void
    {
        if ($value !== null) {
            $query->where($column, $value);

            return;
        }

        $query->where(function (Builder $query) use ($column): void {
            $query->whereNull($column)->orWhere($column, '');
        });
    }

    /**
     * @param  list<int>  $ids
     */
    private function filterValue(array $ids): ?string
    {
        return $ids === [] ? null : implode(',', $ids);
    }

    /**
     * @param  array{daily: array<string, array<string, int|float|string>>, count_videos: int, total_views: int}  $metrics
     */
    private function sameCache(object $existing, array $metrics): bool
    {
        $existingDaily = json_decode((string) ($existing->tags_result ?? ''), true);

        return is_array($existingDaily)
            && $existingDaily === $metrics['daily']
            && (int) ($existing->count_videos ?? 0) === $metrics['count_videos']
            && (int) ($existing->total_views ?? 0) === $metrics['total_views'];
    }

    /**
     * @param  array{daily: array<string, array<string, int|float|string>>, count_videos: int, total_views: int}  $metrics
     * @return array<string, mixed>
     */
    private function cachePayload(array $metrics, string $generatedAt): array
    {
        return [
            'mtime' => $generatedAt,
            'count_videos' => $metrics['count_videos'],
            'total_views' => $metrics['total_views'],
            'tags_result' => json_encode($metrics['daily'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function resultRow(
        string $month,
        string $subject,
        string $status,
        ?string $reason,
        int $sourceDates = 0,
        int $countVideos = 0,
        int $totalViews = 0,
    ): array {
        return [
            'month' => $month,
            'subject' => $subject,
            'status' => $status,
            'reason' => $reason,
            'source_dates' => $sourceDates,
            'count_videos' => $countVideos,
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param  list<string>  $values
     * @return list<string>
     */
    private function months(array $values, int $limit, string $timezone): array
    {
        return collect($values)
            ->map(function (mixed $value) use ($timezone): ?string {
                $value = trim((string) $value);

                if (preg_match('/^\d{4}-\d{2}$/', $value) === 1) {
                    $value .= '-01';
                }

                if (preg_match('/^\d{4}-\d{2}-01$/', $value) !== 1) {
                    return null;
                }

                try {
                    $month = CarbonImmutable::parse($value, $timezone);

                    return $month->toDateString() === $value ? $value : null;
                } catch (Throwable) {
                    return null;
                }
            })
            ->filter()
            ->unique()
            ->sort()
            ->take($limit)
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $values
     * @return list<string>
     */
    private function subjects(array $values, int $limit): array
    {
        return collect($values)
            ->map(fn (mixed $value): string => trim((string) $value))
            ->filter(fn (string $value): bool => $value !== '' && mb_strlen($value, 'UTF-8') <= 64)
            ->unique()
            ->take($limit)
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $values
     * @return list<string>
     */
    private function requestedValues(array $values): array
    {
        return collect($values)
            ->map(fn (mixed $value): string => trim((string) $value))
            ->filter(fn (string $value): bool => $value !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  list<int>  $values
     * @return list<int>
     */
    private function ids(array $values): array
    {
        return collect($values)
            ->map(fn (mixed $value): int => (int) $value)
            ->filter(fn (int $value): bool => $value > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    private function schemaBlock(): ?string
    {
        foreach (['urt_show_tag_date', 'urt_show_tag_month'] as $table) {
            if (! Schema::hasTable($table)) {
                return 'missing_table:'.$table;
            }
        }

        $columns = [
            'urt_show_tag_date' => ['pk', 'tagid', 'tag_or', 'tag_not', 'the_date', 'tags_result', 'tags_video', 'tags_views'],
            'urt_show_tag_month' => ['pk', 'ctime', 'mtime', 'tag', 'tagid', 'tag_or', 'tag_not', 'the_month', 'count_videos', 'total_views', 'tags_result'],
        ];

        foreach ($columns as $table => $required) {
            if (! Schema::hasColumns($table, $required)) {
                return 'missing_columns:'.$table;
            }
        }

        return null;
    }

    /**
     * @param  list<string>  $months
     * @param  list<string>  $subjects
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @param  array{months_requested: int, months_ignored: int, subjects_requested: int, subjects_ignored: int}  $selection
     * @return array<string, mixed>
     */
    private function emptyPayload(
        CarbonImmutable $now,
        bool $execute,
        array $months,
        array $subjects,
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        int $monthLimit,
        int $subjectLimit,
        int $sourceRowLimit,
        array $selection,
        string $reason,
        bool $available = false,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => $available,
            'blocked_reason' => $reason,
            'source_complete' => false,
            'source_truncated' => str_ends_with($reason, '_limit_exceeded'),
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'months' => $months,
            'subjects' => $subjects,
            'month_limit' => $monthLimit,
            'subject_limit' => $subjectLimit,
            'source_row_limit' => $sourceRowLimit,
            'months_requested' => $selection['months_requested'],
            'months_ignored' => $selection['months_ignored'],
            'subjects_requested' => $selection['subjects_requested'],
            'subjects_ignored' => $selection['subjects_ignored'],
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'source_rows' => 0,
            'rows_planned' => count($months) * count($subjects),
            'would_insert' => 0,
            'would_update' => 0,
            'inserted' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'skipped' => 0,
            'failed_subjects' => 0,
            'blocked_months' => 0,
            'invalid_daily_rows' => 0,
            'writes' => 0,
            'write_targets' => ['urt_show_tag_month'],
            'rows' => [],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => false,
                'ttl_seconds' => self::LOCK_SECONDS,
            ],
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
            // An expired lock no longer needs release after the command finishes.
        }
    }
}
