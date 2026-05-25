<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class LivePollingPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(?string $videoId = null, int $intervalMinutes = 11, int $limit = 50, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $videoId = is_string($videoId) && trim($videoId) !== '' ? trim($videoId) : null;
        $intervalMinutes = max(1, min(240, $intervalMinutes));
        $limit = max(1, min(50, $limit));
        $legacyBatchLimit = 50;
        $tooSoon = $now->subMinutes($intervalMinutes);
        $today = $now->toDateString();

        [$source, $query] = $this->candidateQuery($videoId, $tooSoon, $now);
        $eligibleRows = (clone $query)->count();
        $selectedRows = (clone $query)
            ->limit($legacyBatchLimit)
            ->get($this->columnsFor('urt_video_live'))
            ->values();
        $rows = $selectedRows->take($limit)->values();
        $logRows = $this->todayLogRows($selectedRows->pluck('videoId')->all(), $today);
        $displayRows = $this->displayRows($rows->pluck('videoId')->all());
        $wouldCallApi = $videoId !== null || $selectedRows->count() >= 10;

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $source,
            'target_video_id' => $videoId,
            'interval_minutes' => $intervalMinutes,
            'limit' => $limit,
            'legacy_batch_limit' => $legacyBatchLimit,
            'too_soon' => $tooSoon->format('Y-m-d H:i:s'),
            'scheduled_before' => $now->format('Y-m-d H:i:s'),
            'legacy_min_batch' => 10,
            'active_live_rows' => $this->activeLiveRows(),
            'eligible_rows' => $eligibleRows,
            'selected_rows' => $selectedRows->count(),
            'displayed_rows' => $rows->count(),
            'existing_today_log_rows' => $logRows->count(),
            'missing_today_log_rows' => max(0, $selectedRows->count() - $logRows->count()),
            'would_call_api' => $wouldCallApi,
            'skip_reason' => $wouldCallApi ? null : 'legacy exits before API call when fewer than 10 rows are selected and no videoId is provided',
            'api_call_skipped' => 'YouTube Data API videos.list(liveStreamingDetails) is intentionally not called in read-only mode',
            'writes_skipped' => [
                'urt_video_live mtime/liveStreamingDetails update',
                'urt_video_live.max_current update when concurrentViewers exceeds previous max',
                'urt_video_live_log insert for first sample of the day',
                'urt_video_live_log log_json/max_current update for current minute',
            ],
            'rows' => $rows
                ->map(fn (object $row): array => $this->mapRow($row, $logRows, $displayRows, $today, $now))
                ->all(),
            'writes' => [],
        ];
    }

    /**
     * @return array{0: string, 1: \Illuminate\Database\Query\Builder}
     */
    private function candidateQuery(?string $videoId, CarbonImmutable $tooSoon, CarbonImmutable $now): array
    {
        if ($videoId !== null) {
            return [
                'single_video',
                DB::table('urt_video_live')
                    ->where('videoId', $videoId)
                    ->orderBy('videoId'),
            ];
        }

        return [
            'stale_live_rows',
            DB::table('urt_video_live')
                ->where(function ($query) use ($tooSoon): void {
                    $query
                        ->whereNull('mtime')
                        ->orWhere('mtime', '<', $tooSoon->format('Y-m-d H:i:s'));
                })
                ->whereNull('actualEndTime')
                ->where(function ($query) use ($now): void {
                    $query
                        ->whereNull('scheduledStartTime')
                        ->orWhere('scheduledStartTime', '<', $now->format('Y-m-d H:i:s'));
                })
                ->where(function ($query): void {
                    $query
                        ->whereNull('del_flag')
                        ->orWhere('del_flag', '<', 1);
                })
                ->orderBy('mtime')
                ->orderBy('videoId'),
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

        $available = Schema::getColumnListing($table);
        $desired = [
            'pk',
            'ctime',
            'mtime',
            'publishedAt',
            'videoId',
            'u_id',
            'actualStartTime',
            'scheduledStartTime',
            'concurrentViewers',
            'actualEndTime',
            'activeLiveChatId',
            'max_current',
            'del_flag',
        ];

        return collect($desired)
            ->filter(fn (string $column): bool => in_array($column, $available, true))
            ->values()
            ->all();
    }

    private function activeLiveRows(): int
    {
        return Schema::hasTable('urt_video_live')
            ? DB::table('urt_video_live')
                ->whereNull('actualEndTime')
                ->where(function ($query): void {
                    $query->whereNull('del_flag')->orWhere('del_flag', '<', 1);
                })
                ->count()
            : 0;
    }

    /**
     * @param  array<int, string>  $videoIds
     * @return Collection<string, object>
     */
    private function todayLogRows(array $videoIds, string $today): Collection
    {
        $videoIds = collect($videoIds)->filter()->unique()->values();

        if ($videoIds->isEmpty() || ! Schema::hasTable('urt_video_live_log')) {
            return collect();
        }

        return DB::table('urt_video_live_log')
            ->where('the_date', $today)
            ->whereIn('videoId', $videoIds->all())
            ->get(['pk', 'videoId', 'u_id', 'the_date', 'ctime', 'mtime', 'max_current', 'log_json'])
            ->keyBy('videoId');
    }

    /**
     * @param  array<int, string>  $videoIds
     * @return Collection<string, object>
     */
    private function displayRows(array $videoIds): Collection
    {
        $videoIds = collect($videoIds)->filter()->unique()->values();

        if ($videoIds->isEmpty() || ! Schema::hasTable('urt_show_video_live')) {
            return collect();
        }

        return DB::table('urt_show_video_live')
            ->whereIn('videoId', $videoIds->all())
            ->get(['videoId', 'channelTitle', 'title'])
            ->keyBy('videoId');
    }

    /**
     * @param  Collection<string, object>  $logRows
     * @param  Collection<string, object>  $displayRows
     * @return array<string, mixed>
     */
    private function mapRow(object $row, Collection $logRows, Collection $displayRows, string $today, CarbonImmutable $now): array
    {
        $videoId = (string) $row->videoId;
        $logRow = $logRows->get($videoId);
        $displayRow = $displayRows->get($videoId);
        $logArray = $logRow !== null ? json_decode((string) ($logRow->log_json ?? ''), true) : null;
        $logPoints = is_array($logArray) ? count($logArray) : 0;

        return [
            'pk' => $row->pk !== null ? (int) $row->pk : null,
            'video_id' => $videoId,
            'u_id' => $row->u_id !== null ? (int) $row->u_id : null,
            'title' => $displayRow?->title !== null ? (string) $displayRow->title : null,
            'channel_title' => $displayRow?->channelTitle !== null ? (string) $displayRow->channelTitle : null,
            'published_at' => $row->publishedAt !== null ? (string) $row->publishedAt : null,
            'mtime' => $row->mtime !== null ? (string) $row->mtime : null,
            'scheduled_start_time' => $row->scheduledStartTime !== null ? (string) $row->scheduledStartTime : null,
            'actual_start_time' => $row->actualStartTime !== null ? (string) $row->actualStartTime : null,
            'actual_end_time' => $row->actualEndTime !== null ? (string) $row->actualEndTime : null,
            'concurrent_viewers' => $row->concurrentViewers !== null ? (int) $row->concurrentViewers : null,
            'max_current' => $row->max_current !== null ? (int) $row->max_current : null,
            'today_log_exists' => $logRow !== null,
            'today_log_date' => $today,
            'today_log_points' => $logPoints,
            'today_log_max_current' => $logRow !== null && $logRow->max_current !== null ? (int) $logRow->max_current : null,
            'would_write_minute' => $now->format('H:i'),
            'would_update_live_row' => true,
            'would_upsert_log_if_concurrent_viewers' => true,
        ];
    }
}
