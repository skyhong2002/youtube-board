<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CommentFetchPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(?string $videoId = null, int $limit = 50, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $videoId = is_string($videoId) && trim($videoId) !== '' ? trim($videoId) : null;
        $limit = max(1, min(1000, $limit));
        $refreshExpireTime = $now->subHours(3);
        $claimMinutes = max(1, min(1440, (int) config('ingestion.comment_claim_minutes', 30)));
        $claimExpireTime = $now->subMinutes($claimMinutes);

        $queueRows = $this->queueRows($videoId, $limit, $claimExpireTime);
        $videoIds = $queueRows->pluck('videoId')->filter()->unique()->values();
        $commentRows = $this->commentRows($videoIds);
        $videoRows = $this->videoRows($videoIds);
        $doneVideoIds = $this->doneVideoIds($videoIds);
        $mappedRows = $queueRows
            ->map(fn (object $row): array => $this->mapRow($row, $commentRows, $videoRows, $doneVideoIds, $refreshExpireTime, $now))
            ->values();
        $recentCacheRows = $mappedRows
            ->filter(fn (array $row): bool => $row['would_skip_api_recent_cache'])
            ->count();

        return [
            'mode' => 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => 'comment_queue_drain',
            'target_video_id' => $videoId,
            'limit' => $limit,
            'queue_total' => $this->countTable('urt_comment_queue'),
            'queue_done_total' => $this->countTable('urt_comment_queue_done'),
            'claim_minutes' => $claimMinutes,
            'claim_expire_time' => $claimExpireTime->format('Y-m-d H:i:s'),
            'active_claim_rows' => $this->activeClaimRows($videoId, $claimExpireTime),
            'selected_rows' => $queueRows->count(),
            'existing_comment_rows' => $commentRows->count(),
            'already_done_rows' => $mappedRows
                ->filter(fn (array $row): bool => $row['already_in_done'])
                ->count(),
            'recent_comment_cache_rows' => $recentCacheRows,
            'would_insert_comment_rows' => $mappedRows
                ->filter(fn (array $row): bool => ! $row['existing_comment_row'])
                ->count(),
            'would_call_get_comment' => $queueRows->count(),
            'would_call_comment_threads' => max(0, $queueRows->count() - $recentCacheRows),
            'would_move_to_done_rows' => $queueRows->count(),
            'refresh_expire_time' => $refreshExpireTime->format('Y-m-d H:i:s'),
            'force' => 1,
            'api_call_skipped' => 'YouTube Data API commentThreads.list is intentionally not called in planning mode',
            'writes_skipped' => [
                'urt_comment_queue.stime atomic claim/release',
                'maint/get_comment.php execution',
                'urt_comment insert/update',
                'urt_comment_author insert',
                'urt_comment_rev insert/update',
                'urt_comment_queue.ftime update',
                'urt_comment_queue_done insert-select',
                'urt_comment_queue delete',
            ],
            'rows' => $mappedRows->all(),
            'writes' => [],
        ];
    }

    private function queueRows(?string $videoId, int $limit, CarbonImmutable $claimExpireTime): Collection
    {
        if (! Schema::hasTable('urt_comment_queue')) {
            return collect();
        }

        $query = DB::table('urt_comment_queue')
            ->whereNull('ftime')
            ->where(function ($query) use ($claimExpireTime): void {
                $query
                    ->whereNull('stime')
                    ->orWhere('stime', '<=', $claimExpireTime->format('Y-m-d H:i:s'));
            })
            ->orderBy('pk');

        if ($videoId !== null) {
            $query->where('videoId', $videoId);
        }

        return $query
            ->limit($limit)
            ->get($this->columnsFor('urt_comment_queue', ['pk', 'ctime', 'stime', 'ftime', 'videoId']))
            ->values();
    }

    private function activeClaimRows(?string $videoId, CarbonImmutable $claimExpireTime): int
    {
        if (! Schema::hasTable('urt_comment_queue')) {
            return 0;
        }

        return DB::table('urt_comment_queue')
            ->whereNull('ftime')
            ->whereNotNull('stime')
            ->where('stime', '>', $claimExpireTime->format('Y-m-d H:i:s'))
            ->when($videoId !== null, fn ($query) => $query->where('videoId', $videoId))
            ->count();
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @return Collection<string, object>
     */
    private function commentRows(Collection $videoIds): Collection
    {
        if (! Schema::hasTable('urt_comment')) {
            return collect();
        }

        return $this->rowsByVideoId(
            'urt_comment',
            $videoIds,
            ['pk', 'videoId', 'ctime', 'mtime', 'comments_count', 'latest_time', 'authors_count', 'pageToken', 'channelId', 'u_id'],
        );
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @return Collection<string, object>
     */
    private function videoRows(Collection $videoIds): Collection
    {
        if (! Schema::hasTable('urt_video')) {
            return collect();
        }

        return $this->rowsByVideoId(
            'urt_video',
            $videoIds,
            ['pk', 'u_id', 'videoId', 'publishedAt', 'title', 'channelTitle', 'viewCount', 'commentCount'],
        );
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

        $ids = $this->cleanVideoIds($videoIds);

        if ($ids->isEmpty()) {
            return collect();
        }

        return DB::table('urt_comment_queue_done')
            ->whereIn('videoId', $ids->all())
            ->pluck('videoId')
            ->mapWithKeys(fn (string $videoId): array => [$videoId => true]);
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @param  list<string>  $columns
     * @return Collection<string, object>
     */
    private function rowsByVideoId(string $table, Collection $videoIds, array $columns): Collection
    {
        $ids = $this->cleanVideoIds($videoIds);

        if ($ids->isEmpty()) {
            return collect();
        }

        return DB::table($table)
            ->whereIn('videoId', $ids->all())
            ->get($this->columnsFor($table, $columns))
            ->keyBy('videoId');
    }

    /**
     * @param  Collection<int, mixed>  $videoIds
     * @return Collection<int, string>
     */
    private function cleanVideoIds(Collection $videoIds): Collection
    {
        return $videoIds
            ->filter(fn (mixed $id): bool => is_string($id) && $id !== '')
            ->unique()
            ->values();
    }

    /**
     * @param  list<string>  $desired
     * @return list<string>
     */
    private function columnsFor(string $table, array $desired): array
    {
        $available = Schema::hasTable($table) ? Schema::getColumnListing($table) : [];

        return collect($desired)
            ->filter(fn (string $column): bool => in_array($column, $available, true))
            ->values()
            ->all();
    }

    private function countTable(string $table): int
    {
        return Schema::hasTable($table) ? DB::table($table)->count() : 0;
    }

    /**
     * @param  Collection<string, object>  $commentRows
     * @param  Collection<string, object>  $videoRows
     * @param  Collection<string, true>  $doneVideoIds
     * @return array<string, mixed>
     */
    private function mapRow(
        object $queueRow,
        Collection $commentRows,
        Collection $videoRows,
        Collection $doneVideoIds,
        CarbonImmutable $refreshExpireTime,
        CarbonImmutable $now,
    ): array {
        $videoId = (string) $this->value($queueRow, 'videoId');
        $commentRow = $commentRows->get($videoId);
        $videoRow = $videoRows->get($videoId);
        $commentMtime = $commentRow !== null && $this->value($commentRow, 'mtime') !== null
            ? (string) $this->value($commentRow, 'mtime')
            : null;
        $resumePageToken = $commentRow !== null && is_string($this->value($commentRow, 'pageToken'))
            ? trim((string) $this->value($commentRow, 'pageToken'))
            : '';
        $wouldSkipRecentCache = $resumePageToken === ''
            && $commentMtime !== null
            && $commentMtime > $refreshExpireTime->format('Y-m-d H:i:s');

        return [
            'pk' => $this->value($queueRow, 'pk') !== null ? (int) $this->value($queueRow, 'pk') : null,
            'video_id' => $videoId,
            'queue_ctime' => $this->value($queueRow, 'ctime') !== null ? (string) $this->value($queueRow, 'ctime') : null,
            'queue_stime' => $this->value($queueRow, 'stime') !== null ? (string) $this->value($queueRow, 'stime') : null,
            'queue_ftime' => $this->value($queueRow, 'ftime') !== null ? (string) $this->value($queueRow, 'ftime') : null,
            'title' => $videoRow !== null && $this->value($videoRow, 'title') !== null ? (string) $this->value($videoRow, 'title') : null,
            'channel_title' => $videoRow !== null && $this->value($videoRow, 'channelTitle') !== null ? (string) $this->value($videoRow, 'channelTitle') : null,
            'u_id' => $videoRow !== null && $this->value($videoRow, 'u_id') !== null ? (int) $this->value($videoRow, 'u_id') : null,
            'published_at' => $videoRow !== null && $this->value($videoRow, 'publishedAt') !== null ? (string) $this->value($videoRow, 'publishedAt') : null,
            'view_count' => $videoRow !== null && $this->value($videoRow, 'viewCount') !== null ? (int) $this->value($videoRow, 'viewCount') : null,
            'video_comment_count' => $videoRow !== null && $this->value($videoRow, 'commentCount') !== null ? (int) $this->value($videoRow, 'commentCount') : null,
            'existing_comment_row' => $commentRow !== null,
            'comment_mtime' => $commentMtime,
            'resume_page_token_present' => $resumePageToken !== '',
            'comments_count' => $commentRow !== null && $this->value($commentRow, 'comments_count') !== null ? (int) $this->value($commentRow, 'comments_count') : null,
            'authors_count' => $commentRow !== null && $this->value($commentRow, 'authors_count') !== null ? (int) $this->value($commentRow, 'authors_count') : null,
            'latest_time' => $commentRow !== null && $this->value($commentRow, 'latest_time') !== null ? (string) $this->value($commentRow, 'latest_time') : null,
            'already_in_done' => $doneVideoIds->has($videoId),
            'would_set_stime' => $now->format('Y-m-d H:i:s'),
            'claim_status' => $this->value($queueRow, 'stime') === null ? 'unclaimed' : 'stale_claim',
            'would_call_get_comment' => true,
            'would_skip_api_recent_cache' => $wouldSkipRecentCache,
            'would_call_comment_threads' => ! $wouldSkipRecentCache,
            'would_set_ftime' => $resumePageToken === '',
            'would_copy_to_done' => $resumePageToken === '',
            'would_delete_queue' => $resumePageToken === '',
        ];
    }

    private function value(object $row, string $column): mixed
    {
        return property_exists($row, $column) ? $row->{$column} : null;
    }
}
