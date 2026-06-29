<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class VideoDurationsPreview
{
    /**
     * @return array<string, mixed>
     */
    public function preview(?string $videoId = null, int $batchSize = 50, int $loops = 1, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $videoId = is_string($videoId) && trim($videoId) !== '' ? trim($videoId) : null;
        $batchSize = max(1, min(50, $batchSize));
        $loops = max(1, min(20, $loops));
        $take = $batchSize * $loops;
        $threshold = (int) floor($batchSize * 0.2);
        $nextTime = $now->addDays(30)->format('Y-m-d H:i:s');

        $readyQuery = DB::table('urt_video_duration')
            ->whereNull('mtime')
            ->whereNull('duration')
            ->whereNull('stime');

        if ($videoId !== null) {
            $readyQuery->where('videoId', $videoId);
        }

        $readyRows = (clone $readyQuery)
            ->orderBy('pk_video')
            ->limit($take)
            ->get(['pk_video', 'ctime', 'publishedAt', 'u_id', 'videoId', 'stime', 'mtime', 'duration', 'caption']);

        $readyTotal = (clone $readyQuery)->count();
        $queueTotal = DB::table('urt_video_duration')->count();
        $completedRows = DB::table('urt_video_duration')
            ->whereNotNull('duration')
            ->count();
        $reservedRows = DB::table('urt_video_duration')
            ->whereNull('duration')
            ->whereNull('mtime')
            ->whereNotNull('stime')
            ->count();
        $failedOrMissingRows = DB::table('urt_video_duration')
            ->whereNull('duration')
            ->whereNotNull('mtime')
            ->count();
        $unqueuedMissingVideos = $this->unqueuedMissingVideos();
        $videoMetadata = $this->videoMetadata($readyRows->pluck('videoId')->all());
        $wouldCallApi = $videoId !== null || $readyRows->count() > $threshold;

        return [
            'mode' => 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'target_video_id' => $videoId,
            'batch_size' => $batchSize,
            'loops' => $loops,
            'legacy_threshold' => $threshold,
            'queue_total' => $queueTotal,
            'ready_queue_rows' => $readyTotal,
            'selected_rows' => $readyRows->count(),
            'completed_rows' => $completedRows,
            'reserved_rows' => $reservedRows,
            'failed_or_missing_rows' => $failedOrMissingRows,
            'unqueued_missing_videos' => $unqueuedMissingVideos,
            'would_call_api' => $wouldCallApi,
            'would_reserve_until' => $wouldCallApi ? $nextTime : null,
            'api_call_skipped' => 'YouTube Data API videos.list(contentDetails) is intentionally not called in planning mode',
            'queue_update_skipped' => '`urt_video_duration.stime`, `mtime`, `duration`, and `caption` are intentionally not updated',
            'rows' => $readyRows
                ->map(function (object $row) use ($videoMetadata, $nextTime): array {
                    $videoId = (string) $row->videoId;
                    $metadata = $videoMetadata[$videoId] ?? [];

                    return [
                        'pk_video' => (int) $row->pk_video,
                        'video_id' => $videoId,
                        'u_id' => $row->u_id !== null ? (int) $row->u_id : null,
                        'published_at' => $row->publishedAt !== null ? (string) $row->publishedAt : null,
                        'ctime' => (string) $row->ctime,
                        'title' => $metadata['title'] ?? null,
                        'channel_title' => $metadata['channel_title'] ?? null,
                        'would_set_stime' => $nextTime,
                    ];
                })
                ->values()
                ->all(),
            'writes' => [],
        ];
    }

    private function unqueuedMissingVideos(): ?int
    {
        if (! Schema::hasTable('urt_video') || ! Schema::hasTable('urt_video_duration')) {
            return null;
        }

        try {
            return DB::table('urt_video as v')
                ->leftJoin('urt_video_duration as d', function ($join): void {
                    $join->on(
                        DB::raw($this->videoIdJoinExpression('d')),
                        '=',
                        DB::raw($this->videoIdJoinExpression('v')),
                    );
                })
                ->whereNull('d.videoId')
                ->count();
        } catch (\Throwable) {
            return null;
        }
    }

    private function videoIdJoinExpression(string $alias): string
    {
        $column = $alias.'.videoId';

        return DB::connection()->getDriverName() === 'mysql'
            ? 'BINARY '.$column
            : $column;
    }

    /**
     * @param  list<string>  $videoIds
     * @return array<string, array{title: string, channel_title: string}>
     */
    private function videoMetadata(array $videoIds): array
    {
        $videoIds = collect($videoIds)
            ->filter(fn (mixed $id): bool => is_string($id) && $id !== '')
            ->unique()
            ->values()
            ->all();

        if ($videoIds === [] || ! Schema::hasTable('urt_video')) {
            return [];
        }

        return DB::table('urt_video')
            ->whereIn('videoId', $videoIds)
            ->get(['videoId', 'title', 'channelTitle'])
            ->mapWithKeys(fn (object $row): array => [
                (string) $row->videoId => [
                    'title' => (string) $row->title,
                    'channel_title' => (string) $row->channelTitle,
                ],
            ])
            ->all();
    }
}
