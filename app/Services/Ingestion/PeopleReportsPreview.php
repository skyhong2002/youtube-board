<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

class PeopleReportsPreview
{
    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     group_name: string,
     *     tagid: int,
     *     days: int,
     *     candidates: int,
     *     latest_time: string|null,
     *     rows: list<array<string, mixed>>,
     *     cache_generation_skipped: string,
     *     writes: list<string>
     * }
     */
    public function preview(
        string $groupName = '政治人物',
        int $tagId = 13,
        int $days = 37,
        int $limit = 20,
        ?CarbonInterface $now = null,
        bool $execute = false,
        int $keywordLimit = 5000,
        int|string|null $offset = 0,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $groupName = trim($groupName) ?: '政治人物';
        $tagId = max(1, $tagId);
        $days = max(1, min(365, $days));
        $limit = max(1, min(200, $limit));

        $base = DB::table('tag_group')
            ->where('group_name', $groupName)
            ->where(function ($query): void {
                $query->whereNull('del_flag')->orWhere('del_flag', '<', '1');
            });

        $candidates = (clone $base)->count();
        $latestTime = (clone $base)->max('latest_time');
        [$effectiveOffset, $offsetMode] = $this->effectiveOffset($offset, $candidates, $limit, $now, 3600);
        $selected = (clone $base)
            ->orderByDesc('latest_time')
            ->orderBy('tag')
            ->offset($effectiveOffset)
            ->limit($limit)
            ->get(['tag', 'latest_time']);
        $wrapped = false;

        if ($selected->count() < min($limit, $candidates) && $effectiveOffset > 0) {
            $wrapped = true;
            $selected = $selected->concat((clone $base)
                ->orderByDesc('latest_time')
                ->orderBy('tag')
                ->limit(min($limit, $candidates) - $selected->count())
                ->get(['tag', 'latest_time']));
        }

        $rows = $selected
            ->map(fn (object $row): array => [
                'tag' => (string) $row->tag,
                'latest_time' => (string) $row->latest_time,
                'tagid' => $tagId,
                'days' => $days,
                'legacy_command' => sprintf('/usr/bin/php /home/urtube/api/tag_period.php tag=%s tagid=%d days=%d', $row->tag, $tagId, $days),
                'modern_api_preview' => '/api/tag_period.php?'.http_build_query([
                    'tag' => (string) $row->tag,
                    'tagid' => $tagId,
                    'days' => $days,
                ]),
            ])
            ->values()
            ->all();
        $cacheWrites = 0;
        $cacheJobs = 0;
        $failedCacheRows = 0;

        if ($execute && $rows !== []) {
            $builder = app(TagDateCacheBuilder::class);
            $from = $now->subDays($days - 1);

            foreach ($rows as $row) {
                $cursor = $from;

                while ($cursor <= $now) {
                    $result = $builder->build(
                        tagIds: [$tagId],
                        date: $cursor->toDateString(),
                        keywordLimit: $keywordLimit,
                        onlyKeywords: [$row['tag']],
                        execute: true,
                        now: $now,
                    );
                    $cacheJobs++;
                    $cacheWrites += (int) $result['writes'];
                    $failedCacheRows += (int) ($result['failed_rows'] ?? (($result['exit_code'] ?? 0) !== 0 ? 1 : 0));
                    $cursor = $cursor->addDay();
                }
            }
        }

        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'group_name' => $groupName,
            'tagid' => $tagId,
            'days' => $days,
            'candidates' => $candidates,
            'latest_time' => $latestTime !== null ? (string) $latestTime : null,
            'offset' => $effectiveOffset,
            'offset_mode' => $offsetMode,
            'next_offset' => $candidates > 0 ? ($effectiveOffset + count($rows)) % $candidates : 0,
            'batch_wrapped' => $wrapped,
            'source_truncated' => $candidates > count($rows),
            'rows' => $rows,
            'cache_writes' => $cacheWrites,
            'cache_jobs' => $cacheJobs,
            'failed_cache_rows' => $failedCacheRows,
            'failed_rows' => $failedCacheRows,
            'exit_code' => $failedCacheRows > 0 ? 1 : 0,
            'cache_generation_skipped' => 'legacy api/tag_period.php calls are intentionally not executed in planning mode',
            'writes' => $execute ? ['urt_show_tag_date'] : [],
        ];
    }

    /** @return array{0: int, 1: string} */
    private function effectiveOffset(
        int|string|null $offset,
        int $total,
        int $limit,
        CarbonImmutable $now,
        int $slotSeconds,
    ): array {
        if ($total < 1) {
            return [0, 'explicit'];
        }

        if (is_string($offset) && strtolower(trim($offset)) === 'auto') {
            return [(intdiv($now->getTimestamp(), $slotSeconds) * $limit) % $total, 'auto'];
        }

        return [max(0, (int) $offset) % $total, 'explicit'];
    }
}
