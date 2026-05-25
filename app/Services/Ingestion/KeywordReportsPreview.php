<?php

namespace App\Services\Ingestion;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

class KeywordReportsPreview
{
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
    public function preview(int $limit = 20, int $recentDays = 7, ?CarbonInterface $now = null): array
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = $now === null
            ? CarbonImmutable::now($timezone)
            : CarbonImmutable::instance($now->toDateTimeImmutable())->setTimezone($timezone);
        $limit = max(1, min(100, $limit));
        $recentDays = max(1, min(30, $recentDays));
        $recentSince = $now->subDays($recentDays)->format('Y-m-d H:i:s');

        $sourceRows = DB::table('tags')
            ->select(['tag', 'max_count', 'hours_count', 'max_hours', 'mtime', 'no_tag'])
            ->orderByDesc('hours_count')
            ->get();

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
            'mode' => 'read-only-preview',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'recent_since' => $recentSince,
            'source_tags' => $sourceRows->count(),
            'eligible_keywords' => count($eligible),
            'recent_keywords' => $recentCount,
            'excluded' => $excluded,
            'rows' => $rows,
            'filesystem_targets' => [
                'data/keyword.json',
                'data/keyword_all.json',
            ],
            'external_fetch_skipped' => 'legacy tag.analysis.tw fetch is intentionally skipped in read-only mode',
            'writes' => [],
        ];
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
