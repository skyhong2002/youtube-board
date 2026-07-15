<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

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
     *     updated: int,
     *     skipped_rows: int,
     *     failed_rows: int,
     *     skipped: list<array{video_id: string, reason: string}>,
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
        $candidates = (clone $base)->count();

        if ($candidates === 0) {
            return $this->payload($now, $windowStart, $hours, $videoId, 0, 0, 0, 0, [], $execute);
        }

        $withHistoryBase = (clone $base)->whereExists(function ($query): void {
            $query
                ->selectRaw('1')
                ->from('urt_video_log_history')
                ->whereColumn('urt_video_log_history.videoId', 'urt_video_schedule.videoId');
        });
        $withHistory = (clone $withHistoryBase)->count();
        $missingHistory = max(0, $candidates - $withHistory);
        $candidateRows = (clone $withHistoryBase)
            ->orderBy('mtime')
            ->orderBy('videoId')
            ->limit($limit)
            ->get(['videoId', 'publishedAt', 'mtime', 'stime']);
        $sourceTruncated = $withHistory > $candidateRows->count();

        $rows = [];
        $historyRowsScanned = 0;
        $skipped = [];

        foreach ($candidateRows as $row) {
            $history = DB::table('urt_video_log_history')
                ->where('videoId', $row->videoId)
                ->orderByDesc('pk')
                ->limit(2)
                ->get(['pk', 'videoId', 'ctime', 'viewCount']);
            $historyRowsScanned += $history->count();
            $current = $history->get(0);
            $computed = null;

            if ($current !== null && $current->ctime !== null) {
                try {
                    $previous = $history->get(1);
                    $computed = $this->estimateNextCheck($row, $current, $previous, $timezone);
                } catch (Throwable) {
                    $computed = null;
                }
            }

            if ($computed === null) {
                $skipped[] = [
                    'video_id' => (string) $row->videoId,
                    'reason' => 'invalid_history_payload',
                ];
                Log::warning('Schedule reports source history is invalid.', [
                    'video_id' => (string) $row->videoId,
                    'reason' => 'invalid_history_payload',
                ]);

                if ($execute) {
                    try {
                        DB::transaction(fn (): int => DB::table('urt_video_schedule')
                            ->where('videoId', $row->videoId)
                            ->update([
                                'mtime' => $now->format('Y-m-d H:i:s'),
                            ]));
                    } catch (Throwable $exception) {
                        Log::warning('Schedule reports invalid-source cooldown failed.', [
                            'video_id' => (string) $row->videoId,
                            'reason' => 'cooldown_write_failed',
                            'exception_class' => $exception::class,
                        ]);
                    }
                }

                continue;
            }

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
            ->values()
            ->all();

        $updated = 0;

        if ($execute && $limitedRows !== []) {
            foreach ($limitedRows as $updateRow) {
                try {
                    $updated += DB::transaction(fn (): int => DB::table('urt_video_schedule')
                        ->where('videoId', $updateRow['video_id'])
                        ->update([
                            'stime' => $updateRow['estimated_stime'],
                            'mtime' => $now->format('Y-m-d H:i:s'),
                        ]));
                } catch (Throwable $exception) {
                    $skipped[] = [
                        'video_id' => (string) $updateRow['video_id'],
                        'reason' => 'item_processing_failed',
                    ];
                    Log::warning('Schedule reports item processing failed.', [
                        'video_id' => (string) $updateRow['video_id'],
                        'reason' => 'item_processing_failed',
                        'exception_class' => $exception::class,
                    ]);
                }
            }
        }

        return $this->payload(
            now: $now,
            windowStart: $windowStart,
            hours: $hours,
            videoId: $videoId,
            candidates: $candidates,
            withHistory: $withHistory,
            missingHistory: $missingHistory,
            wouldUpdate: count($limitedRows),
            rows: $limitedRows,
            execute: $execute,
            updated: $updated,
            skipped: $skipped,
            selectedCandidates: $candidateRows->count(),
            sourceTruncated: $sourceTruncated,
            historyRowsScanned: $historyRowsScanned,
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
     *     updated: int,
     *     skipped_rows: int,
     *     failed_rows: int,
     *     skipped: list<array{video_id: string, reason: string}>,
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
        array $skipped = [],
        int $selectedCandidates = 0,
        bool $sourceTruncated = false,
        int $historyRowsScanned = 0,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'window_start' => $windowStart->format('Y-m-d H:i:s'),
            'hours' => $hours,
            'video_id' => $videoId,
            'candidates' => $candidates,
            'selected_candidates' => $selectedCandidates,
            'source_truncated' => $sourceTruncated,
            'history_rows_scanned' => $historyRowsScanned,
            'with_history' => $withHistory,
            'missing_history' => $missingHistory,
            'would_update' => $wouldUpdate,
            'updated' => $updated,
            'skipped_rows' => count($skipped),
            'failed_rows' => count($skipped),
            'skipped' => $skipped,
            'rows' => $rows,
            'writes' => $execute ? ['urt_video_schedule.stime', 'urt_video_schedule.mtime'] : [],
        ];
    }
}
