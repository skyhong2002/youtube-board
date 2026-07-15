<?php

namespace App\Services\Ingestion;

use App\Support\SensitiveTextRedactor;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use DateTimeImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

class TagVideoBackfillIngestion
{
    public function __construct(
        private readonly YoutubeDataApiClient $youtube,
        private readonly TagDateCacheBuilder $tagDateCacheBuilder,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function run(
        array $tagIds,
        array $orTagIds = [],
        array $notTagIds = [],
        ?string $from = null,
        ?string $to = null,
        int $days = 2,
        int $limit = 100,
        int $maxPages = 20,
        int $maxResults = 50,
        int $keywordLimit = 5000,
        bool $rebuildTagDate = true,
        bool $execute = false,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $tagIds = $this->normalizedIds($tagIds);
        $orTagIds = $this->normalizedIds($orTagIds);
        $notTagIds = $this->normalizedIds($notTagIds);
        $days = max(1, min(31, $days));
        $limit = max(1, min(500, $limit));
        $maxPages = max(1, min(200, $maxPages));
        $maxResults = max(1, min(50, $maxResults));

        $toDate = $this->dateString($to, $now->toDateString());
        $fromDate = $this->dateString($from, CarbonImmutable::parse($toDate, $timezone)->subDays($days - 1)->toDateString());

        if ($fromDate > $toDate) {
            [$fromDate, $toDate] = [$toDate, $fromDate];
        }

        $selection = $this->channels($tagIds, $orTagIds, $notTagIds, $limit);
        $channels = $selection['rows'];
        $selectionTruncated = $selection['truncated'];

        if (! $execute) {
            return [
                'mode' => 'dry-run',
                'generated_at' => $now->format('Y-m-d H:i:s'),
                'from' => $fromDate,
                'to' => $toDate,
                'tagid' => implode(',', $tagIds),
                'or' => implode(',', $orTagIds),
                'not' => implode(',', $notTagIds),
                'selected_channels' => count($channels),
                'selected_channel_ids' => $this->channelIds($channels),
                'channel_limit' => $limit,
                'channel_selection_truncated' => $selectionTruncated,
                'would_call_api' => count($channels) > 0,
                'api_max_pages_per_channel' => $maxPages,
                'api_max_results_per_page' => $maxResults,
                'rebuild_tag_date' => $rebuildTagDate,
                'rows' => $this->previewRows($channels, $fromDate, $toDate),
                'writes' => [],
            ];
        }

        $applied = [];
        $skipped = [];
        $totals = [
            'api_pages' => 0,
            'api_items' => 0,
            'videos_in_range' => 0,
            'video_upserts' => 0,
            'schedule_upserts' => 0,
            'live_upserts' => 0,
        ];

        foreach ($channels as $channel) {
            $uploads = trim((string) ($channel->uploads ?? ''));
            $uId = (int) $channel->u_id;

            if ($uploads === '') {
                $skipped[] = ['u_id' => $uId, 'reason' => 'missing_uploads_playlist'];

                continue;
            }

            try {
                $result = $this->fetchChannel($uId, $uploads, $fromDate, $toDate, $maxPages, $maxResults, $now);
            } catch (Throwable $exception) {
                if (
                    $exception instanceof YoutubeQuotaWindowException
                    || $exception instanceof YoutubeApiKeyPoolExhaustedException
                ) {
                    throw $exception;
                }

                $skipped[] = ['u_id' => $uId, 'reason' => 'channel_crawl_failed: '.$this->sanitizedFailure($exception)];

                continue;
            }

            foreach ($totals as $key => $value) {
                $totals[$key] += (int) ($result[$key] ?? 0);
            }

            $applied[] = [
                'u_id' => $uId,
                'uploads' => $uploads,
                ...$result,
            ];
        }

        $tagDateRows = [];
        $tagDateWrites = 0;
        $tagDateFailedRows = 0;
        $crawlComplete = $channels !== [] && ! $selectionTruncated && $skipped === [];
        $tagDateRebuildSkippedReason = null;

        if ($rebuildTagDate && $crawlComplete) {
            $cursor = CarbonImmutable::parse($fromDate, $timezone);
            $end = CarbonImmutable::parse($toDate, $timezone);

            while ($cursor <= $end) {
                $row = $this->tagDateCacheBuilder->build(
                    tagIds: $tagIds,
                    date: $cursor->toDateString(),
                    orTagIds: $orTagIds,
                    notTagIds: $notTagIds,
                    keywordLimit: $keywordLimit,
                    execute: true,
                    now: $now,
                );
                $tagDateWrites += (int) $row['writes'];
                $tagDateFailedRows += (int) ($row['failed_rows'] ?? 0);
                $tagDateRows[] = [
                    'date' => $row['date'],
                    'status' => $row['status'] ?? ((int) ($row['exit_code'] ?? 0) === 0 ? 'success' : 'failed'),
                    'channels_matched' => $row['channels_matched'],
                    'videos_scanned' => $row['videos_scanned'],
                    'tags_count' => $row['tags_count'],
                    'writes' => $row['writes'],
                    'failed_rows' => (int) ($row['failed_rows'] ?? 0),
                    'failure_reason' => $row['failure_reason'] ?? null,
                    'exit_code' => (int) ($row['exit_code'] ?? 0),
                ];
                $cursor = $cursor->addDay();
            }

            if ($tagDateFailedRows > 0) {
                $tagDateRebuildSkippedReason = 'tag_date_cache_rebuild_failed';
            }
        } elseif ($rebuildTagDate) {
            $tagDateRebuildSkippedReason = match (true) {
                $channels === [] => 'no_channels_selected',
                $selectionTruncated => 'channel_selection_cap_reached',
                default => 'incomplete_channel_crawl',
            };
        }

        $exitCode = $crawlComplete && $tagDateFailedRows === 0 ? 0 : 1;

        return [
            'mode' => 'execute',
            'status' => $exitCode === 0 ? 'success' : 'failed',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'from' => $fromDate,
            'to' => $toDate,
            'tagid' => implode(',', $tagIds),
            'or' => implode(',', $orTagIds),
            'not' => implode(',', $notTagIds),
            'selected_channels' => count($channels),
            'selected_channel_ids' => $this->channelIds($channels),
            'channel_limit' => $limit,
            'channel_selection_truncated' => $selectionTruncated,
            'updated_channels' => count($applied),
            'completed_channel_ids' => $this->rowChannelIds($applied),
            'skipped_channels' => count($skipped),
            'failed_channel_ids' => $this->rowChannelIds($skipped),
            'failed_channels' => count($skipped),
            'crawl_complete' => $crawlComplete,
            'exit_code' => $exitCode,
            ...$totals,
            'tag_date_writes' => $tagDateWrites,
            'tag_date_failed_rows' => $tagDateFailedRows,
            'tag_date_rows' => $tagDateRows,
            'tag_date_rebuild_skipped_reason' => $tagDateRebuildSkippedReason,
            'applied' => $applied,
            'skipped' => $skipped,
            'write_targets' => $crawlComplete && $rebuildTagDate
                ? ['urt_video', 'urt_video_schedule', 'urt_video_live', 'urt_show_tag_date']
                : ['urt_video', 'urt_video_schedule', 'urt_video_live'],
            'external_calls' => ['YouTube Data API playlistItems.list(part=snippet) paginated uploads crawl'],
            'secrets' => 'not printed',
        ];
    }

    /**
     * @return list<int>
     */
    private function normalizedIds(array $ids): array
    {
        return collect($ids)
            ->map(fn (mixed $id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();
    }

    /**
     * @param  list<object>  $channels
     * @return list<int>
     */
    private function channelIds(array $channels): array
    {
        return $this->normalizedIds(array_map(
            fn (object $channel): int => (int) ($channel->u_id ?? 0),
            $channels,
        ));
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<int>
     */
    private function rowChannelIds(array $rows): array
    {
        return $this->normalizedIds(array_map(
            fn (array $row): int => (int) ($row['u_id'] ?? 0),
            $rows,
        ));
    }

    private function dateString(?string $value, string $fallback): string
    {
        if ($value === null) {
            return $fallback;
        }

        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        if (! $parsed instanceof DateTimeImmutable || $parsed->format('Y-m-d') !== $value) {
            throw new InvalidArgumentException('date_options_must_be_valid_calendar_dates');
        }

        return $value;
    }

    /**
     * @return array{rows: list<object>, truncated: bool}
     */
    private function channels(array $tagIds, array $orTagIds, array $notTagIds, int $limit): array
    {
        $query = DB::table('urt_channel')
            ->join('urt_count', 'urt_count.u_id', '=', 'urt_channel.u_id')
            ->whereNull('urt_channel.flag_del')
            ->orderBy('urt_channel.u_id');

        if ($orTagIds !== []) {
            $query->where(function (Builder $query) use ($orTagIds): void {
                foreach ($orTagIds as $tagId) {
                    $query->orWhere('urt_count.tags', 'like', '%['.$tagId.']%');
                }
            });
        }

        foreach ($tagIds as $tagId) {
            $query->where('urt_count.tags', 'like', '%['.$tagId.']%');
        }

        if ($notTagIds !== []) {
            $query->where(function (Builder $query) use ($notTagIds): void {
                foreach ($notTagIds as $tagId) {
                    $query->where('urt_count.tags', 'not like', '%['.$tagId.']%');
                }
            });
        }

        $rows = $query
            ->limit($limit + 1)
            ->get(['urt_channel.u_id', 'urt_channel.title', 'urt_channel.uploads'])
            ->all();

        return [
            'rows' => array_slice($rows, 0, $limit),
            'truncated' => count($rows) > $limit,
        ];
    }

    /**
     * @param  list<object>  $channels
     * @return list<array<string, mixed>>
     */
    private function previewRows(array $channels, string $fromDate, string $toDate): array
    {
        $uIds = collect($channels)->pluck('u_id')->map(fn (mixed $id): int => (int) $id)->all();
        $counts = $uIds === []
            ? collect()
            : DB::table('urt_video')
                ->selectRaw('u_id, count(*) as videos')
                ->whereIn('u_id', $uIds)
                ->whereBetween('publishedAt', [$fromDate.' 00:00:00', $toDate.' 23:59:59'])
                ->groupBy('u_id')
                ->pluck('videos', 'u_id');

        return collect($channels)
            ->map(fn (object $channel): array => [
                'u_id' => (int) $channel->u_id,
                'title' => (string) ($channel->title ?? ''),
                'uploads' => (string) ($channel->uploads ?? ''),
                'local_videos_in_range' => (int) ($counts[(int) $channel->u_id] ?? 0),
            ])
            ->all();
    }

    /**
     * @return array<string, int|bool>
     */
    private function fetchChannel(int $uId, string $uploads, string $fromDate, string $toDate, int $maxPages, int $maxResults, CarbonImmutable $now): array
    {
        $pageToken = null;
        $pages = 0;
        $apiItems = 0;
        $itemsInRange = [];
        $stoppedBeforeFrom = false;
        $fromStart = CarbonImmutable::parse($fromDate.' 00:00:00', $now->getTimezone());
        $toEnd = CarbonImmutable::parse($toDate.' 23:59:59', $now->getTimezone());
        $nowString = $now->format('Y-m-d H:i:s');

        do {
            $page = $this->youtube->playlistItemsPage($uploads, $pageToken, $maxResults);
            $pages++;
            $apiItems += count($page['items']);

            foreach ($page['items'] as $item) {
                $publishedAt = CarbonImmutable::parse((string) $item['publishedAt'])->setTimezone($now->getTimezone());

                if ($publishedAt->lessThan($fromStart)) {
                    $stoppedBeforeFrom = true;
                    break 2;
                }

                if ($publishedAt->greaterThan($toEnd)) {
                    continue;
                }

                $itemsInRange[] = [$item, $publishedAt];
            }

            $pageToken = $page['nextPageToken'];
        } while ($pageToken !== null && $pages < $maxPages);

        if ($pageToken !== null && ! $stoppedBeforeFrom) {
            throw new RuntimeException('playlist_page_cap_reached_before_date_cutoff');
        }

        [$videoUpserts, $scheduleUpserts, $liveUpserts] = DB::transaction(function () use ($itemsInRange, $nowString, $uId): array {
            $videoUpserts = 0;
            $scheduleUpserts = 0;
            $liveUpserts = 0;

            foreach ($itemsInRange as [$item, $publishedAt]) {
                $videoId = (string) $item['videoId'];

                $this->upsertByKeys('urt_video', ['videoId' => $videoId], [
                    'ctime' => $nowString,
                    'id' => (string) $item['id'],
                    'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                    'channelId' => (string) $item['channelId'],
                    'title' => (string) $item['title'],
                    'thumbnails' => (string) $item['thumbnails'],
                    'channelTitle' => (string) $item['channelTitle'],
                    'playlistId' => (string) $item['playlistId'],
                    'position' => (int) $item['position'],
                    'u_id' => $uId,
                    'description' => (string) $item['description'],
                ]);
                $videoUpserts++;

                $this->upsertByKeys('urt_video_schedule', ['videoId' => $videoId], [
                    'ctime' => $nowString,
                    'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                ]);
                $scheduleUpserts++;

                if ($this->isLiveCandidate($item)) {
                    $this->upsertByKeys('urt_video_live', ['videoId' => $videoId], [
                        'ctime' => $nowString,
                        'publishedAt' => $publishedAt->format('Y-m-d H:i:s'),
                        'u_id' => $uId,
                    ]);
                    $liveUpserts++;
                }
            }

            return [$videoUpserts, $scheduleUpserts, $liveUpserts];
        });

        return [
            'api_pages' => $pages,
            'api_items' => $apiItems,
            'videos_in_range' => count($itemsInRange),
            'video_upserts' => $videoUpserts,
            'schedule_upserts' => $scheduleUpserts,
            'live_upserts' => $liveUpserts,
            'stopped_before_from' => $stoppedBeforeFrom,
        ];
    }

    /**
     * @param  array<string, mixed>  $item
     */
    private function isLiveCandidate(array $item): bool
    {
        return in_array((string) ($item['liveBroadcastContent'] ?? ''), ['live', 'upcoming'], true)
            || str_contains((string) ($item['thumbnails'] ?? ''), 'default_live.jpg');
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

        DB::table($table)->insert($keys + $values);
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

    private function sanitizedFailure(Throwable $exception): string
    {
        return SensitiveTextRedactor::exception($exception, 240);
    }
}
