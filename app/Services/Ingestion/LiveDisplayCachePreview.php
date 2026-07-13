<?php

namespace App\Services\Ingestion;

use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

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
     *     writes: int|list<string>,
     *     cache_writes: int,
     *     skipped_rows: int,
     *     failed_rows: int,
     *     skipped: list<array{pk_live: int, reason: string}>,
     *     write_targets: list<string>
     * }
     */
    public function preview(int $hours = 2, int $limit = 20, ?CarbonInterface $now = null, bool $execute = false): array
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
                'video.description',
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
                'description' => (string) $row->description,
            ])
            ->values()
            ->all();

        $writeResult = $execute && $rows !== []
            ? $this->writeRows($rows, $generatedAt)
            : ['written' => 0, 'skipped' => []];

        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $generatedAt,
            'expire_time' => $expireTime,
            'hours' => $hours,
            'candidates' => $candidateCount,
            'already_cached' => $alreadyCached,
            'would_insert' => $wouldInsert,
            'missing_video_metadata' => $missingVideoMetadata,
            'rows' => $rows,
            'writes' => $execute ? $writeResult['written'] : [],
            'cache_writes' => $execute ? $writeResult['written'] : 0,
            'skipped_rows' => count($writeResult['skipped']),
            'failed_rows' => count($writeResult['skipped']),
            'skipped' => $writeResult['skipped'],
            'write_targets' => $execute ? ['urt_show_video_live'] : [],
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{written: int, skipped: list<array{pk_live: int, reason: string}>}
     */
    private function writeRows(array $rows, string $generatedAt): array
    {
        $written = 0;
        $skipped = [];

        foreach ($rows as $row) {
            try {
                DB::transaction(function () use ($row, $generatedAt): void {
                    $values = $this->onlyExistingColumns('urt_show_video_live', [
                        'ctime' => $generatedAt,
                        'mtime' => $generatedAt,
                        'pk_live' => (int) $row['pk_live'],
                        'v_pk' => (int) $row['v_pk'],
                        'videoId' => (string) $row['video_id'],
                        'u_id' => (int) $row['u_id'],
                        'publishedAt' => (string) $row['published_at'],
                        'channelId' => (string) $row['channel_id'],
                        'channelTitle' => (string) $row['channel_title'],
                        'title' => (string) $row['title'],
                        'thumbnails' => (string) $row['thumbnail'],
                        'description' => (string) $row['description'],
                    ]);

                    $query = DB::table('urt_show_video_live');

                    if (Schema::hasColumn('urt_show_video_live', 'pk_live')) {
                        $query->where('pk_live', (int) $row['pk_live']);
                    } else {
                        $query->where('videoId', (string) $row['video_id']);
                    }

                    if ((clone $query)->exists()) {
                        $query->update($values);

                        return;
                    }

                    DB::table('urt_show_video_live')->insert($values);
                });
                $written++;
            } catch (Throwable $exception) {
                $skipped[] = [
                    'pk_live' => (int) $row['pk_live'],
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('Live display cache item processing failed.', [
                    'pk_live' => (int) $row['pk_live'],
                    'reason' => 'item_processing_failed',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        return ['written' => $written, 'skipped' => $skipped];
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

    /**
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function onlyExistingColumns(string $table, array $values): array
    {
        $columns = Schema::getColumnListing($table);

        return collect($values)
            ->filter(fn (mixed $value, string $column): bool => in_array($column, $columns, true))
            ->all();
    }
}
