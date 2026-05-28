<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

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

        $countRows = DB::table('urt_count')
            ->when($uId !== null, fn ($query) => $query->where('u_id', $uId))
            ->orderBy('u_id')
            ->get()
            ->keyBy('u_id');

        if ($countRows->isEmpty()) {
            return $this->payload($now, 0, 0, 0, 0, 0, []);
        }

        $logRows = DB::table('urt_log')
            ->whereIn('u_id', $countRows->keys()->all())
            ->orderByDesc('pk')
            ->get()
            ->groupBy('u_id');

        $rows = [];
        $withLogs = 0;
        $missingLogs = 0;
        $wouldUpdate = 0;
        $unchanged = 0;

        foreach ($countRows as $row) {
            $logs = $logRows->get($row->u_id, collect());

            if ($logs->isEmpty()) {
                $missingLogs++;
                continue;
            }

            $withLogs++;
            $computed = $this->computeDeltas($logs, $now);
            $diff = $this->diff($row, $computed);

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

        if ($execute && $rows !== []) {
            foreach ($rows as $updateRow) {
                $updated += DB::table('urt_count')
                    ->where('u_id', $updateRow['u_id'])
                    ->update($updateRow['computed'] + [
                        'mtime' => $now->format('Y-m-d H:i:s'),
                    ]);
            }
        }

        return $this->payload(
            now: $now,
            candidates: $countRows->count(),
            withLogs: $withLogs,
            missingLogs: $missingLogs,
            wouldUpdate: $wouldUpdate,
            unchanged: $unchanged,
            rows: $rows,
            execute: $execute,
            updated: $updated,
        );
    }

    /**
     * @param  Collection<int, object>  $logs
     * @return array{view_week: int, sub_week: int, video_week: int, view_month: int, sub_month: int, video_month: int}
     */
    private function computeDeltas(Collection $logs, CarbonImmutable $now): array
    {
        $series = [];

        foreach ($logs as $log) {
            $decoded = json_decode((string) ($log->thedata ?? ''), true);

            if (is_array($decoded)) {
                $series = array_replace($series, $decoded);
            }
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

        for ($i = 0; $i <= 30; $i++) {
            $date = $now->subDays($i)->toDateString();
            $point = is_array($series[$date] ?? null) ? $series[$date] : null;

            if ($point === null) {
                continue;
            }

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
    ): array
    {
        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'date' => $now->toDateString(),
            'candidates' => $candidates,
            'with_logs' => $withLogs,
            'missing_logs' => $missingLogs,
            'would_update' => $wouldUpdate,
            'unchanged' => $unchanged,
            'updated' => $updated,
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
