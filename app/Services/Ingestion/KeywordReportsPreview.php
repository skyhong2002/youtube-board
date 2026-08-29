<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class KeywordReportsPreview
{
    private const LOCAL_SOURCE_LIMIT = 10000;

    private const REMOTE_SOURCE_LIMIT = 5000;

    /**
     * @return array{
     *     mode: string,
     *     generated_at: string,
     *     recent_since: string,
     *     source_tags: int,
     *     eligible_keywords: int,
     *     recent_keywords: int,
     *     excluded: array{no_tag: int, single_char: int, numeric: int, short_ascii: int},
     *     rows: list<array<string, mixed>>,
     *     filesystem_targets: list<string>,
     *     external_fetch_skipped: string,
     *     writes: list<string>
     * }
     */
    public function preview(
        int $limit = 20,
        int $recentDays = 7,
        ?CarbonInterface $now = null,
        bool $execute = false,
        int $hours = 2,
        int|string|null $offset = 0,
    ): array {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(100, $limit));
        $recentDays = max(1, min(30, $recentDays));
        $recentSince = $now->subDays($recentDays)->format('Y-m-d H:i:s');
        $syncResult = [
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

        $sourceRows = $this->localSourceRows();
        $localSourceCount = $this->localSourceCount();

        if ($execute && (bool) config('ingestion.legacy_external_sync_enabled', false)) {
            $syncResult = $this->syncLegacyTags($now, $hours, $limit, $offset);
            $sourceRows = $this->localSourceRows();
            $localSourceCount = $this->localSourceCount();
        }

        $excluded = [
            'no_tag' => 0,
            'single_char' => 0,
            'numeric' => 0,
            'short_ascii' => 0,
        ];
        $eligible = [];
        $recentCount = 0;

        foreach ($sourceRows as $row) {
            $tag = (string) $row->tag;
            $reason = $this->exclusionReason($tag, (int) ($row->no_tag ?? 0));

            if ($reason !== null) {
                $excluded[$reason]++;

                continue;
            }

            $maxCount = (int) ($row->max_count ?? 0);
            $hoursCount = (int) ($row->hours_count ?? 0);
            $weight = log($maxCount + 10) + log($hoursCount + 50);
            $recent = (string) ($row->mtime ?? '') > $recentSince;

            if ($recent) {
                $recentCount++;
            }

            $eligible[] = [
                'tag' => $tag,
                'legacy_weight' => sprintf('%.2f', $weight),
                'weight' => $weight,
                'max_count' => $maxCount,
                'hours_count' => $hoursCount,
                'max_hours' => (string) ($row->max_hours ?? ''),
                'mtime' => (string) ($row->mtime ?? ''),
                'included_in_keyword_all' => $recent,
            ];
        }

        $rows = collect($eligible)
            ->sortByDesc('weight')
            ->take($limit)
            ->map(function (array $row): array {
                unset($row['weight']);

                return $row;
            })
            ->values()
            ->all();

        return [
            'mode' => $execute ? 'execute' : 'ingestion-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'recent_since' => $recentSince,
            'source_tags' => $localSourceCount,
            'source_limit' => self::LOCAL_SOURCE_LIMIT,
            'source_selected' => $sourceRows->count(),
            'source_complete' => true,
            'source_truncated' => $localSourceCount > $sourceRows->count(),
            'source_policy' => 'bounded_ranked_local_keywords',
            'blocked_reason' => null,
            'eligible_keywords' => count($eligible),
            'recent_keywords' => $recentCount,
            'excluded' => $excluded,
            'rows' => $rows,
            'filesystem_targets' => [
                'data/keyword.json',
                'data/keyword_all.json',
            ],
            'external_fetch_skipped' => (bool) config('ingestion.legacy_external_sync_enabled', false)
                ? ($execute ? '' : 'legacy external sync is not called in preview mode')
                : 'legacy external sync is not called because it is disabled; Laravel local tags are the source of record',
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
            'writes' => $syncResult['synced'] > 0 ? ['tags'] : [],
        ];
    }

    /**
     * @return array{candidates: int, attempted: int, synced: int, failed: int, offset: int, offset_mode: string, next_offset: int, batch_wrapped: bool, source_truncated: bool}
     */
    private function syncLegacyTags(
        CarbonImmutable $now,
        int $hours,
        int $limit,
        int|string|null $offset,
    ): array {
        $hours = max(1, min(168, $hours));
        $limit = max(1, min(100, $limit));
        $response = Http::timeout(30)
            ->retry(2, 500)
            ->get('https://tag.analysis.tw/api/tag_json.php', ['hours' => $hours]);

        if (! $response->successful()) {
            throw new \RuntimeException('tag.analysis.tw keyword sync failed status='.$response->status());
        }

        $rows = $response->json();

        if (! is_array($rows) || ! array_is_list($rows)) {
            throw new \RuntimeException('tag.analysis.tw keyword sync returned non-json payload');
        }

        if (count($rows) > self::REMOTE_SOURCE_LIMIT) {
            throw new \RuntimeException('tag.analysis.tw keyword sync source limit exceeded');
        }

        $candidates = collect($rows)->values();
        [$effectiveOffset, $offsetMode] = $this->effectiveOffset($offset, $candidates->count(), $limit, $now);
        [$attemptedRows, $wrapped] = $this->wrappedBatch($candidates, $effectiveOffset, $limit);
        $validatedRows = collect();
        $failed = 0;

        foreach ($attemptedRows as $index => $candidate) {
            try {
                $validatedRows->push($this->validatedRemoteRow($candidate));
            } catch (Throwable $exception) {
                $failed++;
                Log::warning('Keyword sync row failed.', [
                    'source_index' => $this->sourceIndex($effectiveOffset, (int) $index, $candidates->count()),
                    'reason' => 'invalid_remote_row',
                    'exception_class' => $exception::class,
                ]);
            }
        }

        $synced = 0;
        $generatedAt = $now->format('Y-m-d H:i:s');

        foreach ($validatedRows as $row) {
            $tag = $row['tag'];
            $values = [
                'mtime' => $row['mtime'],
                'max_count' => $row['max_count'],
                'max_hours' => $row['max_hours'],
                'hours_count' => $row['hours_count'],
                'no_tag' => $row['no_tag'],
            ];

            try {
                DB::transaction(function () use ($tag, $values, $generatedAt): void {
                    $existingPk = DB::table('tags')->where('tag', $tag)->value('pk');

                    if ($existingPk === null) {
                        DB::table('tags')->insert($values + [
                            'ctime' => $generatedAt,
                            'tag' => $tag,
                        ]);
                    } else {
                        DB::table('tags')->where('pk', $existingPk)->update($values);
                    }
                });

                $synced++;
            } catch (Throwable $exception) {
                $failed++;
                Log::warning('Keyword sync row failed.', [
                    'tag_hash' => hash('sha256', $tag),
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

    private function sourceIndex(int $offset, int $batchIndex, int $total): int
    {
        return $total > 0 ? ($offset + $batchIndex) % $total : 0;
    }

    private function localSourceRows()
    {
        return DB::table('tags')
            ->select(['tag', 'max_count', 'hours_count', 'max_hours', 'mtime', 'no_tag'])
            ->orderByDesc('hours_count')
            ->orderByDesc('max_count')
            ->orderBy('tag')
            ->limit(self::LOCAL_SOURCE_LIMIT)
            ->get();
    }

    private function localSourceCount(): int
    {
        return DB::table('tags')->count();
    }

    /** @return array{tag: string, max_count: int, hours_count: int, max_hours: string, mtime: string, no_tag: int} */
    private function validatedRemoteRow(mixed $row): array
    {
        $required = ['tag', 'max_count', 'hours_count', 'max_hours', 'mtime', 'no_tag'];

        if (! is_array($row)) {
            throw new \RuntimeException('tag.analysis.tw keyword sync returned malformed row');
        }

        foreach ($required as $key) {
            if (! array_key_exists($key, $row)) {
                throw new \RuntimeException('tag.analysis.tw keyword sync returned malformed row');
            }
        }

        $tag = is_string($row['tag']) ? trim($row['tag']) : '';
        $maxCount = $this->nonNegativeInteger($row['max_count']);
        $hoursCount = $this->nonNegativeInteger($row['hours_count']);
        $maxHours = $this->dateTime($row['max_hours']);
        $mtime = $this->dateTime($row['mtime']);
        $noTag = $this->noTag($row['no_tag']);

        if (
            $tag === ''
            || mb_strlen($tag, 'UTF-8') > 255
            || $maxCount === null
            || $hoursCount === null
            || $maxHours === null
            || $mtime === null
            || $noTag === null
        ) {
            throw new \RuntimeException('tag.analysis.tw keyword sync returned malformed row');
        }

        return [
            'tag' => $tag,
            'max_count' => $maxCount,
            'hours_count' => $hoursCount,
            'max_hours' => $maxHours,
            'mtime' => $mtime,
            'no_tag' => $noTag,
        ];
    }

    private function nonNegativeInteger(mixed $value): ?int
    {
        if (! is_int($value) && ! (is_string($value) && preg_match('/^\d+$/', $value))) {
            return null;
        }

        $validated = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);

        return $validated === false ? null : $validated;
    }

    private function noTag(mixed $value): ?int
    {
        if ($value === null) {
            return 0;
        }

        if ($value === 0 || $value === '0') {
            return 0;
        }

        if ($value === 1 || $value === '1') {
            return 1;
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

    /** @return array{0: Collection<int, mixed>, 1: bool} */
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

    private function exclusionReason(string $tag, int $noTag): ?string
    {
        if ($noTag > 0) {
            return 'no_tag';
        }

        if (mb_strlen($tag, 'UTF-8') <= 1) {
            return 'single_char';
        }

        if (is_numeric($tag)) {
            return 'numeric';
        }

        if (! preg_match('/[^A-Za-z]/', $tag) && strlen($tag) < 3) {
            return 'short_ascii';
        }

        return null;
    }
}
