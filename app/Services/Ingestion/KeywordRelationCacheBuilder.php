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

class KeywordRelationCacheBuilder
{
    private const LOCK_KEY = 'ingestion:reports.keyword_relations.build';

    /**
     * @param  list<string>  $onlyKeywords
     * @return array<string, mixed>
     */
    public function build(
        ?string $from = null,
        ?string $to = null,
        array $onlyKeywords = [],
        int $keywordLimit = 100,
        int $videoLimit = 1000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $keywordLimit = max(1, min(5000, $keywordLimit));
        $videoLimit = max(1, min(10000, $videoLimit));
        $range = $this->range($from, $to, $now);

        if ($range['blocked_reason'] !== null) {
            return $this->logged($this->emptyPayload($now, $execute, $range, $keywordLimit, $videoLimit, $range['blocked_reason']));
        }

        $schemaBlock = $this->schemaBlock();

        if ($schemaBlock !== null) {
            return $this->logged($this->emptyPayload($now, $execute, $range, $keywordLimit, $videoLimit, $schemaBlock));
        }

        $lock = null;

        if ($execute) {
            $lock = Cache::lock(self::LOCK_KEY, 1800);

            if (! $lock->get()) {
                return $this->logged($this->emptyPayload($now, true, $range, $keywordLimit, $videoLimit, 'lock_busy', available: true));
            }
        }

        try {
            return $this->logged($this->process($now, $range, $onlyKeywords, $keywordLimit, $videoLimit, $execute));
        } finally {
            $this->release($lock);
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
            'keywords_selected' => $payload['keywords_selected'] ?? 0,
            'videos_scanned' => $payload['videos_scanned'] ?? 0,
            'writes' => $payload['writes'] ?? 0,
            'failed_video_rows' => $payload['failed_video_rows'] ?? 0,
            'failed_cache_rows' => $payload['failed_cache_rows'] ?? 0,
            'blocked_reason' => $payload['blocked_reason'] ?? null,
        ];

        if (($payload['blocked_reason'] ?? null) !== null
            || (int) ($payload['failed_video_rows'] ?? 0) > 0
            || (int) ($payload['failed_cache_rows'] ?? 0) > 0) {
            Log::warning('Keyword relation cache build completed with gaps.', $context);
        } else {
            Log::info('Keyword relation cache build completed.', $context);
        }

        return $payload;
    }

    /**
     * @param  array{from: string, to: string, dates: list<string>, explicit: bool, blocked_reason: string|null}  $range
     * @param  list<string>  $onlyKeywords
     * @return array<string, mixed>
     */
    private function process(
        CarbonImmutable $now,
        array $range,
        array $onlyKeywords,
        int $keywordLimit,
        int $videoLimit,
        bool $execute,
    ): array {
        try {
            [$keywords, $subjects] = $this->keywords($onlyKeywords, $keywordLimit);
            $videos = DB::table('urt_video')
                ->select(['videoId', 'u_id', 'publishedAt', 'title', 'description'])
                ->whereBetween('publishedAt', [$range['from'].' 00:00:00', $range['to'].' 23:59:59'])
                ->orderByDesc('publishedAt')
                ->orderBy('videoId')
                ->limit($videoLimit)
                ->get();
        } catch (Throwable) {
            return $this->emptyPayload($now, $execute, $range, $keywordLimit, $videoLimit, 'source_query_failed');
        }

        $preparedByDate = [];
        $failedVideoRows = 0;

        foreach ($videos as $video) {
            try {
                $date = substr((string) ($video->publishedAt ?? ''), 0, 10);
                $videoId = trim((string) ($video->videoId ?? ''));

                if (! in_array($date, $range['dates'], true) || $videoId === '') {
                    $failedVideoRows++;

                    continue;
                }

                $preparedByDate[$date][] = [
                    'video_id' => $videoId,
                    'u_id' => (int) ($video->u_id ?? 0),
                    'keywords' => $this->detectKeywords($video, $keywords),
                ];
            } catch (Throwable) {
                $failedVideoRows++;
            }
        }

        $rows = [];
        $wouldInsert = 0;
        $wouldUpdate = 0;
        $inserted = 0;
        $updated = 0;
        $unchanged = 0;
        $failedCacheRows = 0;
        $generatedAt = $now->format('Y-m-d H:i:s');

        foreach ($range['dates'] as $date) {
            foreach ($subjects as $subject) {
                try {
                    $computed = $this->relation($subject, $preparedByDate[$date] ?? []);
                    $existing = DB::table('urt_show_video_tag_date')
                        ->where('tag', $subject)
                        ->where('the_date', $date)
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
                        $payload = $computed + ['mtime' => $generatedAt];

                        if ($existing === null) {
                            DB::table('urt_show_video_tag_date')->insert($payload + [
                                'ctime' => $generatedAt,
                                'the_date' => $date,
                                'tag' => $subject,
                            ]);
                            $inserted++;
                            $status = 'inserted';
                        } else {
                            DB::table('urt_show_video_tag_date')
                                ->where('pk', $existing->pk)
                                ->update($payload);
                            $updated++;
                            $status = 'updated';
                        }
                    }

                    $rows[] = [
                        'tag' => $subject,
                        'date' => $date,
                        'status' => $status,
                        'reason' => null,
                        'count_channels' => $computed['count_channels'],
                        'count_videos' => $computed['count_videos'],
                        'count_tags' => $computed['count_tags'],
                    ];
                } catch (Throwable) {
                    $failedCacheRows++;
                    $rows[] = [
                        'tag' => $subject,
                        'date' => $date,
                        'status' => 'failed',
                        'reason' => 'cache_row_processing_failed',
                        'count_channels' => 0,
                        'count_videos' => 0,
                        'count_tags' => 0,
                    ];
                }
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
            'range_explicit' => $range['explicit'],
            'keyword_limit' => $keywordLimit,
            'video_limit' => $videoLimit,
            'keywords_scanned' => count($keywords),
            'keywords_selected' => count($subjects),
            'selected_keywords' => $subjects,
            'videos_scanned' => $videos->count(),
            'failed_video_rows' => $failedVideoRows,
            'rows_planned' => count($range['dates']) * count($subjects),
            'would_insert' => $wouldInsert,
            'would_update' => $wouldUpdate,
            'inserted' => $inserted,
            'updated' => $updated,
            'unchanged' => $unchanged,
            'failed_cache_rows' => $failedCacheRows,
            'rows' => $rows,
            'writes' => $execute ? $inserted + $updated : 0,
            'write_targets' => ['urt_show_video_tag_date'],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => $execute,
                'ttl_seconds' => 1800,
            ],
        ];
    }

    /**
     * @param  list<string>  $onlyKeywords
     * @return array{0: list<string>, 1: list<string>}
     */
    private function keywords(array $onlyKeywords, int $limit): array
    {
        $subjects = collect($onlyKeywords)
            ->map(fn (mixed $keyword): string => trim((string) $keyword))
            ->filter(fn (string $keyword): bool => $this->eligibleKeyword($keyword))
            ->unique()
            ->take($limit)
            ->values()
            ->all();

        $query = DB::table('tags')->select('tag');

        if (Schema::hasColumn('tags', 'no_tag')) {
            $query->where(function (Builder $query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', '<', 1);
            });
        }

        if (Schema::hasColumn('tags', 'hours_count')) {
            $query->orderByDesc('hours_count');
        } else {
            $query->orderBy('tag');
        }

        $fromTable = $query
            ->limit(max(1000, $limit * 2))
            ->pluck('tag')
            ->map(fn (mixed $keyword): string => trim((string) $keyword))
            ->filter(fn (string $keyword): bool => $this->eligibleKeyword($keyword))
            ->unique()
            ->values()
            ->all();
        $keywords = collect([...$subjects, ...$fromTable])
            ->unique()
            ->take($limit)
            ->values()
            ->all();

        if ($subjects === []) {
            $subjects = $keywords;
        }

        return [$keywords, $subjects];
    }

    /**
     * @param  list<string>  $keywords
     * @return array<string, int>
     */
    private function detectKeywords(object $video, array $keywords): array
    {
        $text = ' '.(string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');
        $counts = [];
        $lengths = [];

        foreach ($keywords as $keyword) {
            $count = substr_count($text, $keyword);

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

                if (isset($counts[$shorter]) && str_contains($longer, $shorter)) {
                    $counts[$shorter] -= $counts[$longer] ?? 0;
                }
            }
        }

        return collect($counts)
            ->filter(fn (int $count): bool => $count > 0)
            ->sortDesc()
            ->all();
    }

    /**
     * @param  list<array{video_id: string, u_id: int, keywords: array<string, int>}>  $videos
     * @return array{count_channels: int, count_videos: int, count_tags: int, videos_json: string, tags_json: string}
     */
    private function relation(string $subject, array $videos): array
    {
        $videosById = [];
        $channels = [];
        $tagVideos = [];

        foreach ($videos as $video) {
            if (($video['keywords'][$subject] ?? 0) <= 0) {
                continue;
            }

            $videosById[$video['video_id']] = $video['u_id'];

            if ($video['u_id'] > 0) {
                $channels[$video['u_id']] = true;
            }

            foreach (array_keys($video['keywords']) as $keyword) {
                $tagVideos[$keyword] = ($tagVideos[$keyword] ?? 0) + 1;
            }
        }

        ksort($videosById);
        uksort($tagVideos, function (string $left, string $right) use ($tagVideos): int {
            return $tagVideos[$right] <=> $tagVideos[$left] ?: strcmp($left, $right);
        });

        return [
            'count_channels' => count($channels),
            'count_videos' => count($videosById),
            'count_tags' => count($tagVideos),
            'videos_json' => json_encode($videosById, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'tags_json' => json_encode($tagVideos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }

    /**
     * @param  array{count_channels: int, count_videos: int, count_tags: int, videos_json: string, tags_json: string}  $computed
     */
    private function sameCache(object $existing, array $computed): bool
    {
        return (int) ($existing->count_channels ?? 0) === $computed['count_channels']
            && (int) ($existing->count_videos ?? 0) === $computed['count_videos']
            && (int) ($existing->count_tags ?? 0) === $computed['count_tags']
            && $this->decodedMap($existing->videos_json ?? null) === $this->decodedMap($computed['videos_json'])
            && $this->decodedMap($existing->tags_json ?? null) === $this->decodedMap($computed['tags_json']);
    }

    /**
     * @return array<string, int>
     */
    private function decodedMap(mixed $json): array
    {
        if (! is_string($json)) {
            return [];
        }

        $decoded = json_decode($json, true);

        if (! is_array($decoded) || array_is_list($decoded)) {
            return [];
        }

        ksort($decoded);

        return collect($decoded)
            ->map(fn (mixed $value): int => (int) $value)
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
     * @return array{from: string, to: string, dates: list<string>, explicit: bool, blocked_reason: string|null}
     */
    private function range(?string $from, ?string $to, CarbonImmutable $now): array
    {
        $explicit = trim((string) $from) !== '' || trim((string) $to) !== '';
        $fallback = $now->subDay()->toDateString();
        $from = trim((string) $from) ?: $fallback;
        $to = trim((string) $to) ?: $from;

        if (! $this->validDate($from) || ! $this->validDate($to)) {
            return ['from' => $from, 'to' => $to, 'dates' => [], 'explicit' => $explicit, 'blocked_reason' => 'invalid_date_range'];
        }

        if ($from > $to) {
            return ['from' => $from, 'to' => $to, 'dates' => [], 'explicit' => $explicit, 'blocked_reason' => 'date_range_reversed'];
        }

        $start = CarbonImmutable::parse($from, 'Asia/Taipei');
        $end = CarbonImmutable::parse($to, 'Asia/Taipei');
        $days = $start->diffInDays($end) + 1;

        if ($days > 31) {
            return ['from' => $from, 'to' => $to, 'dates' => [], 'explicit' => $explicit, 'blocked_reason' => 'date_range_exceeds_31_days'];
        }

        $dates = [];

        for ($date = $start; $date->lessThanOrEqualTo($end); $date = $date->addDay()) {
            $dates[] = $date->toDateString();
        }

        return ['from' => $from, 'to' => $to, 'dates' => $dates, 'explicit' => $explicit, 'blocked_reason' => null];
    }

    private function validDate(string $date): bool
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            return false;
        }

        try {
            return CarbonImmutable::parse($date, 'Asia/Taipei')->toDateString() === $date;
        } catch (Throwable) {
            return false;
        }
    }

    private function schemaBlock(): ?string
    {
        foreach (['urt_video', 'tags', 'urt_show_video_tag_date'] as $table) {
            if (! Schema::hasTable($table)) {
                return 'missing_table:'.$table;
            }
        }

        $columns = [
            'urt_video' => ['videoId', 'u_id', 'publishedAt', 'title', 'description'],
            'tags' => ['tag'],
            'urt_show_video_tag_date' => ['pk', 'ctime', 'mtime', 'the_date', 'tag', 'count_videos', 'count_tags', 'count_channels', 'videos_json', 'tags_json'],
        ];

        foreach ($columns as $table => $required) {
            if (! Schema::hasColumns($table, $required)) {
                return 'missing_columns:'.$table;
            }
        }

        return null;
    }

    /**
     * @param  array{from: string, to: string, dates: list<string>, explicit: bool, blocked_reason: string|null}  $range
     * @return array<string, mixed>
     */
    private function emptyPayload(
        CarbonImmutable $now,
        bool $execute,
        array $range,
        int $keywordLimit,
        int $videoLimit,
        string $reason,
        bool $available = false,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'available' => $available,
            'blocked_reason' => $reason,
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'from' => $range['from'],
            'to' => $range['to'],
            'dates' => count($range['dates']),
            'range_explicit' => $range['explicit'],
            'keyword_limit' => $keywordLimit,
            'video_limit' => $videoLimit,
            'keywords_scanned' => 0,
            'keywords_selected' => 0,
            'selected_keywords' => [],
            'videos_scanned' => 0,
            'failed_video_rows' => 0,
            'rows_planned' => 0,
            'would_insert' => 0,
            'would_update' => 0,
            'inserted' => 0,
            'updated' => 0,
            'unchanged' => 0,
            'failed_cache_rows' => 0,
            'rows' => [],
            'writes' => 0,
            'write_targets' => ['urt_show_video_tag_date'],
            'lock' => [
                'key' => self::LOCK_KEY,
                'acquired' => false,
                'ttl_seconds' => 1800,
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
            // Expired locks are safe to ignore after the command has finished.
        }
    }
}
