<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ChannelCloudCacheBuilder
{
    /**
     * @var array<string, list<array{tag: string, divisor: float}>>
     */
    private array $keywordCache = [];

    /**
     * @return array<string, mixed>
     */
    public function buildMany(
        array $uIds,
        array $daysList,
        int $limit = 50,
        int $recentDays = 14,
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $limit = max(1, min(500, $limit));
        $recentDays = max(1, min(365, $recentDays));
        $uIds = $this->normalizedIds($uIds);
        $daysList = $this->normalizedDays($daysList);
        $channelIds = $uIds !== [] ? $uIds : $this->recentChannelIds($limit, $recentDays, $now);
        $rows = [];
        $writes = 0;

        foreach ($channelIds as $uId) {
            foreach ($daysList as $days) {
                $result = $this->build(
                    uId: $uId,
                    days: $days,
                    keywordLimit: $keywordLimit,
                    onlyKeywords: $onlyKeywords,
                    execute: $execute,
                    now: $now,
                );
                $writes += (int) $result['writes'];
                $rows[] = $result;
            }
        }

        return [
            'mode' => $execute ? 'execute' : 'dry-run',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'explicit_channels' => $uIds,
            'channels_selected' => count($channelIds),
            'channel_ids' => $channelIds,
            'days_list' => $daysList,
            'limit' => $limit,
            'recent_days' => $recentDays,
            'keyword_limit' => max(1, min(20000, $keywordLimit)),
            'only_keywords' => $this->normalizedKeywords($onlyKeywords),
            'rows' => $rows,
            'writes' => $writes,
            'write_targets' => ['urt_show_cloud'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function build(
        int $uId,
        int $days,
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $uId = max(1, $uId);
        $days = max(1, min(365, $days));
        $keywordLimit = max(1, min(20000, $keywordLimit));
        $onlyKeywords = $this->normalizedKeywords($onlyKeywords);
        $keywords = $this->keywords($keywordLimit, $now, $onlyKeywords);
        $videos = $this->videos($uId, $now, $days);
        $metrics = $this->metrics($keywords, $videos);
        $generatedAt = $now->format('Y-m-d H:i:s');

        if ($execute) {
            $this->upsertCache($uId, $days, $metrics, $generatedAt);
        }

        return [
            'mode' => $execute ? 'execute' : 'dry-run',
            'generated_at' => $generatedAt,
            'u_id' => $uId,
            'days' => $days,
            'keyword_limit' => $keywordLimit,
            'only_keywords' => $onlyKeywords,
            'keywords_selected' => count($keywords),
            'videos_scanned' => count($videos),
            'keywords_count' => count($metrics['keywords_json']),
            'count_tags' => $metrics['count_tags'],
            'count_videos' => $metrics['count_videos'],
            'total_views' => $metrics['total_views'],
            'writes' => $execute ? 1 : 0,
            'write_targets' => ['urt_show_cloud'],
        ];
    }

    /**
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

    /**
     * @return list<int>
     */
    private function normalizedDays(array $daysList): array
    {
        $days = collect($daysList)
            ->map(fn (mixed $days): int => max(1, min(365, (int) $days)))
            ->filter(fn (int $days): bool => $days > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();

        return $days === [] ? [1, 3, 7, 30, 90] : $days;
    }

    /**
     * @return list<string>
     */
    private function normalizedKeywords(array $keywords): array
    {
        return collect($keywords)
            ->map(fn (mixed $keyword): string => trim((string) $keyword))
            ->filter(fn (string $keyword): bool => $keyword !== '')
            ->unique()
            ->values()
            ->all();
    }

    /**
     * @return list<int>
     */
    private function recentChannelIds(int $limit, int $recentDays, CarbonImmutable $now): array
    {
        $from = $now->subDays($recentDays)->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        return DB::table('urt_video')
            ->select('u_id')
            ->selectRaw('MAX(publishedAt) as latest_published_at')
            ->whereNotNull('u_id')
            ->where('u_id', '>', 0)
            ->whereBetween('publishedAt', [$from, $to])
            ->groupBy('u_id')
            ->orderByDesc('latest_published_at')
            ->limit($limit)
            ->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->values()
            ->all();
    }

    /**
     * @return list<array{tag: string, divisor: float}>
     */
    private function keywords(int $limit, CarbonImmutable $now, array $onlyKeywords = []): array
    {
        $cacheKey = $limit.'|'.$now->toDateString().'|'.implode("\n", $onlyKeywords);

        if (isset($this->keywordCache[$cacheKey])) {
            return $this->keywordCache[$cacheKey];
        }

        $query = DB::table('tags')
            ->select(['tag', 'max_count', 'hours_count', 'max_hours'])
            ->where(function (Builder $query): void {
                $query->whereNull('no_tag')->orWhere('no_tag', '<', 1);
            });

        if ($onlyKeywords !== []) {
            $query->whereIn('tag', $onlyKeywords);
        }

        $keywords = $query
            ->orderByDesc('hours_count')
            ->limit(max($limit * 2, 1000))
            ->get()
            ->map(function (object $row) use ($now): array {
                $tag = (string) $row->tag;
                $maxCount = max(0, (int) ($row->max_count ?? 0));
                $hoursCount = max(0, (int) ($row->hours_count ?? 0));
                $maxHours = (string) ($row->max_hours ?? $now->format('Y-m-d H:i:s'));
                $periodDays = max(1 / 24, $now->diffInSeconds($maxHours, true) / 86400);
                $weight = $hoursCount > 1 && $maxCount > 1
                    ? log($hoursCount) / $periodDays * log($maxCount) * 100
                    : 0.0;

                return [
                    'tag' => $tag,
                    'weight' => max(0.0, $weight),
                    'divisor' => max(0.5, (float) $maxCount + 0.5),
                ];
            })
            ->filter(fn (array $row): bool => $this->eligibleKeyword($row['tag']))
            ->sortByDesc('weight')
            ->take($limit)
            ->map(fn (array $row): array => ['tag' => $row['tag'], 'divisor' => $row['divisor']])
            ->values()
            ->all();

        if ($onlyKeywords !== []) {
            $selected = array_fill_keys(array_column($keywords, 'tag'), true);

            foreach ($onlyKeywords as $keyword) {
                if (! isset($selected[$keyword]) && $this->eligibleKeyword($keyword)) {
                    $keywords[] = ['tag' => $keyword, 'divisor' => 1.0];
                    $selected[$keyword] = true;
                }
            }
        }

        return $this->keywordCache[$cacheKey] = $keywords;
    }

    private function eligibleKeyword(string $tag): bool
    {
        if ($tag === '' || mb_strlen($tag, 'UTF-8') <= 1 || is_numeric($tag)) {
            return false;
        }

        return preg_match('/^[A-Za-z]+$/', $tag) !== 1 || strlen($tag) >= 3;
    }

    /**
     * @return list<object>
     */
    private function videos(int $uId, CarbonImmutable $now, int $days): array
    {
        $from = $now->subDays($days)->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        return DB::table('urt_video')
            ->select(['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'description', 'viewCount'])
            ->where('u_id', $uId)
            ->whereBetween('publishedAt', [$from, $to])
            ->orderBy('publishedAt')
            ->get()
            ->all();
    }

    /**
     * @param list<array{tag: string, divisor: float}> $keywords
     * @param list<object> $videos
     * @return array{keywords_json: array<string, string>, count_tags: int, count_videos: int, total_views: int}
     */
    private function metrics(array $keywords, array $videos): array
    {
        $keywordTags = array_column($keywords, 'tag');
        $keywordDivisors = collect($keywords)->mapWithKeys(fn (array $row): array => [$row['tag'] => $row['divisor']])->all();
        $keywordLengths = [];

        foreach ($keywordTags as $tag) {
            $keywordLengths[$tag] = mb_strlen($tag, 'UTF-8');
        }

        arsort($keywordLengths);
        $orderedKeywords = array_keys($keywordLengths);
        $rawCounts = [];
        $countTags = 0;
        $totalViews = 0;

        foreach ($videos as $video) {
            $text = (string) ($video->title ?? '').' '.(string) ($video->title ?? '').' '.(string) ($video->description ?? '');
            $views = max(0, (int) ($video->viewCount ?? 0));
            $totalViews += $views;
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

            foreach ($counts as $tag => $count) {
                if ($count <= 0) {
                    continue;
                }

                $countTags += $count;
                $rawCounts[$tag] = ($rawCounts[$tag] ?? 0) + $count;
            }
        }

        $keywordsJson = [];

        foreach ($rawCounts as $tag => $count) {
            $lengthWeight = log(mb_strlen($tag, 'UTF-8') + 0.5) - 0.5;
            $score = $count * $lengthWeight / (float) ($keywordDivisors[$tag] ?? 0.5);

            if ($score > 0) {
                $keywordsJson[$tag] = sprintf('%.3f', $score);
            }
        }

        arsort($keywordsJson);

        return [
            'keywords_json' => $keywordsJson,
            'count_tags' => $countTags,
            'count_videos' => count($videos),
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param array{keywords_json: array<string, string>, count_tags: int, count_videos: int, total_views: int} $metrics
     */
    private function upsertCache(int $uId, int $days, array $metrics, string $generatedAt): void
    {
        DB::transaction(function () use ($uId, $days, $metrics, $generatedAt): void {
            $payload = $this->tablePayload([
                'mtime' => $generatedAt,
                'keywords_json' => json_encode($metrics['keywords_json'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'count_videos' => $metrics['count_videos'],
                'count_tags' => $metrics['count_tags'],
                'tags_count' => count($metrics['keywords_json']),
                'total_views' => $metrics['total_views'],
            ]);

            $query = DB::table('urt_show_cloud')
                ->where('u_id', $uId)
                ->where('days', $days);

            if ((clone $query)->first() !== null) {
                $query->update($payload);

                return;
            }

            $payload = array_merge($payload, $this->tablePayload([
                'ctime' => $generatedAt,
                'u_id' => $uId,
                'days' => $days,
            ]));

            DB::table('urt_show_cloud')->insert($payload);
        });
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function tablePayload(array $payload): array
    {
        return collect($payload)
            ->filter(fn (mixed $value, string $column): bool => Schema::hasColumn('urt_show_cloud', $column))
            ->all();
    }
}
