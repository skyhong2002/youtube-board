<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class TvbsChannelVideosDiscoveryPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(
        int $tagId = 29,
        ?int $uId = null,
        ?string $channel = null,
        int $hours = 700,
        int $force = 1,
        int $limit = 20,
        int|string|null $offset = 0,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $tagId = max(1, $tagId);
        $uId = $uId !== null ? max(1, $uId) : null;
        $channel = is_string($channel) && trim($channel) !== '' ? trim($channel) : null;
        $hours = max(1, min(24 * 365, $hours));
        $force = max(1, min(20, $force));
        $limit = max(1, min(80, $limit));
        $weekStart = $now->subDays(7);

        $taggedUIds = $this->taggedUIds($tagId);
        $query = DB::table('urt_channel')
            ->whereNull('flag_del')
            ->whereIn('u_id', $taggedUIds->isNotEmpty() ? $taggedUIds->all() : [0])
            ->orderBy('u_id');

        if ($uId !== null) {
            $query->where('u_id', $uId);
        }

        if ($channel !== null) {
            $query->where('youtube_id', $channel);
        }

        $eligibleRows = (clone $query)->count();
        [$effectiveOffset, $offsetMode] = $this->effectiveOffset($offset, $eligibleRows, $limit, $now);
        $channels = (clone $query)
            ->offset($effectiveOffset)
            ->limit($limit)
            ->get($this->columnsFor('urt_channel'))
            ->values();
        $batchWrapped = false;

        if ($channels->count() < min($limit, $eligibleRows) && $effectiveOffset > 0) {
            $batchWrapped = true;
            $channels = $channels->concat((clone $query)
                ->limit(min($limit, $eligibleRows) - $channels->count())
                ->get($this->columnsFor('urt_channel')))
                ->values();
        }
        $uIds = $channels->pluck('u_id')->all();
        $videoStats = $this->videoStats($uIds, $weekStart);
        $tvbsLiveStats = $this->tvbsLiveStats($uIds);

        return [
            'mode' => 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $uId !== null
                ? 'tvbs_single_channel_id'
                : ($channel !== null ? 'tvbs_single_channel_youtube_id' : 'tvbs_tag_'.$tagId.'_all_channels'),
            'tvbs_tag_id' => $tagId,
            'target_u_id' => $uId,
            'target_channel' => $channel,
            'hours' => $hours,
            'force' => $force,
            'limit' => $limit,
            'legacy_loop_limit' => 80,
            'legacy_sleep_seconds' => 300,
            'active_channels' => $this->activeChannels(),
            'tagged_channels' => $taggedUIds->count(),
            'eligible_rows' => $eligibleRows,
            'selected_rows' => $channels->count(),
            'offset' => $effectiveOffset,
            'offset_mode' => $offsetMode,
            'next_offset' => $eligibleRows > 0 ? ($effectiveOffset + $channels->count()) % $eligibleRows : 0,
            'batch_wrapped' => $batchWrapped,
            'source_truncated' => $eligibleRows > $channels->count(),
            'missing_uploads_playlist' => $channels
                ->filter(fn (object $row): bool => trim((string) ($row->uploads ?? '')) === '')
                ->count(),
            'would_call_api' => $channels->isNotEmpty(),
            'playlist_api_skipped' => 'YouTube Data API playlistItems.list(snippet) is intentionally not called in planning mode',
            'would_fetch_per_channel' => 50,
            'tvbs_specific_table' => 'urt_video_live_tvbs',
            'writes_skipped' => [
                'urt_video insert for playlist items',
                'urt_video_schedule insert for playlist items',
                'urt_video_live_tvbs insert for default_live.jpg, live, or upcoming playlist items',
            ],
            'rows' => $channels
                ->map(fn (object $row): array => $this->mapRow($row, $videoStats, $tvbsLiveStats, $weekStart))
                ->all(),
            'writes' => [],
        ];
    }

    /** @return array{0: int, 1: string} */
    private function effectiveOffset(
        int|string|null $offset,
        int $total,
        int $limit,
        CarbonImmutable $now,
    ): array {
        if ($total < 1) {
            return [0, 'explicit'];
        }

        if (is_string($offset) && strtolower(trim($offset)) === 'auto') {
            return [(intdiv($now->getTimestamp(), 300) * $limit) % $total, 'auto'];
        }

        return [max(0, (int) $offset) % $total, 'explicit'];
    }

    /**
     * @return Collection<int, int>
     */
    private function taggedUIds(int $tagId): Collection
    {
        if (! Schema::hasTable('urt_count')) {
            return collect();
        }

        return DB::table('urt_count')
            ->where('tags', 'like', '%['.$tagId.']%')
            ->pluck('u_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->values();
    }

    /**
     * @return list<string>
     */
    private function columnsFor(string $table): array
    {
        if (! Schema::hasTable($table)) {
            return [];
        }

        $desired = [
            'u_id',
            'ctime',
            'mtime',
            'vtime',
            'flag_del',
            'youtube_id',
            'title',
            'uploads',
            'videoCount',
        ];
        $available = Schema::getColumnListing($table);

        return collect($desired)
            ->filter(fn (string $column): bool => in_array($column, $available, true))
            ->values()
            ->all();
    }

    private function activeChannels(): int
    {
        return Schema::hasTable('urt_channel')
            ? DB::table('urt_channel')->whereNull('flag_del')->count()
            : 0;
    }

    /**
     * @param  array<int, int>  $uIds
     * @return Collection<int, array{total: int, recent_week: int, latest_published_at: string|null}>
     */
    private function videoStats(array $uIds, CarbonImmutable $weekStart): Collection
    {
        $uIds = collect($uIds)->map(fn (mixed $id): int => (int) $id)->unique()->values();

        if ($uIds->isEmpty() || ! Schema::hasTable('urt_video')) {
            return collect();
        }

        return DB::table('urt_video')
            ->selectRaw(
                'u_id, count(*) as total, sum(case when publishedAt >= ? then 1 else 0 end) as recent_week, max(publishedAt) as latest_published_at',
                [$weekStart->format('Y-m-d H:i:s')],
            )
            ->whereIn('u_id', $uIds->all())
            ->groupBy('u_id')
            ->get()
            ->mapWithKeys(fn (object $row): array => [
                (int) $row->u_id => [
                    'total' => (int) $row->total,
                    'recent_week' => (int) $row->recent_week,
                    'latest_published_at' => $row->latest_published_at !== null ? (string) $row->latest_published_at : null,
                ],
            ]);
    }

    /**
     * @param  array<int, int>  $uIds
     * @return Collection<int, array{total: int, active: int, latest_published_at: string|null}>
     */
    private function tvbsLiveStats(array $uIds): Collection
    {
        $uIds = collect($uIds)->map(fn (mixed $id): int => (int) $id)->unique()->values();

        if ($uIds->isEmpty() || ! Schema::hasTable('urt_video_live_tvbs')) {
            return collect();
        }

        return DB::table('urt_video_live_tvbs')
            ->selectRaw(
                'u_id, count(*) as total, sum(case when actualEndTime is null and (del_flag is null or del_flag < 1) then 1 else 0 end) as active, max(publishedAt) as latest_published_at',
            )
            ->whereIn('u_id', $uIds->all())
            ->groupBy('u_id')
            ->get()
            ->mapWithKeys(fn (object $row): array => [
                (int) $row->u_id => [
                    'total' => (int) $row->total,
                    'active' => (int) $row->active,
                    'latest_published_at' => $row->latest_published_at !== null ? (string) $row->latest_published_at : null,
                ],
            ]);
    }

    /**
     * @param  Collection<int, array{total: int, recent_week: int, latest_published_at: string|null}>  $videoStats
     * @param  Collection<int, array{total: int, active: int, latest_published_at: string|null}>  $tvbsLiveStats
     * @return array<string, mixed>
     */
    private function mapRow(object $row, Collection $videoStats, Collection $tvbsLiveStats, CarbonImmutable $weekStart): array
    {
        $uId = (int) $row->u_id;
        $stats = $videoStats->get($uId, ['total' => 0, 'recent_week' => 0, 'latest_published_at' => null]);
        $liveStats = $tvbsLiveStats->get($uId, ['total' => 0, 'active' => 0, 'latest_published_at' => null]);

        return [
            'u_id' => $uId,
            'youtube_id' => (string) ($row->youtube_id ?? ''),
            'uploads' => (string) ($row->uploads ?? ''),
            'title' => $row->title !== null ? (string) $row->title : null,
            'current_vtime' => $row->vtime !== null ? (string) $row->vtime : null,
            'video_count' => $row->videoCount !== null ? (int) $row->videoCount : null,
            'local_video_rows' => (int) $stats['total'],
            'local_recent_week_count' => (int) $stats['recent_week'],
            'local_latest_published_at' => $stats['latest_published_at'],
            'local_tvbs_live_rows' => (int) $liveStats['total'],
            'local_tvbs_active_live_rows' => (int) $liveStats['active'],
            'local_latest_tvbs_published_at' => $liveStats['latest_published_at'],
            'week_window_start' => $weekStart->format('Y-m-d H:i:s'),
            'would_fetch_playlist_id' => (string) ($row->uploads ?? ''),
            'would_fetch_max_results' => 50,
            'would_insert_video_rows' => 'unknown until playlistItems response; legacy attempts up to 50',
            'would_insert_schedule_rows' => 'unknown until playlistItems response; legacy attempts up to 50',
            'would_insert_tvbs_live_rows' => 'only for default_live.jpg, live, or upcoming playlist items',
        ];
    }
}
