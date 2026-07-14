<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class GroupReportsPreview
{
    private const REMOTE_SOURCE_LIMIT = 5000;

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
    public function preview(
        ?string $groupName = null,
        int $hours = 22,
        int $limit = 20,
        ?CarbonInterface $now = null,
        bool $execute = false,
        int|string|null $offset = 0,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(200, $limit));
        $groupName = $groupName !== null && trim($groupName) !== '' ? trim($groupName) : null;
        $syncResult = $execute
            ? $this->syncLegacyGroups($now, $hours, $limit, $offset)
            : [
                'candidates' => 0,
                'attempted' => 0,
                'synced' => 0,
                'failed' => 0,
                'offset' => 0,
                'offset_mode' => 'explicit',
                'next_offset' => 0,
                'batch_wrapped' => false,
                'source_truncated' => false,
            ];

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
            'sync_source_limit' => self::REMOTE_SOURCE_LIMIT,
            'sync_offset' => $syncResult['offset'],
            'sync_offset_mode' => $syncResult['offset_mode'],
            'sync_next_offset' => $syncResult['next_offset'],
            'sync_batch_wrapped' => $syncResult['batch_wrapped'],
            'sync_source_truncated' => $syncResult['source_truncated'],
            'exit_code' => $syncResult['failed'] > 0 ? 1 : 0,
            'writes' => $execute ? ['tag_group'] : [],
        ];
    }

    /**
     * @return array{candidates: int, attempted: int, synced: int, failed: int, offset: int, offset_mode: string, next_offset: int, batch_wrapped: bool, source_truncated: bool}
     */
    private function syncLegacyGroups(
        CarbonImmutable $now,
        int $hours,
        int $limit,
        int|string|null $offset,
    ): array {
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(200, $limit));
        $response = Http::timeout(30)
            ->retry(2, 500)
            ->get('https://tag.analysis.tw/api/group.php', ['hours' => $hours]);

        if (! $response->successful()) {
            throw new \RuntimeException('tag.analysis.tw group sync failed status='.$response->status());
        }

        $payload = $response->json();

        if (
            ! is_array($payload)
            || ! array_key_exists('result', $payload)
            || ! is_array($payload['result'])
            || ! array_is_list($payload['result'])
        ) {
            throw new \RuntimeException('tag.analysis.tw group sync returned malformed result');
        }

        $rows = $payload['result'];

        if (count($rows) > self::REMOTE_SOURCE_LIMIT) {
            throw new \RuntimeException('tag.analysis.tw group sync source limit exceeded');
        }

        $candidates = collect($rows)
            ->map(fn (mixed $row): array => $this->validatedRemoteRow($row))
            ->values();
        [$effectiveOffset, $offsetMode] = $this->effectiveOffset($offset, $candidates->count(), $limit, $now);
        [$attemptedRows, $wrapped] = $this->wrappedBatch($candidates, $effectiveOffset, $limit);
        $synced = 0;
        $failed = 0;
        $generatedAt = $now->format('Y-m-d H:i:s');

        foreach ($attemptedRows as $row) {
            $tag = $row['tag'];
            $group = $row['group'];
            $latestTime = max($row['ctime'], $row['mtime'] ?? $row['ctime']);
            $delFlag = $row['del_flag'];
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
            'offset' => $effectiveOffset,
            'offset_mode' => $offsetMode,
            'next_offset' => $candidates->isNotEmpty()
                ? ($effectiveOffset + $attemptedRows->count()) % $candidates->count()
                : 0,
            'batch_wrapped' => $wrapped,
            'source_truncated' => $candidates->count() > $attemptedRows->count(),
        ];
    }

    /** @return array{tag: string, group: string, ctime: string, mtime: string|null, del_flag: string} */
    private function validatedRemoteRow(mixed $row): array
    {
        $required = ['tag', 'group', 'ctime', 'mtime', 'del_flag'];

        if (! is_array($row)) {
            throw new \RuntimeException('tag.analysis.tw group sync returned malformed row');
        }

        foreach ($required as $key) {
            if (! array_key_exists($key, $row)) {
                throw new \RuntimeException('tag.analysis.tw group sync returned malformed row');
            }
        }

        $tag = is_string($row['tag']) ? trim($row['tag']) : '';
        $group = is_string($row['group']) ? trim($row['group']) : '';
        $ctime = $this->dateTime($row['ctime']);
        $mtime = $row['mtime'] === null ? null : $this->dateTime($row['mtime']);
        $delFlag = $this->delFlag($row['del_flag']);

        if (
            $tag === ''
            || mb_strlen($tag, 'UTF-8') > 64
            || $group === ''
            || mb_strlen($group, 'UTF-8') > 64
            || $ctime === null
            || ($row['mtime'] !== null && $mtime === null)
            || $delFlag === null
        ) {
            throw new \RuntimeException('tag.analysis.tw group sync returned malformed row');
        }

        return [
            'tag' => $tag,
            'group' => $group,
            'ctime' => $ctime,
            'mtime' => $mtime,
            'del_flag' => $delFlag,
        ];
    }

    private function delFlag(mixed $value): ?string
    {
        if ($value === null || $value === 0 || $value === '0') {
            return '0';
        }

        if ($value === 1 || $value === '1') {
            return '1';
        }

        return null;
    }

    private function dateTime(mixed $value): ?string
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value)) {
            return null;
        }

        try {
            $parsed = CarbonImmutable::createFromFormat('Y-m-d H:i:s', $value);
        } catch (Throwable) {
            return null;
        }

        return $parsed !== false && $parsed->format('Y-m-d H:i:s') === $value ? $value : null;
    }

    /** @return array{0: int, 1: string} */
    private function effectiveOffset(
        int|string|null $offset,
        int $total,
        int $limit,
        CarbonImmutable $now,
    ): array {
        if ($total < 1) {
            return [0, 'explicit'];
        }

        if (is_string($offset) && strtolower(trim($offset)) === 'auto') {
            return [(intdiv($now->getTimestamp(), 3600) * $limit) % $total, 'auto'];
        }

        return [max(0, (int) $offset) % $total, 'explicit'];
    }

    /** @return array{0: Collection<int, array<string, mixed>>, 1: bool} */
    private function wrappedBatch(Collection $rows, int $offset, int $limit): array
    {
        $selected = $rows->slice($offset, $limit)->values();
        $wanted = min($limit, $rows->count());
        $wrapped = false;

        if ($selected->count() < $wanted && $offset > 0) {
            $wrapped = true;
            $selected = $selected->concat($rows->take($wanted - $selected->count()))->values();
        }

        return [$selected, $wrapped];
    }
}
