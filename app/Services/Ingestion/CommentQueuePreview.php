<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LegacyTagFilter;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CommentQueuePreview
{
    public function __construct(private readonly LegacyTagFilter $tagFilter)
    {
    }

    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?string $tagid = null,
        ?string $or = null,
        ?string $not = null,
        int $min = 500,
        int $hours = 24,
        int $limit = 50,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $min = max(0, min(10_000_000, $min));
        $hours = max(1, min(24 * 30, $hours));
        $limit = max(1, min(1000, $limit));
        $publishedAfter = $now->subHours($hours);

        $filters = [
            'or' => $this->tagFilter->integerList($or),
            'tagid' => $this->tagFilter->integerList($tagid),
            'not' => $this->tagFilter->integerList($not),
            'limit' => $limit,
        ];

        $matchingChannels = $this->matchingChannels($filters);
        $channelIds = $matchingChannels->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values();
        $recentVideoQuery = $this->recentVideoQuery($channelIds->all(), $publishedAfter, $min);
        $recentVideoRows = (clone $recentVideoQuery)->count();
        $commentThresholdRows = (clone $recentVideoQuery)
            ->where('commentCount', '>=', $min)
            ->count();
        $candidateRows = (clone $recentVideoQuery)
            ->where('commentCount', '>=', $min)
            ->orderBy('publishedAt', 'desc')
            ->orderBy('videoId')
            ->get($this->videoColumns())
            ->values();
        $queuedVideoIds = $this->queuedVideoIds($candidateRows->pluck('videoId'));
        $doneVideoIds = $this->doneVideoIds($candidateRows->pluck('videoId'));
        $wouldInsertRows = $candidateRows
            ->reject(fn (object $row): bool => $queuedVideoIds->has((string) $row->videoId))
            ->values();
        $rows = $wouldInsertRows->take($limit)->values();

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => 'recent_high_comment_videos',
            'filters' => [
                'tagid' => $filters['tagid'],
                'or' => $filters['or'],
                'not' => $filters['not'],
            ],
            'hours' => $hours,
            'min' => $min,
            'limit' => $limit,
            'published_after' => $publishedAfter->format('Y-m-d H:i:s'),
            'matching_channels' => $channelIds->count(),
            'recent_video_rows' => $recentVideoRows,
            'comment_threshold_rows' => $commentThresholdRows,
            'already_queued_rows' => $candidateRows
                ->filter(fn (object $row): bool => $queuedVideoIds->has((string) $row->videoId))
                ->count(),
            'already_done_rows' => $candidateRows
                ->filter(fn (object $row): bool => $doneVideoIds->has((string) $row->videoId))
                ->count(),
            'would_insert_queue_rows' => $wouldInsertRows->count(),
            'displayed_rows' => $rows->count(),
            'queue_insert_skipped' => '`urt_comment_queue` insert is intentionally skipped in read-only mode',
            'writes_skipped' => [
                'urt_comment_queue insert',
            ],
            'rows' => $rows
                ->map(fn (object $row): array => $this->mapRow($row, $queuedVideoIds, $doneVideoIds))
                ->all(),
            'writes' => [],
        ];
    }

    /**
     * @param  array{or: array<int>, tagid: array<int>, not: array<int>, limit: int}  $filters
     * @return Collection<int, object>
     */
    private function matchingChannels(array $filters): Collection
    {
        if (! Schema::hasTable('urt_count')) {
            return collect();
        }

        return $this->tagFilter->matchingChannelTags($filters);
    }

    /**
     * @param  list<int>  $channelIds
     */
    private function recentVideoQuery(array $channelIds, CarbonImmutable $publishedAfter, int $min): \Illuminate\Database\Query\Builder
    {
        $query = DB::table('urt_video');

        if ($channelIds === [] || ! Schema::hasTable('urt_video')) {
            return $query->whereRaw('1 = 0');
        }

        return $query
            ->whereIn('u_id', $channelIds)
            ->where('publishedAt', '>=', $publishedAfter->format('Y-m-d H:i:s'))
            ->where('viewCount', '>=', $min);
    }

    /**
     * @return list<string>
     */
    private function videoColumns(): array
    {
        $desired = ['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'channelTitle', 'viewCount', 'commentCount'];
        $available = Schema::hasTable('urt_video') ? Schema::getColumnListing('urt_video') : [];

        return collect($desired)
            ->filter(fn (string $column): bool => in_array($column, $available, true))
            ->values()
            ->all();
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @return Collection<string, true>
     */
    private function queuedVideoIds(Collection $videoIds): Collection
    {
        if (! Schema::hasTable('urt_comment_queue')) {
            return collect();
        }

        return $this->videoIdSet('urt_comment_queue', $videoIds);
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @return Collection<string, true>
     */
    private function doneVideoIds(Collection $videoIds): Collection
    {
        if (! Schema::hasTable('urt_comment_queue_done')) {
            return collect();
        }

        return $this->videoIdSet('urt_comment_queue_done', $videoIds);
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @return Collection<string, true>
     */
    private function videoIdSet(string $table, Collection $videoIds): Collection
    {
        $ids = $videoIds
            ->filter(fn (mixed $id): bool => is_string($id) && $id !== '')
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return collect();
        }

        return DB::table($table)
            ->whereIn('videoId', $ids->all())
            ->pluck('videoId')
            ->mapWithKeys(fn (string $videoId): array => [$videoId => true]);
    }

    /**
     * @param  Collection<string, true>  $queuedVideoIds
     * @param  Collection<string, true>  $doneVideoIds
     * @return array<string, mixed>
     */
    private function mapRow(object $row, Collection $queuedVideoIds, Collection $doneVideoIds): array
    {
        $videoId = (string) $this->value($row, 'videoId');

        return [
            'pk' => $this->value($row, 'pk') !== null ? (int) $this->value($row, 'pk') : null,
            'video_id' => $videoId,
            'u_id' => $this->value($row, 'u_id') !== null ? (int) $this->value($row, 'u_id') : null,
            'published_at' => $this->value($row, 'publishedAt') !== null ? (string) $this->value($row, 'publishedAt') : null,
            'title' => $this->value($row, 'title') !== null ? (string) $this->value($row, 'title') : null,
            'channel_title' => $this->value($row, 'channelTitle') !== null ? (string) $this->value($row, 'channelTitle') : null,
            'view_count' => $this->value($row, 'viewCount') !== null ? (int) $this->value($row, 'viewCount') : null,
            'comment_count' => $this->value($row, 'commentCount') !== null ? (int) $this->value($row, 'commentCount') : null,
            'already_queued' => $queuedVideoIds->has($videoId),
            'already_done' => $doneVideoIds->has($videoId),
            'would_insert_queue' => ! $queuedVideoIds->has($videoId),
        ];
    }

    private function value(object $row, string $column): mixed
    {
        return property_exists($row, $column) ? $row->{$column} : null;
    }
}
