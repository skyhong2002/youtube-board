<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class TagCloudCacheBuilder
{
    /**
     * @var array<string, list<array{tag: string, divisor: float}>>
     */
    private array $keywordCache = [];

    /**
     * @return array<string, mixed>
     */
    public function build(
        array $tagIds,
        int $days,
        array $orTagIds = [],
        array $notTagIds = [],
        int $keywordLimit = 5000,
        array $onlyKeywords = [],
        bool $execute = false,
        ?CarbonImmutable $now = null,
    ): array {
        $now ??= CarbonImmutable::now('Asia/Taipei');
        $days = max(1, min(365, $days));
        $keywordLimit = max(1, min(20000, $keywordLimit));
        $tagIds = $this->normalizedIds($tagIds);
        $orTagIds = $this->normalizedIds($orTagIds);
        $notTagIds = $this->normalizedIds($notTagIds);

        $onlyKeywords = collect($onlyKeywords)
            ->map(fn (mixed $keyword): string => trim((string) $keyword))
            ->filter(fn (string $keyword): bool => $keyword !== '')
            ->unique()
            ->values()
            ->all();
        $keywords = $this->keywords($keywordLimit, $now, $onlyKeywords);
        $channelIds = $this->channelIds($tagIds, $orTagIds, $notTagIds);
        $videos = $this->videos($channelIds, $now, $days);
        $metrics = $this->metrics($keywords, $videos);
        $generatedAt = $now->format('Y-m-d H:i:s');

        if ($execute) {
            $this->upsertCache($tagIds, $orTagIds, $notTagIds, $days, $metrics, count($channelIds), $generatedAt);
        }

        return [
            'mode' => $execute ? 'execute' : 'dry-run',
            'generated_at' => $generatedAt,
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'days' => $days,
            'keyword_limit' => $keywordLimit,
            'only_keywords' => $onlyKeywords,
            'keywords_selected' => count($keywords),
            'channels_matched' => count($channelIds),
            'videos_scanned' => count($videos),
            'tags_count' => count($metrics['tags_result']),
            'count_tags' => $metrics['count_tags'],
            'count_videos' => $metrics['count_videos'],
            'total_views' => $metrics['total_views'],
            'writes' => $execute ? 1 : 0,
            'write_targets' => ['urt_show_tag_cloud'],
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
     * @return list<int>
     */
    private function channelIds(array $tagIds, array $orTagIds, array $notTagIds): array
    {
        $query = DB::table('urt_count')->select('u_id');

        if ($orTagIds !== []) {
            $query->where(function (Builder $query) use ($orTagIds): void {
                foreach ($orTagIds as $tagId) {
                    $query->orWhere('tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($tagIds as $tagId) {
            $query->where('tags', 'like', '%['.$tagId.']%');
        }

        if ($notTagIds !== []) {
            $query->where(function (Builder $query) use ($notTagIds): void {
                foreach ($notTagIds as $tagId) {
                    $query->where('tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        return $query->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->values()
            ->all();
    }

    /**
     * @return list<object>
     */
    private function videos(array $channelIds, CarbonImmutable $now, int $days): array
    {
        if ($channelIds === []) {
            return [];
        }

        $from = $now->subDays($days)->format('Y-m-d H:i:s');
        $to = $now->format('Y-m-d H:i:s');

        return DB::table('urt_video')
            ->select(['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'description', 'viewCount'])
            ->whereIn('u_id', $channelIds)
            ->whereBetween('publishedAt', [$from, $to])
            ->orderBy('publishedAt')
            ->get()
            ->all();
    }

    /**
     * @param list<array{tag: string, divisor: float}> $keywords
     * @param list<object> $videos
     * @return array{tags_result: array<string, string>, count_tags: int, count_videos: int, total_views: int}
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

        $tagsResult = [];

        foreach ($rawCounts as $tag => $count) {
            $lengthWeight = log(mb_strlen($tag, 'UTF-8') + 0.5) - 0.5;
            $score = $count * $lengthWeight / (float) ($keywordDivisors[$tag] ?? 0.5);

            if ($score > 0) {
                $tagsResult[$tag] = sprintf('%.3f', $score);
            }
        }

        arsort($tagsResult);

        return [
            'tags_result' => $tagsResult,
            'count_tags' => $countTags,
            'count_videos' => count($videos),
            'total_views' => $totalViews,
        ];
    }

    /**
     * @param list<int> $tagIds
     * @param list<int> $orTagIds
     * @param list<int> $notTagIds
     * @param array{tags_result: array<string, string>, count_tags: int, count_videos: int, total_views: int} $metrics
     */
    private function upsertCache(array $tagIds, array $orTagIds, array $notTagIds, int $days, array $metrics, int $countChannels, string $generatedAt): void
    {
        $tagIdString = implode(',', $tagIds);
        $tagOrString = $orTagIds === [] ? null : implode(',', $orTagIds);
        $tagNotString = $notTagIds === [] ? null : implode(',', $notTagIds);

        DB::transaction(function () use ($tagIdString, $tagOrString, $tagNotString, $days, $metrics, $countChannels, $generatedAt): void {
            $payload = [
                'mtime' => $generatedAt,
                'count_channels' => $countChannels,
                'count_videos' => $metrics['count_videos'],
                'count_tags' => $metrics['count_tags'],
                'days' => $days,
                'tags_count' => count($metrics['tags_result']),
                'tags_result' => json_encode($metrics['tags_result'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ];

            $query = DB::table('urt_show_tag_cloud')
                ->where('days', $days)
                ->where('tagid', $tagIdString)
                ->where(function (Builder $query) use ($tagOrString): void {
                    $tagOrString === null
                        ? $query->whereNull('tag_or')->orWhere('tag_or', '')
                        : $query->where('tag_or', $tagOrString);
                })
                ->where(function (Builder $query) use ($tagNotString): void {
                    $tagNotString === null
                        ? $query->whereNull('tag_not')->orWhere('tag_not', '')
                        : $query->where('tag_not', $tagNotString);
                });

            $existing = (clone $query)->first();

            if ($existing !== null) {
                $query->update($payload);

                return;
            }

            if (Schema::hasColumn('urt_show_tag_cloud', 'ctime')) {
                $payload['ctime'] = $generatedAt;
            }

            $payload['tagid'] = $tagIdString;
            $payload['tag_or'] = $tagOrString;
            $payload['tag_not'] = $tagNotString;
            DB::table('urt_show_tag_cloud')->insert($payload);
        });
    }
}
