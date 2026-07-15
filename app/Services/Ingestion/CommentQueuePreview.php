<?php

namespace App\Services\Ingestion;

use App\Services\Legacy\LegacyTagFilter;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CommentQueuePreview
{
    public function __construct(private readonly LegacyTagFilter $tagFilter) {}

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
        $commentThresholdQuery = (clone $recentVideoQuery)
            ->where('commentCount', '>=', $min);
        $commentThresholdRows = (clone $commentThresholdQuery)->count();
        $alreadyQueuedRows = $this->existingVideoRows($commentThresholdQuery, 'urt_comment_queue');
        $alreadyDoneRows = $this->existingVideoRows($commentThresholdQuery, 'urt_comment_queue_done');
        $candidateQuery = $this->withoutExistingVideoRows(
            $this->withoutExistingVideoRows(clone $commentThresholdQuery, 'urt_comment_queue'),
            'urt_comment_queue_done',
        );
        $wouldInsertQueueRows = (clone $candidateQuery)->count();
        $candidateRows = (clone $candidateQuery)
            ->orderBy('publishedAt', 'desc')
            ->orderBy('videoId')
            ->limit($limit + 1)
            ->get($this->videoColumns())
            ->values();
        $sourceTruncated = $wouldInsertQueueRows > $limit || $candidateRows->count() > $limit;
        $rows = $candidateRows->take($limit)->values();

        return [
            'mode' => 'ingestion-preview',
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
            'already_queued_rows' => $alreadyQueuedRows,
            'already_done_rows' => $alreadyDoneRows,
            'would_insert_queue_rows' => $wouldInsertQueueRows,
            'candidate_query_limit' => $limit + 1,
            'candidate_rows_loaded' => $candidateRows->count(),
            'displayed_rows' => $rows->count(),
            'source_complete' => ! $sourceTruncated,
            'source_truncated' => $sourceTruncated,
            'queue_insert_skipped' => '`urt_comment_queue` insert is intentionally skipped in planning mode',
            'writes_skipped' => [
                'urt_comment_queue insert',
            ],
            'rows' => $rows
                ->map(fn (object $row): array => $this->mapRow($row))
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
    private function recentVideoQuery(array $channelIds, CarbonImmutable $publishedAfter, int $min): Builder
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

    private function existingVideoRows(Builder $query, string $table): int
    {
        if (! Schema::hasTable($table)) {
            return 0;
        }

        return $this->withExistingVideoRows(clone $query, $table)->count();
    }

    private function withExistingVideoRows(Builder $query, string $table): Builder
    {
        return $query->whereExists(function (Builder $existing) use ($table): void {
            $existing
                ->selectRaw('1')
                ->from($table);
            $this->whereSameVideoId($existing, $table);
        });
    }

    private function withoutExistingVideoRows(Builder $query, string $table): Builder
    {
        if (! Schema::hasTable($table)) {
            return $query;
        }

        return $query->whereNotExists(function (Builder $existing) use ($table): void {
            $existing
                ->selectRaw('1')
                ->from($table);
            $this->whereSameVideoId($existing, $table);
        });
    }

    private function whereSameVideoId(Builder $query, string $table): void
    {
        if (! in_array(DB::connection()->getDriverName(), ['mysql', 'mariadb'], true)) {
            $query->whereColumn($table.'.videoId', 'urt_video.videoId');

            return;
        }

        $grammar = DB::connection()->getQueryGrammar();
        $existingVideoId = $grammar->wrap($table.'.videoId');
        $candidateVideoId = $grammar->wrap('urt_video.videoId');
        $query->whereRaw("BINARY {$existingVideoId} = BINARY {$candidateVideoId}");
    }

    /**
     * @return array<string, mixed>
     */
    private function mapRow(object $row): array
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
            'already_queued' => false,
            'already_done' => false,
            'would_insert_queue' => true,
        ];
    }

    private function value(object $row, string $column): mixed
    {
        return property_exists($row, $column) ? $row->{$column} : null;
    }
}
