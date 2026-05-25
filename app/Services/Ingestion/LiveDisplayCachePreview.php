<?php

namespace App\Services\Ingestion;

use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

class LiveDisplayCachePreview
{
    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     expire_time: string,
     *     hours: int,
     *     candidates: int,
     *     already_cached: int,
     *     would_insert: int,
     *     missing_video_metadata: int,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    public function preview(int $hours = 2, int $limit = 20, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now?->copy()->setTimezone($timezone) ?? now($timezone);
        $hours = max(1, min(720, $hours));
        $limit = max(1, min(100, $limit));
        $expireTime = $now->copy()->subHours($hours)->format('Y-m-d H:i:s');
        $generatedAt = $now->format('Y-m-d H:i:s');

        $base = DB::table('urt_video_live as live')
            ->where('live.ctime', '>', $expireTime);

        $missingCache = (clone $base)
            ->leftJoin('urt_show_video_live as show', 'show.pk_live', '=', 'live.pk')
            ->whereNull('show.pk_live');

        $candidateCount = (clone $base)->count();
        $alreadyCached = (clone $base)
            ->join('urt_show_video_live as show', 'show.pk_live', '=', 'live.pk')
            ->count();
        $wouldInsert = $this->joinVideo((clone $missingCache))
            ->count();
        $missingVideoMetadata = $this->leftJoinVideo((clone $missingCache))
            ->whereNull('video.pk')
            ->count();

        $rows = $this->joinVideo((clone $missingCache))
            ->select([
                'live.pk as pk_live',
                'live.videoId',
                'live.u_id as live_u_id',
                'live.ctime as live_created_at',
                'live.publishedAt as live_published_at',
                'video.pk as v_pk',
                'video.u_id as video_u_id',
                'video.publishedAt as video_published_at',
                'video.channelId',
                'video.channelTitle',
                'video.title',
                'video.thumbnails',
            ])
            ->orderByDesc('live.ctime')
            ->limit($limit)
            ->get()
            ->map(fn (object $row): array => [
                'pk_live' => (int) $row->pk_live,
                'video_id' => (string) $row->videoId,
                'v_pk' => (int) $row->v_pk,
                'u_id' => (int) ($row->video_u_id ?? $row->live_u_id),
                'live_created_at' => (string) $row->live_created_at,
                'published_at' => (string) ($row->video_published_at ?? $row->live_published_at),
                'channel_id' => (string) $row->channelId,
                'channel_title' => (string) $row->channelTitle,
                'title' => (string) $row->title,
                'thumbnail' => (string) $row->thumbnails,
            ])
            ->values()
            ->all();

        return [
            'mode' => 'read-only-preview',
            'generated_at' => $generatedAt,
            'expire_time' => $expireTime,
            'hours' => $hours,
            'candidates' => $candidateCount,
            'already_cached' => $alreadyCached,
            'would_insert' => $wouldInsert,
            'missing_video_metadata' => $missingVideoMetadata,
            'rows' => $rows,
            'writes' => [],
        ];
    }

    private function joinVideo($query)
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            return $query->join(
                'urt_video as video',
                DB::raw('video.videoId COLLATE utf8mb4_uca1400_ai_ci'),
                '=',
                'live.videoId',
            );
        }

        return $query->join('urt_video as video', 'video.videoId', '=', 'live.videoId');
    }

    private function leftJoinVideo($query)
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            return $query->leftJoin(
                'urt_video as video',
                DB::raw('video.videoId COLLATE utf8mb4_uca1400_ai_ci'),
                '=',
                'live.videoId',
            );
        }

        return $query->leftJoin('urt_video as video', 'video.videoId', '=', 'live.videoId');
    }
}
