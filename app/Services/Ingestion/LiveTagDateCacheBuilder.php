<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LegacyStopwords;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class LiveTagDateCacheBuilder
{
    private const LOCK_KEY = 'ingestion:reports.live_tag_date.build';

    public function __construct(private readonly LegacyStopwords $stopwords) {}

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @return array<string, mixed>
     */
    public function build(
        string $from,
        string $to,
        array $tagIds = [],
        array $orTagIds = [],
        array $notTagIds = [],
        int $videoLimit = 1000,
        int $keywordLimit = 1000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', 'Asia/Taipei');
        $now ??= CarbonImmutable::now($timezone);
        $videoLimit = max(1, min(10000, $videoLimit));
        $keywordLimit = max(1, min(5000, $keywordLimit));
        $tagIds = $this->normalizedIds($tagIds);
        $orTagIds = $this->normalizedIds($orTagIds);
        $notTagIds = $this->normalizedIds($notTagIds);
        $range = $this->dateRange($from, $to, $timezone);
        $blockedReason = $this->schemaBlocker();

        if ($blockedReason !== null) {
            return $this->logged($this->blockedPayload(
                $range,
                $tagIds,
                $orTagIds,
                $notTagIds,
                $videoLimit,
                $keywordLimit,
                $execute,
                $blockedReason,
                $now,
            ));
        }

        $lock = null;

        if ($execute) {
            $lock = Cache::lock(self::LOCK_KEY, 1800);

            if (! $lock->get()) {
                return $this->logged($this->blockedPayload(
                    $range,
                    $tagIds,
                    $orTagIds,
                    $notTagIds,
                    $videoLimit,
                    $keywordLimit,
                    true,
                    'cache_build_locked',
                    $now,
                ));
            }
        }

        try {
            return $this->logged($this->buildUnlocked(
                $range,
                $tagIds,
                $orTagIds,
                $notTagIds,
                $videoLimit,
                $keywordLimit,
                $execute,
                $now,
            ));
        } finally {
            try {
                $lock?->release();
            } catch (Throwable) {
                // An expired distributed lock must not hide the completed build summary.
            }
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function logged(array $payload): array
    {
        $context = [
            'mode' => $payload['mode'] ?? 'unknown',
            'from' => $payload['from'] ?? null,
            'to' => $payload['to'] ?? null,
            'dates' => $payload['dates'] ?? 0,
            'channels_matched' => $payload['channels_matched'] ?? 0,
            'videos_scanned' => $payload['videos_scanned'] ?? 0,
            'writes' => $payload['writes'] ?? 0,
            'failed_dates' => $payload['failed_dates'] ?? 0,
            'blocked_reason' => $payload['blocked_reason'] ?? null,
        ];

        if (($payload['blocked_reason'] ?? null) !== null || (int) ($payload['failed_dates'] ?? 0) > 0) {
            Log::warning('Live tag-date cache build completed with gaps.', $context);
        } else {
            Log::info('Live tag-date cache build completed.', $context);
        }

        return $payload;
    }

    /**
     * @param  array{from: string, to: string, dates: list<string>}  $range
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @return array<string, mixed>
     */
    private function buildUnlocked(
        array $range,
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        int $videoLimit,
        int $keywordLimit,
        bool $execute,
        CarbonImmutable $now,
    ): array {
        $channelIds = $this->channelIds($tagIds, $orTagIds, $notTagIds);
        $channelFilterActive = $tagIds !== [] || $orTagIds !== [] || $notTagIds !== [];
        $keywords = $this->keywords($keywordLimit);
        $rows = [];
        $wouldInsert = 0;
        $wouldUpdate = 0;
        $inserted = 0;
        $updated = 0;
        $unchanged = 0;
        $failedDates = 0;
        $videosScanned = 0;
        $invalidLogRows = 0;
        $generatedAt = $now->format('Y-m-d H:i:s');

        foreach ($range['dates'] as $date) {
            try {
                $computed = $this->computeDate($date, $channelIds, $channelFilterActive, $keywords, $videoLimit);
                $videosScanned += $computed['videos_scanned'];
                $invalidLogRows += $computed['invalid_log_rows'];
                $existing = $this->cacheQuery($tagIds, $orTagIds, $notTagIds, $date)
                    ->orderByDesc('pk')
                    ->first();
                $status = 'unchanged';

                if ($existing === null) {
                    $wouldInsert++;
                    $status = 'would_insert';
                } elseif (! $this->sameCache($existing, $computed)) {
                    $wouldUpdate++;
                    $status = 'would_update';
                } else {
                    $unchanged++;
                }

                if ($execute && $status !== 'unchanged') {
                    DB::transaction(function () use (
                        $existing,
                        $computed,
                        $tagIds,
                        $orTagIds,
                        $notTagIds,
                        $date,
                        $generatedAt,
                        &$inserted,
                        &$updated,
                        &$status,
                    ): void {
                        $payload = $this->cachePayload($computed, $generatedAt);

                        if ($existing === null) {
                            DB::table('urt_show_live_tag_date')->insert($payload + [
                                'ctime' => $generatedAt,
                                'tagid' => implode(',', $tagIds),
                                'tag_or' => implode(',', $orTagIds),
                                'tag_not' => implode(',', $notTagIds),
                                'the_date' => $date,
                            ]);
                            $inserted++;
                            $status = 'inserted';

                            return;
                        }

                        DB::table('urt_show_live_tag_date')
                            ->where('pk', $existing->pk)
                            ->update($payload);
                        $updated++;
                        $status = 'updated';
                    });
                }

                $rows[] = [
                    'date' => $date,
                    'status' => $status,
                    'reason' => null,
                    'videos_scanned' => $computed['videos_scanned'],
                    'invalid_log_rows' => $computed['invalid_log_rows'],
                    'count_channels' => $computed['count_channels'],
                    'count_videos' => $computed['count_videos'],
                    'count_tags' => $computed['count_tags'],
                    'tags_count' => $computed['tags_count'],
                    'total_views' => $computed['total_views'],
                ];
            } catch (Throwable) {
                $failedDates++;
                $rows[] = [
                    'date' => $date,
                    'status' => 'failed',
                    'reason' => 'cache_date_processing_failed',
                    'videos_scanned' => 0,
                    'invalid_log_rows' => 0,
                    'count_channels' => 0,
                    'count_videos' => 0,
                    'count_tags' => 0,
                    'tags_count' => 0,
                    'total_views' => 0,
                ];
            }
        }

        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => true,
            'blocked_reason' => null,
            'generated_at' => $generatedAt,
            'from' => $range['from'],
            'to' => $range['to'],
            'dates' => count($range['dates']),
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'keyword_limit' => $keywordLimit,
            'video_limit' => $videoLimit,
            'keywords_scanned' => count($keywords),
            'channels_matched' => count($channelIds),
            'videos_scanned' => $videosScanned,
            'invalid_log_rows' => $invalidLogRows,
            'would_insert' => $wouldInsert,
            'would_update' => $wouldUpdate,
            'inserted' => $inserted,
            'updated' => $updated,
            'unchanged' => $unchanged,
            'failed_dates' => $failedDates,
            'writes' => $execute ? $inserted + $updated : 0,
            'write_targets' => ['urt_show_live_tag_date'],
            'rows' => $rows,
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => $execute,
                'ttl_seconds' => 1800,
            ],
        ];
    }

    /**
     * @param  list<int>  $channelIds
     * @param  list<string>  $keywords
     * @return array<string, mixed>
     */
    private function computeDate(
        string $date,
        array $channelIds,
        bool $channelFilterActive,
        array $keywords,
        int $videoLimit,
    ): array {
        $query = DB::table('urt_video_live_log')
            ->select(['videoId', 'u_id', 'max_current', 'log_json'])
            ->where('the_date', $date)
            ->orderBy('pk')
            ->limit($videoLimit);

        if ($channelFilterActive) {
            $query->whereIn('u_id', $channelIds);
        }

        $logs = $query->get();
        $videoIds = $logs->pluck('videoId')->map(fn (mixed $id): string => (string) $id)->filter()->unique()->values()->all();
        $titles = $videoIds === []
            ? collect()
            : DB::table('urt_video')->whereIn('videoId', $videoIds)->pluck('title', 'videoId');
        $videoHours = [];
        $tagsVideo = [];
        $tagsViews = [];
        $hoursVideos = [];
        $hoursViews = [];
        $countTags = 0;
        $totalViews = 0;
        $invalidLogRows = 0;
        $channels = [];

        foreach ($logs as $log) {
            $videoId = trim((string) ($log->videoId ?? ''));
            $decoded = json_decode((string) ($log->log_json ?? ''), true);

            if ($videoId === '' || ! is_array($decoded)) {
                $invalidLogRows++;

                continue;
            }

            $hourPeaks = [];

            foreach ($decoded as $time => $value) {
                if (! is_scalar($value) || preg_match('/^(\d{1,2})(?::\d{2})?$/', (string) $time, $matches) !== 1) {
                    continue;
                }

                $hour = (int) $matches[1];

                if ($hour < 0 || $hour > 23) {
                    continue;
                }

                $hourKey = sprintf('%02d', $hour);
                $hourPeaks[$hourKey] = max($hourPeaks[$hourKey] ?? 0, max(0, (int) $value));
            }

            if ($hourPeaks === []) {
                $invalidLogRows++;

                continue;
            }

            ksort($hourPeaks);
            $videoHours[$videoId] = $hourPeaks;
            $uId = (int) ($log->u_id ?? 0);

            if ($uId > 0) {
                $channels[$uId] = true;
            }

            $maxCurrent = max(max($hourPeaks), max(0, (int) ($log->max_current ?? 0)));
            $totalViews += $maxCurrent;
            $videoKeywords = $this->detectKeywords((string) ($titles[$videoId] ?? ''), $keywords);
            $countTags += count($videoKeywords);

            foreach ($hourPeaks as $hour => $views) {
                $hoursVideos[$hour] = ($hoursVideos[$hour] ?? 0) + 1;
                $hoursViews[$hour] = ($hoursViews[$hour] ?? 0) + $views;
            }

            foreach ($videoKeywords as $keyword) {
                foreach ($hourPeaks as $hour => $views) {
                    $tagsVideo[$keyword][$hour] = ($tagsVideo[$keyword][$hour] ?? 0) + 1;
                    $tagsViews[$keyword][$hour] = ($tagsViews[$keyword][$hour] ?? 0) + $views;
                }
            }
        }

        ksort($videoHours);
        ksort($hoursVideos);
        ksort($hoursViews);
        ksort($tagsVideo);
        ksort($tagsViews);
        $hourResult = [];

        foreach ($hoursVideos as $hour => $count) {
            $hourResult[$hour] = [
                'count' => $count,
                'views' => $hoursViews[$hour] ?? 0,
            ];
        }

        return [
            'videos_scanned' => $logs->count(),
            'invalid_log_rows' => $invalidLogRows,
            'count_channels' => count($channels),
            'count_videos' => count($videoHours),
            'count_tags' => $countTags,
            'tags_count' => count($tagsViews),
            'total_views' => $totalViews,
            'hour_result' => $hourResult,
            'videos_result' => $videoHours,
            'all_result' => [
                'videos' => $hoursVideos,
                'views' => $hoursViews,
            ],
            'tags_video' => $tagsVideo,
            'tags_views' => $tagsViews,
        ];
    }

    /**
     * @param  list<string>  $keywords
     * @return list<string>
     */
    private function detectKeywords(string $title, array $keywords): array
    {
        if (trim($title) === '') {
            return [];
        }

        $counts = [];
        $lengths = [];

        foreach ($keywords as $keyword) {
            $count = substr_count($title, $keyword);

            if ($count > 0) {
                $counts[$keyword] = $count;
                $lengths[$keyword] = mb_strlen($keyword, 'UTF-8');
            }
        }

        arsort($lengths);
        $ordered = array_keys($lengths);

        for ($i = 0; $i < count($ordered); $i++) {
            for ($j = $i + 1; $j < count($ordered); $j++) {
                $longer = $ordered[$i];
                $shorter = $ordered[$j];

                if (str_contains($longer, $shorter)) {
                    $counts[$shorter] = ($counts[$shorter] ?? 0) - ($counts[$longer] ?? 0);
                }
            }
        }

        return collect($counts)
            ->filter(fn (int $count): bool => $count > 0)
            ->sortDesc()
            ->keys()
            ->all();
    }

    /**
     * @return list<string>
     */
    private function keywords(int $limit): array
    {
        $stopwords = $this->stopwords->lookup();

        return DB::table('tags')
            ->select(['tag'])
            ->where(function (Builder $query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', '<', 1);
            })
            ->orderByDesc('hours_count')
            ->limit(max(1000, $limit * 2))
            ->pluck('tag')
            ->map(fn (mixed $tag): string => trim((string) $tag))
            ->filter(fn (string $tag): bool => $this->eligibleKeyword($tag) && ! isset($stopwords[$tag]))
            ->unique()
            ->take($limit)
            ->values()
            ->all();
    }

    private function eligibleKeyword(string $keyword): bool
    {
        if ($keyword === '' || mb_strlen($keyword, 'UTF-8') <= 1 || is_numeric($keyword)) {
            return false;
        }

        return preg_match('/^[A-Za-z]+$/', $keyword) !== 1 || strlen($keyword) >= 3;
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @return list<int>
     */
    private function channelIds(array $tagIds, array $orTagIds, array $notTagIds): array
    {
        if ($tagIds === [] && $orTagIds === [] && $notTagIds === []) {
            return [];
        }

        $query = DB::table('urt_count')->select('u_id');

        foreach ($tagIds as $tagId) {
            $query->where('tags', 'like', '%['.$tagId.']%');
        }

        if ($orTagIds !== []) {
            $query->where(function (Builder $query) use ($orTagIds): void {
                foreach ($orTagIds as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($notTagIds as $tagId) {
            $query->where('tags', 'not like', '%['.$tagId.']%');
        }

        return $query->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     */
    private function cacheQuery(array $tagIds, array $orTagIds, array $notTagIds, string $date): Builder
    {
        return DB::table('urt_show_live_tag_date')
            ->where('tagid', implode(',', $tagIds))
            ->where('tag_or', implode(',', $orTagIds))
            ->where('tag_not', implode(',', $notTagIds))
            ->where('the_date', $date);
    }

    /**
     * @param  array<string, mixed>  $computed
     * @return array<string, mixed>
     */
    private function cachePayload(array $computed, string $generatedAt): array
    {
        return [
            'mtime' => $generatedAt,
            'stime' => $generatedAt,
            'count_channels' => $computed['count_channels'],
            'count_videos' => $computed['count_videos'],
            'count_tags' => $computed['count_tags'],
            'tags_count' => $computed['tags_count'],
            'total_views' => $computed['total_views'],
            'hour_result' => $this->json($computed['hour_result']),
            'videos_result' => $this->json($computed['videos_result']),
            'all_result' => $this->json($computed['all_result']),
            'tags_video' => $this->json($computed['tags_video']),
            'tags_views' => $this->json($computed['tags_views']),
        ];
    }

    /**
     * @param  array<string, mixed>  $computed
     */
    private function sameCache(object $existing, array $computed): bool
    {
        $payload = $this->cachePayload($computed, 'ignored');

        foreach (['count_channels', 'count_videos', 'count_tags', 'tags_count', 'total_views'] as $column) {
            if ((int) ($existing->{$column} ?? 0) !== (int) $payload[$column]) {
                return false;
            }
        }

        foreach (['hour_result', 'videos_result', 'all_result', 'tags_video', 'tags_views'] as $column) {
            if ($this->decodedJson($existing->{$column} ?? null) !== $this->decodedJson($payload[$column])) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  list<int>  $tagIds
     * @param  list<int>  $orTagIds
     * @param  list<int>  $notTagIds
     * @param  array{from: string, to: string, dates: list<string>}  $range
     * @return array<string, mixed>
     */
    private function blockedPayload(
        array $range,
        array $tagIds,
        array $orTagIds,
        array $notTagIds,
        int $videoLimit,
        int $keywordLimit,
        bool $execute,
        string $reason,
        CarbonImmutable $now,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => false,
            'blocked_reason' => $reason,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'from' => $range['from'],
            'to' => $range['to'],
            'dates' => count($range['dates']),
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'keyword_limit' => $keywordLimit,
            'video_limit' => $videoLimit,
            'keywords_scanned' => 0,
            'channels_matched' => 0,
            'videos_scanned' => 0,
            'invalid_log_rows' => 0,
            'would_insert' => 0,
            'would_update' => 0,
            'inserted' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'failed_dates' => 0,
            'writes' => 0,
            'write_targets' => ['urt_show_live_tag_date'],
            'rows' => [],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => false,
                'ttl_seconds' => 1800,
            ],
        ];
    }

    private function schemaBlocker(): ?string
    {
        foreach (['urt_video_live_log', 'urt_video', 'urt_count', 'tags', 'urt_show_live_tag_date'] as $table) {
            if (! Schema::hasTable($table)) {
                return 'missing_table:'.$table;
            }
        }

        return null;
    }

    /**
     * @return array{from: string, to: string, dates: list<string>}
     */
    private function dateRange(string $from, string $to, string $timezone): array
    {
        if (! $this->validDate($from) || ! $this->validDate($to)) {
            throw new \InvalidArgumentException('invalid_date_range');
        }

        $start = CarbonImmutable::parse($from.' 00:00:00', $timezone);
        $end = CarbonImmutable::parse($to.' 00:00:00', $timezone);

        if ($start->greaterThan($end) || $start->diffInDays($end) > 30) {
            throw new \InvalidArgumentException('date_range_out_of_bounds');
        }

        $dates = [];

        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $dates[] = $date->toDateString();
        }

        return [
            'from' => $start->toDateString(),
            'to' => $end->toDateString(),
            'dates' => $dates,
        ];
    }

    private function validDate(string $date): bool
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

        return $parsed !== false && $parsed->format('Y-m-d') === $date;
    }

    /**
     * @param  list<int>  $ids
     * @return list<int>
     */
    private function normalizedIds(array $ids): array
    {
        return collect($ids)
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    private function json(array $value): string
    {
        return (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @return array<string, mixed>
     */
    private function decodedJson(mixed $value): array
    {
        if (! is_string($value)) {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }
}
