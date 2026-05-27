<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

class ScheduleReportsPreview
{
    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     window_start: string,
     *     hours: int,
     *     video_id: string|null,
     *     candidates: int,
     *     with_history: int,
     *     missing_history: int,
     *     would_update: int,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    public function preview(?string $videoId = null, int $hours = 1, int $limit = 20, ?CarbonInterface $now = null, bool $execute = false): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(200, $limit));
        $videoId = $videoId !== null && trim($videoId) !== '' ? trim($videoId) : null;
        $windowStart = $now->subHours($hours);

        $base = DB::table('urt_video_schedule')
            ->where('mtime', '>=', $windowStart->format('Y-m-d H:i:s'))
            ->when($videoId !== null, fn ($query) => $query->where('videoId', $videoId));

        $candidateRows = (clone $base)
            ->orderBy('mtime')
            ->orderBy('videoId')
            ->get(['videoId', 'publishedAt', 'mtime', 'stime']);

        if ($candidateRows->isEmpty()) {
            return $this->payload($now, $windowStart, $hours, $videoId, 0, 0, 0, 0, []);
        }

        $historyRows = DB::table('urt_video_log_history')
            ->whereIn('videoId', $candidateRows->pluck('videoId')->all())
            ->orderByDesc('pk')
            ->get(['pk', 'videoId', 'ctime', 'viewCount'])
            ->groupBy('videoId');

        $rows = [];
        $withHistory = 0;
        $missingHistory = 0;

        foreach ($candidateRows as $row) {
            $history = $historyRows->get($row->videoId, collect())->values();
            $current = $history->get(0);

            if ($current === null || $current->ctime === null) {
                $missingHistory++;
                continue;
            }

            $previous = $history->get(1);
            $computed = $this->estimateNextCheck($row, $current, $previous, $timezone);

            if ($computed === null) {
                $missingHistory++;
                continue;
            }

            $withHistory++;
            $rows[] = [
                'video_id' => (string) $row->videoId,
                'published_at' => $row->publishedAt !== null ? (string) $row->publishedAt : null,
                'mtime' => $row->mtime !== null ? (string) $row->mtime : null,
                'current_stime' => $row->stime !== null ? (string) $row->stime : null,
                ...$computed,
            ];
        }

        $limitedRows = collect($rows)
            ->sortBy('estimated_stime')
            ->take($limit)
            ->values()
            ->all();

        $updated = 0;

        if ($execute && $limitedRows !== []) {
            foreach ($limitedRows as $updateRow) {
                $updated += DB::table('urt_video_schedule')
                    ->where('videoId', $updateRow['video_id'])
                    ->update([
                        'stime' => $updateRow['estimated_stime'],
                        'mtime' => $now->format('Y-m-d H:i:s'),
                    ]);
            }
        }

        return $this->payload(
            now: $now,
            windowStart: $windowStart,
            hours: $hours,
            videoId: $videoId,
            candidates: $candidateRows->count(),
            withHistory: $withHistory,
            missingHistory: $missingHistory,
            wouldUpdate: $withHistory,
            rows: $limitedRows,
            execute: $execute,
            updated: $updated,
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    private function estimateNextCheck(object $row, object $current, ?object $previous, string $timezone): ?array
    {
        if ($row->mtime === null) {
            return null;
        }

        $currentTime = CarbonImmutable::parse((string) $current->ctime, $timezone);
        $previousTime = $previous !== null && $previous->ctime !== null
            ? CarbonImmutable::parse((string) $previous->ctime, $timezone)
            : CarbonImmutable::parse((string) $row->publishedAt, $timezone);
        $mtime = CarbonImmutable::parse((string) $row->mtime, $timezone);

        $viewDelta = (int) $current->viewCount - (int) ($previous->viewCount ?? 0);
        $viewDelta = max(1, $viewDelta);
        $periodSeconds = $currentTime->getTimestamp() - $previousTime->getTimestamp() + 1;

        if ($periodSeconds <= 0) {
            return null;
        }

        $periodHours = $periodSeconds / 3600;
        $viewsPerHour = $viewDelta / $periodHours;
        $rawHoursPer1000 = $viewsPerHour > 0 ? 1000 / $viewsPerHour : 3000;
        $hoursPer1000 = $rawHoursPer1000;
        $cap = 'none';

        if ($hoursPer1000 > 1000) {
            $hoursPer1000 = 3000;
            $cap = 'legacy_slow_cap_3000_hours';
        }

        if ($hoursPer1000 < 2) {
            $hoursPer1000 = 2;
            $cap = 'legacy_fast_floor_2_hours';
        }

        return [
            'history' => [
                'current' => [
                    'ctime' => $currentTime->format('Y-m-d H:i:s'),
                    'viewCount' => (int) $current->viewCount,
                ],
                'previous' => [
                    'ctime' => $previousTime->format('Y-m-d H:i:s'),
                    'viewCount' => (int) ($previous->viewCount ?? 0),
                    'source' => $previous === null ? 'publishedAt fallback' : 'urt_video_log_history',
                ],
            ],
            'view_delta' => $viewDelta,
            'period_hours' => round($periodHours, 3),
            'views_per_hour' => round($viewsPerHour, 3),
            'raw_hours_per_1000_views' => round($rawHoursPer1000, 3),
            'hours_per_1000_views' => round($hoursPer1000, 3),
            'cap' => $cap,
            'estimated_stime' => $mtime->addSeconds((int) round($hoursPer1000 * 3600))->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     window_start: string,
     *     hours: int,
     *     video_id: string|null,
     *     candidates: int,
     *     with_history: int,
     *     missing_history: int,
     *     would_update: int,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    private function payload(
        CarbonImmutable $now,
        CarbonImmutable $windowStart,
        int $hours,
        ?string $videoId,
        int $candidates,
        int $withHistory,
        int $missingHistory,
        int $wouldUpdate,
        array $rows,
        bool $execute = false,
        int $updated = 0,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'window_start' => $windowStart->format('Y-m-d H:i:s'),
            'hours' => $hours,
            'video_id' => $videoId,
            'candidates' => $candidates,
            'with_history' => $withHistory,
            'missing_history' => $missingHistory,
            'would_update' => $wouldUpdate,
            'updated' => $updated,
            'rows' => $rows,
            'writes' => $execute ? ['urt_video_schedule.stime', 'urt_video_schedule.mtime'] : [],
        ];
    }
}
