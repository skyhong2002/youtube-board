<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class LivePollingIngestion
{
    public function __construct(
        private readonly LivePollingPreview $preview,
        private readonly YoutubeDataApiClient $youtube,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function execute(
        ?string $videoId = null,
        int $intervalMinutes = 11,
        int $limit = 1,
        ?CarbonInterface $now = null,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $intervalMinutes = max(1, min(240, $intervalMinutes));
        $limit = max(1, min(50, $limit));
        $preview = $this->preview->preview(
            videoId: $videoId,
            intervalMinutes: $intervalMinutes,
            limit: $limit,
            now: $now,
        );
        $rows = collect($preview['rows'] ?? [])
            ->filter(fn (array $row): bool => trim((string) ($row['video_id'] ?? '')) !== '')
            ->values();

        if (! (bool) ($preview['would_call_api'] ?? false) || $rows->isEmpty()) {
            return $this->summary($preview, [], [], $now);
        }

        $detailsByVideo = $this->youtube->videoLiveStreamingDetails(
            $rows->pluck('video_id')->map(fn (mixed $id): string => (string) $id)->all(),
        );
        $applied = [];
        $skipped = [];

        foreach ($rows as $row) {
            $rowVideoId = (string) $row['video_id'];
            $details = $detailsByVideo[$rowVideoId] ?? null;

            if ($details === null) {
                $skipped[] = [
                    'videoId' => $rowVideoId,
                    'reason' => 'api_item_missing',
                ];

                continue;
            }

            DB::transaction(function () use ($row, $details, $now): void {
                $this->updateLiveRowAndLog($row, $details, $now);
            });

            $applied[] = [
                'videoId' => $rowVideoId,
                'concurrentViewers' => isset($details['concurrentViewers']) ? (int) $details['concurrentViewers'] : null,
                'actualStartTime' => $this->apiTime($details['actualStartTime'] ?? null, $now),
                'actualEndTime' => $this->apiTime($details['actualEndTime'] ?? null, $now),
                'scheduledStartTime' => $this->apiTime($details['scheduledStartTime'] ?? null, $now),
                'activeLiveChatId' => isset($details['activeLiveChatId']) ? (string) $details['activeLiveChatId'] : null,
                'loggedMinute' => isset($details['concurrentViewers']) ? $now->format('H:i') : null,
            ];
        }

        return $this->summary($preview, $applied, $skipped, $now);
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, mixed>  $details
     */
    private function updateLiveRowAndLog(array $row, array $details, CarbonImmutable $now): void
    {
        if (! Schema::hasTable('urt_video_live')) {
            throw new RuntimeException('Missing local table: urt_video_live');
        }

        $videoId = (string) $row['video_id'];
        $nowString = $now->format('Y-m-d H:i:s');
        $liveValues = [
            'mtime' => $nowString,
            'actualStartTime' => $this->apiTime($details['actualStartTime'] ?? null, $now),
            'actualEndTime' => $this->apiTime($details['actualEndTime'] ?? null, $now),
            'scheduledStartTime' => $this->apiTime($details['scheduledStartTime'] ?? null, $now),
            'activeLiveChatId' => isset($details['activeLiveChatId']) ? (string) $details['activeLiveChatId'] : null,
        ];

        if (isset($details['concurrentViewers'])) {
            $concurrentViewers = (int) $details['concurrentViewers'];
            $liveValues['concurrentViewers'] = $concurrentViewers;

            if ($concurrentViewers > (int) ($row['max_current'] ?? 0)) {
                $liveValues['max_current'] = $concurrentViewers;
            }
        }

        DB::table('urt_video_live')
            ->where('videoId', $videoId)
            ->update($this->onlyExistingColumns('urt_video_live', collect($liveValues)->filter(fn (mixed $value): bool => $value !== null)->all()));

        if (isset($details['concurrentViewers'])) {
            $this->upsertLogPoint(
                videoId: $videoId,
                uId: $row['u_id'] !== null ? (int) $row['u_id'] : null,
                concurrentViewers: (int) $details['concurrentViewers'],
                now: $now,
            );
        }
    }

    private function upsertLogPoint(string $videoId, ?int $uId, int $concurrentViewers, CarbonImmutable $now): void
    {
        if (! Schema::hasTable('urt_video_live_log')) {
            throw new RuntimeException('Missing local table: urt_video_live_log');
        }

        $today = $now->toDateString();
        $nowString = $now->format('Y-m-d H:i:s');
        $minute = $now->format('H:i');
        $row = DB::table('urt_video_live_log')
            ->where('videoId', $videoId)
            ->where('the_date', $today)
            ->first();

        if ($row === null) {
            DB::table('urt_video_live_log')->insert($this->onlyExistingColumns('urt_video_live_log', [
                'ctime' => $nowString,
                'videoId' => $videoId,
                'the_date' => $today,
                'u_id' => $uId,
                'log_json' => json_encode([], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]));
            $data = [];
        } else {
            $decoded = json_decode((string) ($row->log_json ?? ''), true);
            $data = is_array($decoded) ? $decoded : [];
        }

        $data[$minute] = $concurrentViewers;
        $maxCurrent = max(array_map('intval', $data));

        DB::table('urt_video_live_log')
            ->where('videoId', $videoId)
            ->where('the_date', $today)
            ->update($this->onlyExistingColumns('urt_video_live_log', [
                'mtime' => $nowString,
                'log_json' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'max_current' => $maxCurrent,
            ]));
    }

    private function apiTime(mixed $value, CarbonImmutable $now): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        return CarbonImmutable::parse($value)->setTimezone($now->getTimezone())->format('Y-m-d H:i:s');
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
    private function summary(array $preview, array $applied, array $skipped, CarbonImmutable $now): array
    {
        return [
            'mode' => 'local-execute',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'source' => $preview['source'] ?? null,
            'selected_rows' => (int) ($preview['selected_rows'] ?? 0),
            'api_requested_videos' => count($applied) + count($skipped),
            'updated_videos' => count($applied),
            'skipped_videos' => count($skipped),
            'write_targets' => [
                'urt_video_live.mtime',
                'urt_video_live.actualStartTime',
                'urt_video_live.actualEndTime',
                'urt_video_live.scheduledStartTime',
                'urt_video_live.activeLiveChatId',
                'urt_video_live.concurrentViewers',
                'urt_video_live.max_current',
                'urt_video_live_log.ctime',
                'urt_video_live_log.videoId',
                'urt_video_live_log.the_date',
                'urt_video_live_log.u_id',
                'urt_video_live_log.mtime',
                'urt_video_live_log.log_json',
                'urt_video_live_log.max_current',
            ],
            'external_calls' => ['YouTube Data API videos.list(part=liveStreamingDetails)'],
            'applied' => $applied,
            'skipped' => $skipped,
            'secrets' => 'not printed',
        ];
    }
}
