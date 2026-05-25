<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

class LiveCleanupPreview
{
    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     too_soon: string,
     *     scheduled_before: string,
     *     candidates: int,
     *     would_mark_deleted: int,
     *     grace_rows: int,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    public function staleLivePreview(int $limit = 20, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(200, $limit));
        $tooSoon = $now->subMinutes(40);
        $scheduledBefore = $now->subHours(2);
        $deleteBefore = $now->subHour();

        $base = DB::table('urt_video_live')
            ->where(function ($query) use ($tooSoon): void {
                $query->whereNull('mtime')->orWhere('mtime', '<', $tooSoon->format('Y-m-d H:i:s'));
            })
            ->whereNull('actualEndTime')
            ->where(function ($query) use ($scheduledBefore): void {
                $query->whereNull('scheduledStartTime')->orWhere('scheduledStartTime', '<', $scheduledBefore->format('Y-m-d H:i:s'));
            })
            ->whereNull('del_flag')
            ->where('ctime', '<', $now->format('Y-m-d H:i:s'));

        $candidates = (clone $base)->count();
        $wouldMarkDeletedQuery = (clone $base)
            ->where(function ($query) use ($deleteBefore): void {
                $query->whereNull('mtime')->orWhere('mtime', '<', $deleteBefore->format('Y-m-d H:i:s'));
            });
        $wouldMarkDeleted = (clone $wouldMarkDeletedQuery)->count();

        $rows = (clone $wouldMarkDeletedQuery)
            ->select(['pk', 'videoId', 'ctime', 'mtime', 'scheduledStartTime', 'actualEndTime', 'concurrentViewers', 'max_current'])
            ->orderBy('mtime')
            ->orderBy('videoId')
            ->limit($limit)
            ->get()
            ->map(fn (object $row): array => [
                'pk' => (int) $row->pk,
                'video_id' => (string) $row->videoId,
                'ctime' => $row->ctime !== null ? (string) $row->ctime : null,
                'mtime' => $row->mtime !== null ? (string) $row->mtime : null,
                'scheduled_start_time' => $row->scheduledStartTime !== null ? (string) $row->scheduledStartTime : null,
                'actual_end_time' => $row->actualEndTime !== null ? (string) $row->actualEndTime : null,
                'concurrent_viewers' => $row->concurrentViewers !== null ? (int) $row->concurrentViewers : null,
                'max_current' => $row->max_current !== null ? (int) $row->max_current : null,
                'legacy_action' => 'would update urt_video_live set del_flag=1',
            ])
            ->values()
            ->all();

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'too_soon' => $tooSoon->format('Y-m-d H:i:s'),
            'scheduled_before' => $scheduledBefore->format('Y-m-d H:i:s'),
            'candidates' => $candidates,
            'would_mark_deleted' => $wouldMarkDeleted,
            'grace_rows' => $candidates - $wouldMarkDeleted,
            'rows' => $rows,
            'writes' => [],
        ];
    }

    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     total_rows: int,
     *     would_delete: int,
     *     retained_rows: int,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    public function tagDateCachePreview(int $limit = 20, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(200, $limit));

        $rows = DB::table('urt_show_live_tag_date')
            ->select(['pk', 'ctime', 'the_date', 'tagid', 'tag_or', 'tag_not', 'count_channels', 'count_videos', 'tags_count', 'total_views'])
            ->orderByDesc('ctime')
            ->get();

        $wouldDelete = $rows
            ->filter(fn (object $row): bool => $this->legacyDeletesTagDateCacheRow($row, $timezone))
            ->values();

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'total_rows' => $rows->count(),
            'would_delete' => $wouldDelete->count(),
            'retained_rows' => $rows->count() - $wouldDelete->count(),
            'rows' => $wouldDelete
                ->take($limit)
                ->map(fn (object $row): array => [
                    'pk' => (int) $row->pk,
                    'ctime' => (string) $row->ctime,
                    'the_date' => (string) $row->the_date,
                    'tagid' => $row->tagid !== null ? (string) $row->tagid : null,
                    'tag_or' => $row->tag_or !== null ? (string) $row->tag_or : null,
                    'tag_not' => $row->tag_not !== null ? (string) $row->tag_not : null,
                    'count_channels' => $row->count_channels !== null ? (int) $row->count_channels : null,
                    'count_videos' => $row->count_videos !== null ? (int) $row->count_videos : null,
                    'tags_count' => $row->tags_count !== null ? (int) $row->tags_count : null,
                    'total_views' => $row->total_views !== null ? (int) $row->total_views : null,
                    'legacy_action' => 'would delete from urt_show_live_tag_date',
                ])
                ->values()
                ->all(),
            'writes' => [],
        ];
    }

    private function legacyDeletesTagDateCacheRow(object $row, string $timezone): bool
    {
        if ($row->ctime === null || $row->the_date === null) {
            return false;
        }

        $cacheDate = CarbonImmutable::parse((string) $row->the_date, $timezone)->startOfDay();
        $deleteCutoff = CarbonImmutable::parse((string) $row->ctime, $timezone)->subDays(2);

        return $cacheDate->greaterThan($deleteCutoff);
    }
}
