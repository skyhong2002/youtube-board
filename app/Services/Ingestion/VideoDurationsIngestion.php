<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Throwable;

class VideoDurationsIngestion
{
    public function __construct(
        private readonly VideoDurationsPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $videoId = null,
        int $batchSize = 1,
        int $loops = 1,
        bool $enqueueMissing = false,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $batchSize = max(1, min(50, $batchSize));
        $loops = max(1, min(20, $loops));
        $preview = $this->preview->preview(
            videoId: $videoId,
            batchSize: $batchSize,
            loops: $loops,
            now: $now,
        );
        $rows = collect($preview['rows'] ?? [])
            ->filter(fn (array $row): bool => trim((string) ($row['video_id'] ?? '')) !== '')
            ->values();
        $queued = [];

        if ($enqueueMissing) {
            $capacity = max(0, ($batchSize * $loops) - $rows->count());
            $queued = [];

            if ($rows->isEmpty() && is_string($videoId) && trim($videoId) !== '') {
                $queued = $this->enqueueMissingVideo(trim($videoId), $now);
            } elseif ($videoId === null && $capacity > 0) {
                $queued = $this->enqueueMissingVideos($capacity, $now);
            }

            if ($queued !== []) {
                $preview = $this->preview->preview(
                    videoId: $videoId,
                    batchSize: $batchSize,
                    loops: $loops,
                    now: $now,
                );
                $rows = collect($preview['rows'] ?? [])
                    ->filter(fn (array $row): bool => trim((string) ($row['video_id'] ?? '')) !== '')
                    ->values();
            }
        }

        if (! (bool) ($preview['would_call_api'] ?? false) || $rows->isEmpty()) {
            return $this->summary($preview, [], [], $queued, $now);
        }

        try {
            $detailsByVideo = $this->youtube->videoContentDetails(
                $rows->pluck('video_id')->map(fn (mixed $id): string => (string) $id)->all(),
            );
        } catch (YoutubeQuotaWindowException $exception) {
            $skipped = $rows->map(fn (array $row): array => [
                'videoId' => (string) $row['video_id'],
                'reason' => 'quota_window_reset',
            ])->all();
            Log::warning('Video duration polling paused at quota window reset.', [
                'reason' => 'quota_window_reset',
                'selected_rows' => $rows->count(),
                'exception_class' => $exception::class,
            ]);

            return $this->summary($preview, [], $skipped, $queued, $now, true, $rows->count());
        }
        $applied = [];
        $skipped = [];

        foreach ($rows as $row) {
            $rowVideoId = (string) $row['video_id'];

            try {
                $details = $detailsByVideo[$rowVideoId] ?? null;

                if ($details === null || $details['durationSeconds'] === null) {
                    $skipped[] = [
                        'videoId' => $rowVideoId,
                        'reason' => $details === null ? 'api_item_missing' : 'duration_missing',
                    ];

                    continue;
                }

                DB::transaction(function () use ($rowVideoId, $details, $now): void {
                    $this->updateDuration($rowVideoId, $details, $now);
                });

                $applied[] = [
                    'videoId' => $rowVideoId,
                    'duration' => $details['duration'],
                    'durationSeconds' => $details['durationSeconds'],
                    'caption' => $details['caption'],
                ];
            } catch (Throwable $exception) {
                $skipped[] = [
                    'videoId' => $rowVideoId,
                    'reason' => 'item_processing_failed',
                ];
                Log::warning('Video duration item processing failed.', [
                    'video_id' => $rowVideoId,
                    'reason' => 'item_processing_failed',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        return $this->summary($preview, $applied, $skipped, $queued, $now);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function enqueueMissingVideo(string $videoId, CarbonImmutable $now): array
    {
        if (! Schema::hasTable('urt_video_duration')) {
            throw new RuntimeException('Missing local table: urt_video_duration');
        }

        if (DB::table('urt_video_duration')->where('videoId', $videoId)->exists()) {
            return [];
        }

        $video = Schema::hasTable('urt_video')
            ? DB::table('urt_video')->where('videoId', $videoId)->first()
            : null;

        if ($video === null) {
            return [];
        }

        $insert = $this->onlyExistingColumns('urt_video_duration', [
            'ctime' => $now->format('Y-m-d H:i:s'),
            'mtime' => null,
            'stime' => null,
            'publishedAt' => $video->publishedAt ?? null,
            'u_id' => $video->u_id ?? null,
            'videoId' => $videoId,
            'duration' => null,
            'caption' => null,
        ]);

        if (Schema::hasColumn('urt_video_duration', 'pk_video') && ! array_key_exists('pk_video', $insert)) {
            $insert['pk_video'] = ((int) DB::table('urt_video_duration')->max('pk_video')) + 1;
        }

        DB::table('urt_video_duration')->insert($insert);

        return [[
            'videoId' => $videoId,
            'source' => 'urt_video',
        ]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function enqueueMissingVideos(int $limit, CarbonImmutable $now): array
    {
        if (! Schema::hasTable('urt_video_duration')) {
            throw new RuntimeException('Missing local table: urt_video_duration');
        }

        if (! Schema::hasTable('urt_video')) {
            return [];
        }

        $limit = max(1, min(50, $limit));
        $columns = Schema::getColumnListing('urt_video');
        $select = collect(['videoId', 'publishedAt', 'u_id'])
            ->filter(fn (string $column): bool => in_array($column, $columns, true))
            ->map(fn (string $column): string => 'v.'.$column)
            ->values()
            ->all();

        if (! in_array('v.videoId', $select, true)) {
            return [];
        }

        $query = DB::table('urt_video as v')
            ->leftJoin('urt_video_duration as d', function ($join): void {
                $join->on(
                    DB::raw($this->videoIdJoinExpression('d')),
                    '=',
                    DB::raw($this->videoIdJoinExpression('v')),
                );
            })
            ->whereNull('d.videoId')
            ->whereNotNull('v.videoId')
            ->where('v.videoId', '!=', '')
            ->limit($limit);

        if (in_array('publishedAt', $columns, true)) {
            $query->orderByDesc('v.publishedAt');
        }

        $videos = $query->get($select);
        $queued = [];
        $nextPk = Schema::hasColumn('urt_video_duration', 'pk_video')
            ? ((int) DB::table('urt_video_duration')->max('pk_video')) + 1
            : null;

        foreach ($videos as $video) {
            $rowVideoId = trim((string) ($video->videoId ?? ''));

            if ($rowVideoId === '' || DB::table('urt_video_duration')->where('videoId', $rowVideoId)->exists()) {
                continue;
            }

            $insert = $this->onlyExistingColumns('urt_video_duration', [
                'ctime' => $now->format('Y-m-d H:i:s'),
                'mtime' => null,
                'stime' => null,
                'publishedAt' => $video->publishedAt ?? null,
                'u_id' => $video->u_id ?? null,
                'videoId' => $rowVideoId,
                'duration' => null,
                'caption' => null,
            ]);

            if ($nextPk !== null && ! array_key_exists('pk_video', $insert)) {
                $insert['pk_video'] = $nextPk++;
            }

            DB::table('urt_video_duration')->insert($insert);

            $queued[] = [
                'videoId' => $rowVideoId,
                'source' => 'urt_video_missing_duration',
            ];
        }

        return $queued;
    }

    /**
     * @param  array{duration: string|null, durationSeconds: int|null, caption: string|null}  $details
     */
    private function updateDuration(string $videoId, array $details, CarbonImmutable $now): void
    {
        if (! Schema::hasTable('urt_video_duration')) {
            throw new RuntimeException('Missing local table: urt_video_duration');
        }

        $values = $this->onlyExistingColumns('urt_video_duration', [
            'mtime' => $now->format('Y-m-d H:i:s'),
            'stime' => $now->format('Y-m-d H:i:s'),
            'duration' => $details['durationSeconds'],
            'caption' => $details['caption'],
        ]);

        if ($values === []) {
            return;
        }

        DB::table('urt_video_duration')
            ->where('videoId', $videoId)
            ->update($values);
    }

    private function videoIdJoinExpression(string $alias): string
    {
        $column = $alias.'.videoId';

        return DB::connection()->getDriverName() === 'mysql'
            ? 'BINARY '.$column
            : $column;
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

    /**
     * @param  array<string, mixed>  $preview
     * @param  list<array<string, mixed>>  $applied
     * @param  list<array<string, mixed>>  $skipped
     * @return array<string, mixed>
     */
    private function summary(
        array $preview,
        array $applied,
        array $skipped,
        array $queued,
        CarbonImmutable $now,
        bool $quotaWindowReset = false,
        int $remainingRetryRows = 0,
    ): array {
        $failedVideos = collect($skipped)->whereIn('reason', ['item_processing_failed', 'quota_window_reset'])->count();
        $writeTargets = [
            'urt_video_duration.mtime',
            'urt_video_duration.stime',
            'urt_video_duration.duration',
            'urt_video_duration.caption',
        ];

        if ($queued !== []) {
            array_unshift(
                $writeTargets,
                'urt_video_duration.ctime',
                'urt_video_duration.publishedAt',
                'urt_video_duration.u_id',
                'urt_video_duration.videoId',
            );
        }

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'queued_videos' => count($queued),
            'api_requested_videos' => count($applied) + count($skipped),
            'updated_videos' => count($applied),
            'skipped_videos' => count($skipped),
            'failed_videos' => $failedVideos,
            'quota_window_reset' => $quotaWindowReset,
            'remaining_retry_rows' => $remainingRetryRows,
            'exit_code' => $failedVideos > 0 || $quotaWindowReset ? 1 : 0,
            'write_targets' => $writeTargets,
            'external_calls' => ['YouTube Data API videos.list(part=contentDetails)'],
            'queued' => $queued,
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }
}
