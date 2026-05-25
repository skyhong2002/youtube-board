<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class TvbsChannelVideosDiscoveryIngestion
{
    public function __construct(
        private readonly TvbsChannelVideosDiscoveryPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        int $tagId = 29,
        ?int $uId = null,
        ?string $channel = null,
        int $hours = 700,
        int $force = 1,
        int $limit = 1,
        int $maxResults = 5,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(3, $limit));
        $maxResults = max(1, min(50, $maxResults));
        $preview = $this->preview->preview(
            tagId: $tagId,
            uId: $uId,
            channel: $channel,
            hours: $hours,
            force: $force,
            limit: $limit,
            now: $now,
        );

        $applied = [];
        $skipped = [];

        foreach ($preview['rows'] ?? [] as $row) {
            $uploads = trim((string) ($row['uploads'] ?? ''));
            $rowUId = (int) ($row['u_id'] ?? 0);

            if ($rowUId < 1 || $uploads === '') {
                $skipped[] = [
                    'u_id' => $rowUId,
                    'uploads' => $uploads,
                    'reason' => 'missing_uploads_playlist',
                ];

                continue;
            }

            $items = $this->youtube->playlistItems($uploads, $maxResults);
            $result = DB::transaction(function () use ($rowUId, $items, $now): array {
                return $this->upsertChannelItems($rowUId, $items, $now);
            });

            $applied[] = [
                'u_id' => $rowUId,
                'uploads' => $uploads,
                'api_items' => count($items),
                'video_upserts' => $result['video_upserts'],
                'schedule_upserts' => $result['schedule_upserts'],
                'tvbs_live_upserts' => $result['tvbs_live_upserts'],
                'week_count' => $result['week_count'],
            ];
        }

        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'api_requested_channels' => count($applied),
            'api_max_results_per_channel' => $maxResults,
            'updated_channels' => count($applied),
            'skipped_channels' => count($skipped),
            'write_targets' => [
                'urt_video.ctime',
                'urt_video.id',
                'urt_video.publishedAt',
                'urt_video.channelId',
                'urt_video.title',
                'urt_video.thumbnails',
                'urt_video.channelTitle',
                'urt_video.playlistId',
                'urt_video.position',
                'urt_video.videoId',
                'urt_video.u_id',
                'urt_video.description',
                'urt_video_schedule.ctime',
                'urt_video_schedule.videoId',
                'urt_video_schedule.publishedAt',
                'urt_video_live_tvbs.ctime',
                'urt_video_live_tvbs.videoId',
                'urt_video_live_tvbs.publishedAt',
                'urt_video_live_tvbs.u_id',
            ],
            'external_calls' => ['YouTube Data API playlistItems.list(part=snippet)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return array{video_upserts: int, schedule_upserts: int, tvbs_live_upserts: int, week_count: int}
     */
    private function upsertChannelItems(int $uId, array $items, CarbonImmutable $now): array
    {
        $nowString = $now->format('Y-m-d H:i:s');
        $weekStart = $now->subDays(7);
        $videoUpserts = 0;
        $scheduleUpserts = 0;
        $tvbsLiveUpserts = 0;
        $weekCount = 0;

        foreach ($items as $item) {
            $publishedAt = $this->parsePublishedAt($item['publishedAt'] ?? null, $now);

            if ($publishedAt->greaterThanOrEqualTo($weekStart)) {
                $weekCount++;
            }

            $videoId = (string) ($item['videoId'] ?? '');

            if ($videoId === '') {
                continue;
            }

            $this->upsertByKeys('urt_video', ['videoId' => $videoId], [
                'ctime' => $nowString,
                'id' => (string) ($item['id'] ?? ''),
                'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                'channelId' => (string) ($item['channelId'] ?? ''),
                'title' => (string) ($item['title'] ?? ''),
                'thumbnails' => (string) ($item['thumbnails'] ?? ''),
                'channelTitle' => (string) ($item['channelTitle'] ?? ''),
                'playlistId' => (string) ($item['playlistId'] ?? ''),
                'position' => (int) ($item['position'] ?? 0),
                'u_id' => $uId,
                'description' => (string) ($item['description'] ?? ''),
            ]);
            $videoUpserts++;

            $this->upsertByKeys('urt_video_schedule', ['videoId' => $videoId], [
                'ctime' => $nowString,
                'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
            ]);
            $scheduleUpserts++;

            if ($this->isLiveCandidate($item)) {
                $this->upsertByKeys('urt_video_live_tvbs', ['videoId' => $videoId], [
                    'ctime' => $nowString,
                    'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                    'u_id' => $uId,
                ]);
                $tvbsLiveUpserts++;
            }
        }

        return [
            'video_upserts' => $videoUpserts,
            'schedule_upserts' => $scheduleUpserts,
            'tvbs_live_upserts' => $tvbsLiveUpserts,
            'week_count' => $weekCount,
        ];
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function isLiveCandidate(array $item): bool
    {
        $broadcast = (string) ($item['liveBroadcastContent'] ?? '');
        $thumbnail = (string) ($item['thumbnails'] ?? '');

        return in_array($broadcast, ['live', 'upcoming'], true)
            || str_contains($thumbnail, 'default_live.jpg');
    }

    private function parsePublishedAt(mixed $publishedAt, CarbonImmutable $now): CarbonImmutable
    {
        if (! is_string($publishedAt) || trim($publishedAt) === '') {
            return $now;
        }

        return CarbonImmutable::parse($publishedAt)->setTimezone($now->getTimezone());
    }

    /**
     * @param  array<string, mixed>  $keys
     * @param  array<string, mixed>  $values
     */
    private function upsertByKeys(string $table, array $keys, array $values): void
    {
        if (! Schema::hasTable($table)) {
            throw new RuntimeException("Missing local table: {$table}");
        }

        $keys = $this->onlyExistingColumns($table, $keys);
        $values = $this->onlyExistingColumns($table, $values);

        if ($keys === []) {
            throw new RuntimeException("No usable key columns for {$table}");
        }

        $query = DB::table($table);

        foreach ($keys as $column => $value) {
            $query->where($column, $value);
        }

        if ((clone $query)->exists()) {
            if ($values !== []) {
                $query->update($values);
            }

            return;
        }

        $insert = $keys + $values;

        if (Schema::hasColumn($table, 'pk') && ! array_key_exists('pk', $insert)) {
            $insert['pk'] = ((int) DB::table($table)->max('pk')) + 1;
        }

        DB::table($table)->insert($insert);
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
