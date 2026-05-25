<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class VideoStatisticsPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(
        ?string $videoId = null,
        bool $today = false,
        int $batchSize = 50,
        int $loops = 1,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $videoId = is_string($videoId) && trim($videoId) !== '' ? trim($videoId) : null;
        $batchSize = max(1, min(50, $batchSize));
        $loops = max(1, min(31, $loops));
        $take = $batchSize * $loops;
        $threshold = (int) floor($batchSize * 0.8);
        $scheduleExpireTime = $now->subDays(210);
        $todayExpireTime = $now->subDays(7);
        $twoHoursAgo = $now->subHours(2);
        $reserveUntil = $now->addDays(30)->format('Y-m-d H:i:s');

        [$source, $candidateQuery] = $this->candidateQuery(
            videoId: $videoId,
            today: $today,
            scheduleExpireTime: $scheduleExpireTime,
            todayExpireTime: $todayExpireTime,
            twoHoursAgo: $twoHoursAgo,
            now: $now,
        );

        $eligibleRows = (clone $candidateQuery)->count();
        $rows = (clone $candidateQuery)
            ->limit($take)
            ->get($this->columnsFor($source))
            ->values();
        $firstBatchCount = min($rows->count(), $batchSize);
        $wouldCallApi = $videoId !== null || $firstBatchCount > $threshold;

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $source,
            'target_video_id' => $videoId,
            'today_mode' => $today,
            'batch_size' => $batchSize,
            'loops' => $loops,
            'legacy_threshold' => $threshold,
            'schedule_expire_time' => $scheduleExpireTime->format('Y-m-d H:i:s'),
            'today_expire_time' => $todayExpireTime->format('Y-m-d H:i:s'),
            'published_before' => $twoHoursAgo->format('Y-m-d H:i:s'),
            'schedule_total' => $this->countTable('urt_video_schedule'),
            'due_schedule_rows' => $this->dueScheduleRows($scheduleExpireTime, $twoHoursAgo, $now),
            'today_missing_rows' => $this->todayMissingRows($todayExpireTime, $twoHoursAgo),
            'eligible_rows' => $eligibleRows,
            'selected_rows' => $rows->count(),
            'first_batch_rows' => $firstBatchCount,
            'would_call_api' => $wouldCallApi,
            'would_reserve_until' => $wouldCallApi ? $reserveUntil : null,
            'would_update_month' => $now->format('Y-m-01'),
            'would_update_date' => $now->toDateString(),
            'api_call_skipped' => 'YouTube Data API videos.list(statistics) is intentionally not called in read-only mode',
            'writes_skipped' => [
                'urt_video_schedule.stime reserve update',
                'urt_video_log_history insert',
                'urt_video_schedule insert/update statistics',
                'urt_video_log monthly JSON insert/update',
                'urt_video statistics update',
            ],
            'rows' => $rows
                ->map(fn (object $row): array => $this->mapRow($row, $source, $reserveUntil))
                ->all(),
            'writes' => [],
        ];
    }

    /**
     * @return array{0: string, 1: \Illuminate\Database\Query\Builder}
     */
    private function candidateQuery(
        ?string $videoId,
        bool $today,
        CarbonImmutable $scheduleExpireTime,
        CarbonImmutable $todayExpireTime,
        CarbonImmutable $twoHoursAgo,
        CarbonImmutable $now,
    ): array {
        if ($videoId !== null) {
            return [
                'urt_video',
                DB::table('urt_video')
                    ->where('videoId', 'like', $videoId)
                    ->orderBy('videoId'),
            ];
        }

        if ($today) {
            return [
                'urt_video',
                DB::table('urt_video')
                    ->where('publishedAt', '>=', $todayExpireTime->format('Y-m-d H:i:s'))
                    ->where('publishedAt', '<', $twoHoursAgo->format('Y-m-d H:i:s'))
                    ->whereNull('viewCount')
                    ->orderBy('stime')
                    ->orderBy('videoId'),
            ];
        }

        return [
            'urt_video_schedule',
            DB::table('urt_video_schedule')
                ->where(function ($query) use ($now): void {
                    $query
                        ->where('stime', '<=', $now->format('Y-m-d H:i:s'))
                        ->orWhereNull('stime');
                })
                ->where('publishedAt', '>=', $scheduleExpireTime->format('Y-m-d H:i:s'))
                ->where('publishedAt', '<', $twoHoursAgo->format('Y-m-d H:i:s'))
                ->orderBy('stime')
                ->orderBy('videoId'),
        ];
    }

    /**
     * @return list<string>
     */
    private function columnsFor(string $table): array
    {
        $desired = $table === 'urt_video_schedule'
            ? ['pk', 'ctime', 'mtime', 'stime', 'videoId', 'publishedAt', 'viewCount', 'likeCount', 'commentCount']
            : ['pk', 'ctime', 'mtime', 'stime', 'u_id', 'videoId', 'title', 'channelTitle', 'publishedAt', 'viewCount', 'likeCount', 'commentCount'];
        $available = Schema::getColumnListing($table);

        return collect($desired)
            ->filter(fn (string $column): bool => in_array($column, $available, true))
            ->values()
            ->all();
    }

    private function countTable(string $table): int
    {
        return Schema::hasTable($table) ? DB::table($table)->count() : 0;
    }

    private function dueScheduleRows(CarbonImmutable $expireTime, CarbonImmutable $twoHoursAgo, CarbonImmutable $now): int
    {
        if (! Schema::hasTable('urt_video_schedule')) {
            return 0;
        }

        return DB::table('urt_video_schedule')
            ->where(function ($query) use ($now): void {
                $query
                    ->where('stime', '<=', $now->format('Y-m-d H:i:s'))
                    ->orWhereNull('stime');
            })
            ->where('publishedAt', '>=', $expireTime->format('Y-m-d H:i:s'))
            ->where('publishedAt', '<', $twoHoursAgo->format('Y-m-d H:i:s'))
            ->count();
    }

    private function todayMissingRows(CarbonImmutable $expireTime, CarbonImmutable $twoHoursAgo): int
    {
        if (! Schema::hasTable('urt_video')) {
            return 0;
        }

        return DB::table('urt_video')
            ->where('publishedAt', '>=', $expireTime->format('Y-m-d H:i:s'))
            ->where('publishedAt', '<', $twoHoursAgo->format('Y-m-d H:i:s'))
            ->whereNull('viewCount')
            ->count();
    }

    /**
     * @return array<string, mixed>
     */
    private function mapRow(object $row, string $source, string $reserveUntil): array
    {
        return [
            'source' => $source,
            'pk' => $this->value($row, 'pk') !== null ? (int) $this->value($row, 'pk') : null,
            'video_id' => (string) ($this->value($row, 'videoId') ?? ''),
            'u_id' => $this->value($row, 'u_id') !== null ? (int) $this->value($row, 'u_id') : null,
            'title' => $this->value($row, 'title') !== null ? (string) $this->value($row, 'title') : null,
            'channel_title' => $this->value($row, 'channelTitle') !== null ? (string) $this->value($row, 'channelTitle') : null,
            'published_at' => $this->value($row, 'publishedAt') !== null ? (string) $this->value($row, 'publishedAt') : null,
            'mtime' => $this->value($row, 'mtime') !== null ? (string) $this->value($row, 'mtime') : null,
            'current_stime' => $this->value($row, 'stime') !== null ? (string) $this->value($row, 'stime') : null,
            'current_view_count' => $this->value($row, 'viewCount') !== null ? (int) $this->value($row, 'viewCount') : null,
            'current_like_count' => $this->value($row, 'likeCount') !== null ? (int) $this->value($row, 'likeCount') : null,
            'current_comment_count' => $this->value($row, 'commentCount') !== null ? (int) $this->value($row, 'commentCount') : null,
            'would_set_stime' => $reserveUntil,
        ];
    }

    private function value(object $row, string $column): mixed
    {
        return property_exists($row, $column) ? $row->{$column} : null;
    }
}
