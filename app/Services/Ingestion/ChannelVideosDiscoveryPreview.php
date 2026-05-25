<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ChannelVideosDiscoveryPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?int $uId = null,
        ?int $live = null,
        bool $rescan = false,
        int $hours = 700,
        int $force = 1,
        int $limit = 20,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $hours = max(1, min(24 * 365, $hours));
        $force = max(1, min(20, $force));
        $limit = max(1, min(81, $limit));
        $live = in_array($live, [1, 2], true) ? $live : null;
        $oneHourLater = $now->addHour()->format('Y-m-d H:i:s');
        $weekStart = $now->subDays(7);

        [$source, $query, $taggedChannelCount, $liveTagId] = $this->candidateQuery(
            uId: $uId,
            live: $live,
            rescan: $rescan,
            now: $now,
        );

        $eligibleRows = (clone $query)->count();
        $channels = (clone $query)
            ->limit($limit)
            ->get($this->columnsFor('urt_channel'))
            ->values();
        $videoStats = $this->videoStats($channels->pluck('u_id')->all(), $weekStart);
        $liveStats = $this->liveStats($channels->pluck('u_id')->all());

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $source,
            'target_u_id' => $uId,
            'live' => $live,
            'live_tag_id' => $liveTagId,
            'rescan' => $rescan,
            'hours' => $hours,
            'force' => $force,
            'limit' => $limit,
            'active_channels' => $this->activeChannels(),
            'due_channels' => $this->dueChannels($now),
            'tagged_channels' => $taggedChannelCount,
            'eligible_rows' => $eligibleRows,
            'selected_rows' => $channels->count(),
            'missing_uploads_playlist' => $channels
                ->filter(fn (object $row): bool => trim((string) ($row->uploads ?? '')) === '')
                ->count(),
            'would_call_api' => $channels->isNotEmpty(),
            'playlist_api_skipped' => 'YouTube Data API playlistItems.list(snippet) is intentionally not called in read-only mode',
            'would_fetch_per_channel' => 50,
            'would_set_initial_vtime' => $channels->isNotEmpty() ? $oneHourLater : null,
            'writes_skipped' => [
                'urt_channel.vtime initial reserve update',
                'urt_video insert for playlist items',
                'urt_video_schedule insert for playlist items',
                'urt_video_live insert for live/upcoming items',
                'urt_channel.vtime final next-check update',
            ],
            'rows' => $channels
                ->map(fn (object $row): array => $this->mapRow($row, $videoStats, $liveStats, $now, $weekStart))
                ->all(),
            'writes' => [],
        ];
    }

    /**
     * @return array{0: string, 1: \Illuminate\Database\Query\Builder, 2: int|null, 3: int|null}
     */
    private function candidateQuery(?int $uId, ?int $live, bool $rescan, CarbonImmutable $now): array
    {
        if ($uId !== null) {
            return [
                'single_channel',
                DB::table('urt_channel')->where('u_id', $uId)->orderBy('u_id'),
                null,
                null,
            ];
        }

        if ($live !== null) {
            $tagId = $live === 1 ? 52 : 89;
            $uIds = DB::table('urt_count')
                ->where('tags', 'like', '%['.$tagId.']%')
                ->pluck('u_id')
                ->map(fn (mixed $id): int => (int) $id)
                ->unique()
                ->values();

            return [
                'live_tag_'.$tagId,
                DB::table('urt_channel')
                    ->whereNull('flag_del')
                    ->whereIn('u_id', $uIds->isNotEmpty() ? $uIds->all() : [0])
                    ->orderBy('vtime')
                    ->orderBy('u_id'),
                $uIds->count(),
                $tagId,
            ];
        }

        if ($rescan) {
            return [
                'rescan_large_channels',
                DB::table('urt_channel')
                    ->where('videoCount', '>', 10000)
                    ->where('vtime', '>', '2022-08-03 00:00:00')
                    ->whereNull('flag_del')
                    ->orderBy('u_id'),
                null,
                null,
            ];
        }

        return [
            'due_vtime',
            DB::table('urt_channel')
                ->whereNull('flag_del')
                ->where(function ($query) use ($now): void {
                    $query
                        ->where('vtime', '<=', $now->format('Y-m-d H:i:s'))
                        ->orWhereNull('vtime');
                })
                ->orderBy('vtime')
                ->orderBy('u_id'),
            null,
            null,
        ];
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

    private function dueChannels(CarbonImmutable $now): int
    {
        return Schema::hasTable('urt_channel')
            ? DB::table('urt_channel')
                ->whereNull('flag_del')
                ->where(function ($query) use ($now): void {
                    $query
                        ->where('vtime', '<=', $now->format('Y-m-d H:i:s'))
                        ->orWhereNull('vtime');
                })
                ->count()
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
     * @return Collection<int, int>
     */
    private function liveStats(array $uIds): Collection
    {
        $uIds = collect($uIds)->map(fn (mixed $id): int => (int) $id)->unique()->values();

        if ($uIds->isEmpty() || ! Schema::hasTable('urt_video_live')) {
            return collect();
        }

        return DB::table('urt_video_live')
            ->selectRaw('u_id, count(*) as total')
            ->whereIn('u_id', $uIds->all())
            ->groupBy('u_id')
            ->pluck('total', 'u_id')
            ->map(fn (mixed $count): int => (int) $count);
    }

    /**
     * @param  Collection<int, array{total: int, recent_week: int, latest_published_at: string|null}>  $videoStats
     * @param  Collection<int, int>  $liveStats
     * @return array<string, mixed>
     */
    private function mapRow(object $row, Collection $videoStats, Collection $liveStats, CarbonImmutable $now, CarbonImmutable $weekStart): array
    {
        $uId = (int) $row->u_id;
        $stats = $videoStats->get($uId, ['total' => 0, 'recent_week' => 0, 'latest_published_at' => null]);
        $localWeekCount = (int) $stats['recent_week'];
        $estimatedNextVtime = $this->estimateNextVtime($now, $localWeekCount);

        return [
            'u_id' => $uId,
            'youtube_id' => (string) ($row->youtube_id ?? ''),
            'uploads' => (string) ($row->uploads ?? ''),
            'title' => $row->title !== null ? (string) $row->title : null,
            'current_vtime' => $row->vtime !== null ? (string) $row->vtime : null,
            'video_count' => $row->videoCount !== null ? (int) $row->videoCount : null,
            'local_video_rows' => (int) $stats['total'],
            'local_recent_week_count' => $localWeekCount,
            'local_latest_published_at' => $stats['latest_published_at'],
            'local_live_rows' => $liveStats->get($uId, 0),
            'week_window_start' => $weekStart->format('Y-m-d H:i:s'),
            'estimated_next_vtime_from_local_week_count' => $estimatedNextVtime,
            'would_fetch_playlist_id' => (string) ($row->uploads ?? ''),
            'would_fetch_max_results' => 50,
            'would_insert_video_rows' => 'unknown until playlistItems response; legacy attempts up to 50',
            'would_insert_schedule_rows' => 'unknown until playlistItems response; legacy attempts up to 50',
            'would_insert_live_rows' => 'only for default_live.jpg, live, or upcoming playlist items',
        ];
    }

    private function estimateNextVtime(CarbonImmutable $now, int $localWeekCount): string
    {
        $interval = $localWeekCount > 0
            ? (86400 * 7 / $localWeekCount) / 3
            : 86400 * 7;

        $future = $now->addSeconds((int) $interval);

        if ((int) $future->format('H') < 8) {
            $interval += (8 - (int) $future->format('H')) * 3600;
        }

        if ($interval < 7200) {
            $interval = 7200;
        }

        return $now->addSeconds((int) $interval)->format('Y-m-d H:i:s');
    }
}
