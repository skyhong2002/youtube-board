<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class GroupReportsPreview
{
    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     hours: int,
     *     group_name: string|null,
     *     group_count: int,
     *     tag_rows: int,
     *     active_rows: int,
     *     deleted_rows: int,
     *     latest_time: string|null,
     *     rows: list<array<string, mixed>>,
     *     external_fetch_skipped: string,
     *     writes: list<string>
     * }
     */
    public function preview(?string $groupName = null, int $hours = 22, int $limit = 20, ?CarbonInterface $now = null, bool $execute = false): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(200, $limit));
        $groupName = $groupName !== null && trim($groupName) !== '' ? trim($groupName) : null;
        $syncResult = $execute
            ? $this->syncLegacyGroups($now, $hours, $limit)
            : ['candidates' => 0, 'attempted' => 0, 'synced' => 0, 'failed' => 0];

        $base = DB::table('tag_group')
            ->when($groupName !== null, fn ($query) => $query->where('group_name', $groupName));

        $groupCount = (clone $base)->distinct()->count('group_name');
        $tagRows = (clone $base)->count();
        $activeRows = (clone $base)
            ->where(fn ($query) => $query->whereNull('del_flag')->orWhere('del_flag', '<', '1'))
            ->count();
        $deletedRows = $tagRows - $activeRows;
        $latestTime = (clone $base)->max('latest_time');

        $rows = (clone $base)
            ->selectRaw('group_name, COUNT(*) AS tag_rows')
            ->selectRaw("SUM(CASE WHEN del_flag IS NULL OR del_flag < '1' THEN 1 ELSE 0 END) AS active_rows")
            ->selectRaw("SUM(CASE WHEN del_flag IS NOT NULL AND del_flag >= '1' THEN 1 ELSE 0 END) AS deleted_rows")
            ->selectRaw('MAX(latest_time) AS latest_time')
            ->groupBy('group_name')
            ->orderByDesc('active_rows')
            ->orderBy('group_name')
            ->limit($limit)
            ->get()
            ->map(fn (object $row): array => [
                'group_name' => (string) $row->group_name,
                'tag_rows' => (int) $row->tag_rows,
                'active_rows' => (int) $row->active_rows,
                'deleted_rows' => (int) $row->deleted_rows,
                'latest_time' => $row->latest_time !== null ? (string) $row->latest_time : null,
            ])
            ->values()
            ->all();

        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'hours' => $hours,
            'group_name' => $groupName,
            'group_count' => $groupCount,
            'tag_rows' => $tagRows,
            'active_rows' => $activeRows,
            'deleted_rows' => $deletedRows,
            'latest_time' => $latestTime !== null ? (string) $latestTime : null,
            'rows' => $rows,
            'external_fetch_skipped' => '新文易數 tag.analysis.tw group sync is intentionally not called in planning mode',
            'sync_candidates' => $syncResult['candidates'],
            'sync_attempted' => $syncResult['attempted'],
            'synced_rows' => $syncResult['synced'],
            'failed_rows' => $syncResult['failed'],
            'exit_code' => $syncResult['failed'] > 0 ? 1 : 0,
            'writes' => $execute ? ['tag_group'] : [],
        ];
    }

    /**
     * @return array{candidates: int, attempted: int, synced: int, failed: int}
     */
    private function syncLegacyGroups(CarbonImmutable $now, int $hours, int $limit): array
    {
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(200, $limit));
        $response = Http::timeout(30)
            ->retry(2, 500)
            ->get('https://tag.analysis.tw/api/group.php', ['hours' => $hours]);

        if (! $response->successful()) {
            throw new \RuntimeException('tag.analysis.tw group sync failed status='.$response->status());
        }

        $payload = $response->json();
        $rows = is_array($payload) && is_array($payload['result'] ?? null) ? $payload['result'] : [];
        $candidates = collect($rows)
            ->filter(function (mixed $row): bool {
                return is_array($row)
                    && trim((string) ($row['tag'] ?? '')) !== ''
                    && trim((string) ($row['group'] ?? '')) !== '';
            })
            ->values();
        $attemptedRows = $candidates->take($limit);
        $synced = 0;
        $failed = 0;
        $generatedAt = $now->format('Y-m-d H:i:s');

        foreach ($attemptedRows as $row) {
            $tag = trim((string) ($row['tag'] ?? ''));
            $group = trim((string) ($row['group'] ?? ''));

            $latestTime = max(
                $this->dateTime($row['ctime'] ?? null, $generatedAt),
                $this->dateTime($row['mtime'] ?? null, $generatedAt),
            );
            $delFlag = (string) ($row['del_flag'] ?? '0');
            try {
                DB::transaction(function () use ($tag, $group, $latestTime, $delFlag, $generatedAt): void {
                    $existing = DB::table('tag_group')
                        ->where('tag', $tag)
                        ->where('group_name', $group)
                        ->first(['pk', 'latest_time']);

                    if ($existing === null) {
                        DB::table('tag_group')->insert([
                            'ctime' => $generatedAt,
                            'latest_time' => $latestTime,
                            'tag' => $tag,
                            'group_name' => $group,
                            'del_flag' => $delFlag,
                        ]);
                    } elseif ((string) ($existing->latest_time ?? '') < $latestTime) {
                        DB::table('tag_group')->where('pk', $existing->pk)->update([
                            'mtime' => $generatedAt,
                            'latest_time' => $latestTime,
                            'del_flag' => $delFlag,
                        ]);
                    }
                });

                $synced++;
            } catch (Throwable $exception) {
                $failed++;
                Log::warning('Group sync row failed.', [
                    'tag_hash' => hash('sha256', $tag),
                    'group_hash' => hash('sha256', $group),
                    'exception_class' => $exception::class,
                ]);
            }
        }

        return [
            'candidates' => $candidates->count(),
            'attempted' => $attemptedRows->count(),
            'synced' => $synced,
            'failed' => $failed,
        ];
    }

    private function dateTime(mixed $value, string $fallback): string
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value)
            ? $value
            : $fallback;
    }
}
