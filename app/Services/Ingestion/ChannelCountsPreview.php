<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class ChannelCountsPreview
{
    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     date: string,
     *     candidates: int,
     *     with_logs: int,
     *     missing_logs: int,
     *     would_update: int,
     *     unchanged: int,
     *     updated: int,
     *     skipped_rows: int,
     *     failed_rows: int,
     *     skipped: list<array{u_id: int, reason: string}>,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    public function preview(?int $uId = null, int $limit = 20, ?CarbonInterface $now = null, bool $execute = false): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(100, $limit));

        $base = DB::table('urt_count')
            ->when($uId !== null, fn ($query) => $query->where('urt_count.u_id', $uId));
        $candidates = (clone $base)->count();

        if ($candidates === 0) {
            return $this->payload($now, 0, 0, 0, 0, 0, [], $execute);
        }

        $withLogsBase = (clone $base)->whereExists(function ($query): void {
            $query
                ->selectRaw('1')
                ->from('urt_log')
                ->whereColumn('urt_log.u_id', 'urt_count.u_id');
        });
        $withLogs = (clone $withLogsBase)->count();
        $missingLogs = max(0, $candidates - $withLogs);
        $countRows = (clone $withLogsBase)
            ->orderBy('urt_count.mtime')
            ->orderBy('urt_count.u_id')
            ->limit($limit)
            ->get()
            ->keyBy('u_id');
        $sourceTruncated = $withLogs > $countRows->count();
        $logMonthStart = $now->subDays(31)->startOfMonth()->toDateString();

        $rows = [];
        $wouldUpdate = 0;
        $unchanged = 0;
        $logRowsScanned = 0;
        $evaluated = [];
        $skipped = [];

        foreach ($countRows as $row) {
            $logs = DB::table('urt_log')
                ->where('u_id', $row->u_id)
                ->where(function ($query) use ($logMonthStart): void {
                    $query->whereNull('themonth')->orWhere('themonth', '>=', $logMonthStart);
                })
                ->orderByDesc('pk')
                ->limit(3)
                ->get();
            $logRowsScanned += $logs->count();

            if ($logs->isEmpty()) {
                continue;
            }

            $computed = $this->computeDeltas($logs, $now);

            if ($computed === null) {
                $skipped[] = [
                    'u_id' => (int) $row->u_id,
                    'reason' => 'invalid_log_payload',
                ];
                Log::warning('Channel counts source history is invalid.', [
                    'u_id' => (int) $row->u_id,
                    'reason' => 'invalid_log_payload',
                ]);

                continue;
            }

            $diff = $this->diff($row, $computed);
            $evaluated[] = [
                'u_id' => (int) $row->u_id,
                'computed' => $computed,
                'diff' => $diff,
            ];

            if ($diff === []) {
                $unchanged++;

                continue;
            }

            $wouldUpdate++;
            $rows[] = [
                'u_id' => (int) $row->u_id,
                'computed' => $computed,
                'current' => [
                    'view_week' => (int) ($row->view_week ?? 0),
                    'sub_week' => (int) ($row->sub_week ?? 0),
                    'video_week' => (int) ($row->video_week ?? 0),
                    'view_month' => (int) ($row->view_month ?? 0),
                    'sub_month' => (int) ($row->sub_month ?? 0),
                    'video_month' => (int) ($row->video_month ?? 0),
                ],
                'diff' => $diff,
            ];
        }

        $rows = collect($rows)
            ->sortByDesc(fn (array $row): int => abs((int) ($row['diff']['view_month'] ?? 0)))
            ->take($limit)
            ->values()
            ->all();

        $updated = 0;
        $refreshed = 0;

        if ($execute && $evaluated !== []) {
            foreach ($evaluated as $updateRow) {
                try {
                    $affected = DB::transaction(fn (): int => DB::table('urt_count')
                        ->where('u_id', $updateRow['u_id'])
                        ->update($updateRow['computed'] + [
                            'mtime' => $now->format('Y-m-d H:i:s'),
                        ]));
                    $refreshed += $affected;

                    if ($updateRow['diff'] !== []) {
                        $updated += $affected;
                    }
                } catch (Throwable $exception) {
                    $skipped[] = [
                        'u_id' => (int) $updateRow['u_id'],
                        'reason' => 'item_processing_failed',
                    ];
                    Log::warning('Channel counts item processing failed.', [
                        'u_id' => (int) $updateRow['u_id'],
                        'reason' => 'item_processing_failed',
                        'exception_class' => $exception::class,
                    ]);
                }
            }
        }

        return $this->payload(
            now: $now,
            candidates: $candidates,
            withLogs: $withLogs,
            missingLogs: $missingLogs,
            wouldUpdate: $wouldUpdate,
            unchanged: $unchanged,
            rows: $rows,
            execute: $execute,
            updated: $updated,
            refreshed: $refreshed,
            skipped: $skipped,
            selectedCandidates: $countRows->count(),
            sourceTruncated: $sourceTruncated,
            logRowsScanned: $logRowsScanned,
        );
    }

    /**
     * @param  Collection<int, object>  $logs
     * @return array{view_week: int, sub_week: int, video_week: int, view_month: int, sub_month: int, video_month: int}|null
     */
    private function computeDeltas(Collection $logs, CarbonImmutable $now): ?array
    {
        $series = [];

        foreach ($logs as $log) {
            try {
                $decoded = json_decode((string) ($log->thedata ?? ''), true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return null;
            }

            if (! is_array($decoded)) {
                return null;
            }

            foreach ($decoded as $date => $point) {
                if (! is_string($date) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1 || ! is_array($point)) {
                    return null;
                }

                foreach (['view', 'subscriber', 'video'] as $metric) {
                    if (! array_key_exists($metric, $point) || ! is_numeric($point[$metric]) || (int) $point[$metric] < 0) {
                        return null;
                    }
                }
            }

            $series = array_replace($series, $decoded);
        }

        if ($series === []) {
            return null;
        }

        $latest = [
            'view' => null,
            'subscriber' => null,
            'video' => null,
        ];
        $week = [
            'view' => 0,
            'subscriber' => 0,
            'video' => 0,
        ];
        $month = $week;
        $observedPoint = false;

        for ($i = 0; $i <= 30; $i++) {
            $date = $now->subDays($i)->toDateString();
            $point = is_array($series[$date] ?? null) ? $series[$date] : null;

            if ($point === null) {
                continue;
            }

            $observedPoint = true;

            foreach (['view', 'subscriber', 'video'] as $metric) {
                if ($latest[$metric] === null && array_key_exists($metric, $point)) {
                    $latest[$metric] = (int) $point[$metric];
                }
            }

            if ($i <= 7 && $latest['view'] !== null && array_key_exists('view', $point)) {
                $week = $this->deltaAtPoint($latest, $point);
            }

            if ($i <= 29 && $latest['view'] !== null && array_key_exists('view', $point)) {
                $month = $this->deltaAtPoint($latest, $point);
            }
        }

        if (! $observedPoint || $latest['view'] === null) {
            return null;
        }

        return [
            'view_week' => $week['view'],
            'sub_week' => $week['subscriber'],
            'video_week' => $week['video'],
            'view_month' => $month['view'],
            'sub_month' => $month['subscriber'],
            'video_month' => $month['video'],
        ];
    }

    /**
     * @param  array{view: int|null, subscriber: int|null, video: int|null}  $latest
     * @param  array<string, mixed>  $point
     * @return array{view: int, subscriber: int, video: int}
     */
    private function deltaAtPoint(array $latest, array $point): array
    {
        return [
            'view' => (int) ($latest['view'] ?? 0) - (int) ($point['view'] ?? 0),
            'subscriber' => (int) ($latest['subscriber'] ?? 0) - (int) ($point['subscriber'] ?? 0),
            'video' => (int) ($latest['video'] ?? 0) - (int) ($point['video'] ?? 0),
        ];
    }

    /**
     * @param  array{view_week: int, sub_week: int, video_week: int, view_month: int, sub_month: int, video_month: int}  $computed
     * @return array<string, int>
     */
    private function diff(object $row, array $computed): array
    {
        $diff = [];

        foreach ($computed as $column => $value) {
            $current = (int) ($row->{$column} ?? 0);

            if ($current !== $value) {
                $diff[$column] = $value - $current;
            }
        }

        return $diff;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     date: string,
     *     candidates: int,
     *     with_logs: int,
     *     missing_logs: int,
     *     would_update: int,
     *     unchanged: int,
     *     updated: int,
     *     skipped_rows: int,
     *     failed_rows: int,
     *     skipped: list<array{u_id: int, reason: string}>,
     *     rows: list<array<string, mixed>>,
     *     writes: list<string>
     * }
     */
    private function payload(
        CarbonImmutable $now,
        int $candidates,
        int $withLogs,
        int $missingLogs,
        int $wouldUpdate,
        int $unchanged,
        array $rows,
        bool $execute = false,
        int $updated = 0,
        int $refreshed = 0,
        array $skipped = [],
        int $selectedCandidates = 0,
        bool $sourceTruncated = false,
        int $logRowsScanned = 0,
    ): array {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'date' => $now->toDateString(),
            'candidates' => $candidates,
            'selected_candidates' => $selectedCandidates,
            'source_truncated' => $sourceTruncated,
            'log_rows_scanned' => $logRowsScanned,
            'with_logs' => $withLogs,
            'missing_logs' => $missingLogs,
            'would_update' => $wouldUpdate,
            'unchanged' => $unchanged,
            'updated' => $updated,
            'refreshed' => $refreshed,
            'skipped_rows' => count($skipped),
            'failed_rows' => count($skipped),
            'skipped' => $skipped,
            'rows' => $rows,
            'writes' => $execute ? [
                'urt_count.view_week',
                'urt_count.sub_week',
                'urt_count.video_week',
                'urt_count.view_month',
                'urt_count.sub_month',
                'urt_count.video_month',
                'urt_count.mtime',
            ] : [],
        ];
    }
}
