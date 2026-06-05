<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ChannelStatisticsPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(?int $uId = null, int $hours = 22, int $limit = 20, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(61, $limit));
        $expireTime = $now->subHours($hours);
        $reserveTime = $now->format('Y-m-d H:i:s');
        $isNullSweepHour = $now->format('H') === '23';

        [$source, $candidateQuery] = $this->candidateQuery(
            uId: $uId,
            expireTime: $expireTime,
            isNullSweepHour: $isNullSweepHour,
        );

        $eligibleRows = (clone $candidateQuery)->count();
        $channelRows = (clone $candidateQuery)
            ->limit($limit)
            ->get($this->columnsFor('urt_channel'))
            ->values();
        $countRows = $channelRows->isEmpty()
            ? collect()
            : DB::table('urt_count')
                ->whereIn('u_id', $channelRows->pluck('u_id')->all())
                ->get($this->columnsFor('urt_count'))
                ->keyBy('u_id');

        return [
            'mode' => 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $source,
            'target_u_id' => $uId,
            'hours' => $hours,
            'limit' => $limit,
            'expire_time' => $expireTime->format('Y-m-d H:i:s'),
            'null_sweep_hour' => $isNullSweepHour,
            'active_channels' => $this->activeChannels(),
            'unchecked_channels' => $this->uncheckedChannels(),
            'stale_channels' => $this->staleChannels($expireTime),
            'missing_log_channels' => $this->missingLogChannels(),
            'eligible_rows' => $eligibleRows,
            'selected_rows' => $channelRows->count(),
            'missing_youtube_id' => $channelRows
                ->filter(fn (object $row): bool => trim((string) ($row->youtube_id ?? '')) === '')
                ->count(),
            'would_call_api' => $channelRows->isNotEmpty(),
            'would_set_stime' => $channelRows->isNotEmpty() ? $reserveTime : null,
            'would_update_month' => $now->format('Y-m-01'),
            'would_update_date' => $now->toDateString(),
            'api_call_skipped' => 'YouTube Data API channels.list(statistics) is intentionally not called in planning mode',
            'stats_update_condition' => 'Execute mode updates urt_count and urt_channel only when the API viewCount is greater than 0',
            'writes_skipped' => [
                'urt_channel.stime reserve update',
                'urt_log monthly JSON insert/update',
                'urt_count viewCount/subscriberCount/videoCount update',
                'urt_channel viewCount/subscriberCount/videoCount update',
            ],
            'rows' => $channelRows
                ->map(fn (object $row): array => $this->mapRow($row, $countRows->get($row->u_id), $reserveTime))
                ->all(),
            'writes' => [],
        ];
    }

    /**
     * @return array{0: string, 1: \Illuminate\Database\Query\Builder}
     */
    private function candidateQuery(?int $uId, CarbonImmutable $expireTime, bool $isNullSweepHour): array
    {
        $base = DB::table('urt_channel')
            ->whereNull('flag_del');

        if ($uId !== null) {
            return [
                'single_channel',
                $base
                    ->where('u_id', $uId)
                    ->orderBy('u_id'),
            ];
        }

        return [
            $isNullSweepHour ? 'missing_log_or_stale_or_unchecked_at_23' : 'missing_log_or_stale_or_unchecked',
            $base
                ->where(function ($query) use ($expireTime): void {
                    $this->applyMissingLogCondition($query);
                    $query
                        ->orWhere(function ($staleQuery) use ($expireTime): void {
                            $staleQuery
                                ->where('stime', '<=', $expireTime->format('Y-m-d H:i:s'))
                                ->orWhereNull('stime');
                        });
                })
                ->when(Schema::hasTable('urt_log'), function ($query): void {
                    $query->orderByRaw($this->missingLogSortExpression());
                    if (Schema::hasColumn('urt_channel', 'viewCount')) {
                        $query->orderByRaw($this->missingLogViewSortExpression());
                    }
                })
                ->orderBy('stime')
                ->orderBy('u_id'),
        ];
    }

    /**
     * @return list<string>
     */
    private function columnsFor(string $table): array
    {
        $desired = $table === 'urt_channel'
            ? ['u_id', 'ctime', 'mtime', 'stime', 'flag_del', 'youtube_id', 'title', 'viewCount', 'subscriberCount', 'videoCount']
            : ['u_id', 'mtime', 'viewCount', 'subscriberCount', 'videoCount', 'view_week', 'sub_week', 'video_week', 'view_month', 'sub_month', 'video_month', 'tags'];

        if (! Schema::hasTable($table)) {
            return [];
        }

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

    private function uncheckedChannels(): int
    {
        return Schema::hasTable('urt_channel')
            ? DB::table('urt_channel')->whereNull('flag_del')->whereNull('stime')->count()
            : 0;
    }

    private function staleChannels(CarbonImmutable $expireTime): int
    {
        return Schema::hasTable('urt_channel')
            ? DB::table('urt_channel')
                ->whereNull('flag_del')
                ->whereNotNull('stime')
                ->where('stime', '<=', $expireTime->format('Y-m-d H:i:s'))
                ->count()
            : 0;
    }

    private function missingLogChannels(): int
    {
        if (! Schema::hasTable('urt_channel')) {
            return 0;
        }

        if (! Schema::hasTable('urt_log')) {
            return $this->activeChannels();
        }

        return DB::table('urt_channel')
            ->whereNull('flag_del')
            ->whereNotExists(function ($query): void {
                $query
                    ->selectRaw('1')
                    ->from('urt_log')
                    ->whereColumn('urt_log.u_id', 'urt_channel.u_id');
            })
            ->count();
    }

    /**
     * @param \Illuminate\Database\Query\Builder $query
     */
    private function applyMissingLogCondition($query): void
    {
        if (! Schema::hasTable('urt_log')) {
            $query->whereRaw('1 = 1');

            return;
        }

        $query->whereNotExists(function ($subQuery): void {
            $subQuery
                ->selectRaw('1')
                ->from('urt_log')
                ->whereColumn('urt_log.u_id', 'urt_channel.u_id');
        });
    }

    private function missingLogSortExpression(): string
    {
        return 'case when not exists (select 1 from urt_log where urt_log.u_id = urt_channel.u_id) then 0 else 1 end';
    }

    private function missingLogViewSortExpression(): string
    {
        return 'case when not exists (select 1 from urt_log where urt_log.u_id = urt_channel.u_id) then coalesce(urt_channel.viewCount, 0) else 0 end desc';
    }

    /**
     * @return array<string, mixed>
     */
    private function mapRow(object $row, ?object $countRow, string $reserveTime): array
    {
        return [
            'u_id' => (int) $row->u_id,
            'youtube_id' => (string) ($row->youtube_id ?? ''),
            'title' => $row->title !== null ? (string) $row->title : null,
            'mtime' => $row->mtime !== null ? (string) $row->mtime : null,
            'current_stime' => $row->stime !== null ? (string) $row->stime : null,
            'would_set_stime' => $reserveTime,
            'channel_counts' => [
                'viewCount' => $row->viewCount !== null ? (int) $row->viewCount : null,
                'subscriberCount' => $row->subscriberCount !== null ? (int) $row->subscriberCount : null,
                'videoCount' => $row->videoCount !== null ? (int) $row->videoCount : null,
            ],
            'count_table' => [
                'viewCount' => $countRow !== null && $countRow->viewCount !== null ? (int) $countRow->viewCount : null,
                'subscriberCount' => $countRow !== null && $countRow->subscriberCount !== null ? (int) $countRow->subscriberCount : null,
                'videoCount' => $countRow !== null && $countRow->videoCount !== null ? (int) $countRow->videoCount : null,
                'tags' => $countRow !== null && property_exists($countRow, 'tags') ? (string) ($countRow->tags ?? '') : '',
            ],
        ];
    }
}
