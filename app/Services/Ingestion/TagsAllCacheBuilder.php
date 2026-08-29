<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TagsAllCacheBuilder
{
    private const DEFAULT_CATEGORY_TAGS = [1, 2, 13, 14];

    /**
     * @return array<string, mixed>
     */
    public function build(
        int $days = 31,
        int $recentDays = 7,
        int $keywordLimit = 1000,
        int $videoLimit = 50000,
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $days = max(1, min(90, $days));
        $recentDays = max(1, min($days, $recentDays));
        $keywordLimit = max(1, min(10000, $keywordLimit));
        $videoLimit = max(1, min(200000, $videoLimit));
        $recentFrom = $now->subDays($recentDays)->startOfDay();
        $generatedAt = $now->format('Y-m-d H:i:s');
        $keywords = [];
        $videos = [];
        $metrics = [];

        try {
            $keywordSelection = $this->keywordRows($keywordLimit, $now);
            $keywords = $keywordSelection['rows'];

            $videoSelection = $this->videoRows($days, $videoLimit, $now);
            $videos = $videoSelection['rows'];

            if ($videoSelection['truncated']) {
                $payload = $this->payload(
                    now: $now,
                    recentFrom: $recentFrom,
                    days: $days,
                    keywordLimit: $keywordLimit,
                    videoLimit: $videoLimit,
                    keywords: $keywords,
                    videos: $videos,
                    metrics: [],
                    execute: $execute,
                    generatedAt: $generatedAt,
                    status: 'blocked',
                    blockedReason: 'video_scan_limit_exceeded',
                    sourceTruncated: true,
                );
                Log::warning('Keyword tags-all cache row blocked.', $this->logContext($payload));

                return $payload;
            }

            $metrics = $this->metrics($keywords, $videos, $recentFrom);

            if ($execute) {
                $this->writeCache($metrics, $generatedAt);
            }

            $payload = $this->payload(
                now: $now,
                recentFrom: $recentFrom,
                days: $days,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                keywords: $keywords,
                videos: $videos,
                metrics: $metrics,
                execute: $execute,
                generatedAt: $generatedAt,
                status: 'success',
                sourceTruncated: $keywordSelection['truncated'],
            );

            Log::info('Keyword tags-all cache row completed.', $this->logContext($payload));

            return $payload;
        } catch (Throwable $exception) {
            $payload = $this->payload(
                now: $now,
                recentFrom: $recentFrom,
                days: $days,
                keywordLimit: $keywordLimit,
                videoLimit: $videoLimit,
                keywords: $keywords,
                videos: $videos,
                metrics: $metrics,
                execute: $execute,
                generatedAt: $generatedAt,
                status: 'failed',
            );

            Log::warning('Keyword tags-all cache row failed.', $this->logContext($payload) + [
                'exception_class' => $exception::class,
            ]);

            return $payload;
        }
    }

    /**
     * @param  list<array{tag: string, weight: float}>  $keywords
     * @param  list<object>  $videos
     * @param  array<string, array{video: int, video_all: int, views: int, views_all: int}>  $metrics
     * @return array<string, mixed>
     */
    private function payload(
        CarbonImmutable $now,
        CarbonImmutable $recentFrom,
        int $days,
        int $keywordLimit,
        int $videoLimit,
        array $keywords,
        array $videos,
        array $metrics,
        bool $execute,
        string $generatedAt,
        string $status,
        ?string $blockedReason = null,
        bool $sourceTruncated = false,
    ): array {
        $failed = $status !== 'success';

        return [
            'mode' => $execute ? 'execute' : 'dry-run',
            'status' => $status,
            'blocked_reason' => $blockedReason,
            'source_complete' => ! $failed,
            'source_truncated' => $sourceTruncated,
            'generated_at' => $generatedAt,
            'date_from' => $now->subDays($days - 1)->startOfDay()->toDateString(),
            'date_to' => $now->endOfDay()->toDateString(),
            'recent_from' => $recentFrom->toDateString(),
            'category_tags' => self::DEFAULT_CATEGORY_TAGS,
            'keyword_limit' => $keywordLimit,
            'video_limit' => $videoLimit,
            'keywords_selected' => count($keywords),
            'videos_scanned' => count($videos),
            'tags_with_metrics' => count($metrics),
            'write_targets' => ['urt_show_data.data_name=tags_all columns=ctime,mtime,api,para,the_result'],
            'writes' => $execute && ! $failed ? 1 : 0,
            'failed_rows' => $failed ? 1 : 0,
            'failure_reason' => $status === 'failed' ? 'cache_row_processing_failed' : ($failed ? 'source_incomplete' : null),
            'exit_code' => $failed ? 1 : 0,
            'sample' => array_slice($metrics, 0, 10, true),
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function logContext(array $payload): array
    {
        return collect($payload)->only([
            'mode',
            'status',
            'date_from',
            'date_to',
            'keywords_selected',
            'videos_scanned',
            'tags_with_metrics',
            'writes',
            'failed_rows',
            'failure_reason',
            'blocked_reason',
            'source_truncated',
        ])->all();
    }

    /**
     * @return array{rows: list<array{tag: string, weight: float}>, truncated: bool}
     */
    private function keywordRows(int $limit, CarbonImmutable $now): array
    {
        $sourceRows = DB::table('tags')
            ->select(['tag', 'max_count', 'hours_count', 'max_hours'])
            ->where(function ($query): void {
                $query->whereNull('no_tag')
                    ->orWhere('no_tag', '<', 1);
            })
            ->orderByDesc('hours_count')
            ->limit($limit + 1)
            ->get();
        $truncated = $sourceRows->count() > $limit;
        $rows = $sourceRows
            ->take($limit)
            ->map(function (object $row) use ($now): array {
                $tag = (string) $row->tag;
                $maxCount = (int) ($row->max_count ?? 0);
                $hoursCount = (int) ($row->hours_count ?? 0);
                $maxHours = (string) ($row->max_hours ?? $now->format('Y-m-d H:i:s'));
                $periodDays = max(1 / 24, $now->diffInSeconds($maxHours, true) / 86400);
                $weight = $hoursCount > 1 && $maxCount > 1
                    ? log($hoursCount) / $periodDays * log($maxCount) * 100
                    : 0.0;

                return ['tag' => $tag, 'weight' => max(0.0, $weight)];
            })
            ->filter(fn (array $row): bool => $this->isEligibleKeyword($row['tag']))
            ->sortByDesc('weight')
            ->take($limit)
            ->values()
            ->all();

        return [
            'rows' => $rows,
            'truncated' => $truncated,
        ];
    }

    /**
     * @return array{rows: list<object>, truncated: bool}
     */
    private function videoRows(int $days, int $limit, CarbonImmutable $now): array
    {
        $from = $now->subDays($days - 1)->startOfDay()->format('Y-m-d H:i:s');
        $to = $now->endOfDay()->format('Y-m-d H:i:s');
        $uIds = DB::table('urt_count')
            ->select('u_id')
            ->where(function ($query): void {
                foreach (self::DEFAULT_CATEGORY_TAGS as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });

        $query = DB::table('urt_video')
            ->select(['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'description', 'viewCount'])
            ->whereIn('u_id', $uIds)
            ->whereBetween('publishedAt', [$from, $to])
            ->orderBy('publishedAt');

        $rows = $query->limit($limit + 1)->get()->all();

        return [
            'rows' => array_slice($rows, 0, $limit),
            'truncated' => count($rows) > $limit,
        ];
    }

    /**
     * @param  list<array{tag: string, weight: float}>  $keywords
     * @param  list<object>  $videos
     * @return array<string, array{video: int, video_all: int, views: int, views_all: int}>
     */
    private function metrics(array $keywords, array $videos, CarbonImmutable $recentFrom): array
    {
        $metrics = [];
        $keywordTags = array_column($keywords, 'tag');
        $keywordLengths = [];

        foreach ($keywordTags as $tag) {
            $keywordLengths[$tag] = mb_strlen($tag, 'UTF-8');
        }

        arsort($keywordLengths);
        $orderedKeywords = array_keys($keywordLengths);

        foreach ($videos as $video) {
            $text = trim((string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? ''));

            if ($text === '') {
                continue;
            }

            $counts = [];

            foreach ($keywordTags as $tag) {
                $count = substr_count($text, $tag);

                if ($count > 0) {
                    $counts[$tag] = $count;
                }
            }

            if ($counts === []) {
                continue;
            }

            for ($i = 0; $i < count($orderedKeywords); $i++) {
                $longer = $orderedKeywords[$i];

                if (! isset($counts[$longer])) {
                    continue;
                }

                for ($j = $i + 1; $j < count($orderedKeywords); $j++) {
                    $shorter = $orderedKeywords[$j];

                    if (isset($counts[$shorter]) && str_contains($longer, $shorter)) {
                        $counts[$shorter] -= $counts[$longer];
                    }
                }
            }

            $views = max(0, (int) ($video->viewCount ?? 0));
            $isRecent = CarbonImmutable::parse((string) $video->publishedAt, 'Asia/Taipei')->greaterThanOrEqualTo($recentFrom);

            foreach ($counts as $tag => $count) {
                if ($count <= 0) {
                    continue;
                }

                $metrics[$tag] ??= ['video' => 0, 'video_all' => 0, 'views' => 0, 'views_all' => 0];
                $metrics[$tag]['video_all']++;
                $metrics[$tag]['views_all'] += $views;

                if ($isRecent) {
                    $metrics[$tag]['video']++;
                    $metrics[$tag]['views'] += $views;
                }
            }
        }

        uasort($metrics, fn (array $left, array $right): int => $right['views'] <=> $left['views']);

        return $metrics;
    }

    /**
     * @param  array<string, array{video: int, video_all: int, views: int, views_all: int}>  $metrics
     */
    private function writeCache(array $metrics, string $generatedAt): void
    {
        DB::transaction(function () use ($metrics, $generatedAt): void {
            $payload = [
                'mtime' => $generatedAt,
                'the_result' => json_encode($metrics, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ];

            if (Schema::hasColumn('urt_show_data', 'api')) {
                $payload['api'] = 'api/tags_all.php';
            }

            if (Schema::hasColumn('urt_show_data', 'para')) {
                $payload['para'] = 'or=1,2,13,14';
            }

            $existing = DB::table('urt_show_data')->where('data_name', 'tags_all')->first();

            if ($existing) {
                DB::table('urt_show_data')->where('data_name', 'tags_all')->update($payload);

                return;
            }

            if (Schema::hasColumn('urt_show_data', 'ctime')) {
                $payload['ctime'] = $generatedAt;
            }

            $payload['data_name'] = 'tags_all';
            DB::table('urt_show_data')->insert($payload);
        });
    }

    private function isEligibleKeyword(string $tag): bool
    {
        if ($tag === '' || mb_strlen($tag, 'UTF-8') <= 1 || is_numeric($tag)) {
            return false;
        }

        return preg_match('/^[A-Za-z]+$/', $tag) !== 1 || strlen($tag) >= 3;
    }
}
