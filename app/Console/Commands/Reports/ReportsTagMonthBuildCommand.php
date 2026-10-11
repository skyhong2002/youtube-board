<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\TagMonthCacheBuilder;

class ReportsTagMonthBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:tag-month:build {--months= : Required comma-separated months in YYYY-MM or YYYY-MM-01 format} {--subjects= : Required comma-separated keyword subjects} {--tagid= : Comma-separated required channel tag ids} {--or= : Comma-separated OR channel tag ids} {--not= : Comma-separated excluded channel tag ids} {--month-limit=12 : Month cap, max 24} {--subject-limit=20 : Subject cap, max 100} {--source-row-limit=31 : Latest daily source row cap per month, max 31} {--execute : Write urt_show_tag_month rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Build capped keyword month caches from local urt_show_tag_date rows; preview by default and manual only';

    public function handle(TagMonthCacheBuilder $builder): int
    {
        $csv = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
            ->map(fn (string $value): string => trim($value))
            ->filter(fn (string $value): bool => $value !== '')
            ->values()
            ->all();
        $ids = fn (string $option): array => collect($csv($option))
            ->map(fn (string $value): int => (int) $value)
            ->filter(fn (int $value): bool => $value > 0)
            ->values()
            ->all();
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $result = $builder->build(
            months: $csv('months'),
            subjects: $csv('subjects'),
            tagIds: $ids('tagid'),
            orTagIds: $ids('or'),
            notTagIds: $ids('not'),
            monthLimit: (int) $this->option('month-limit'),
            subjectLimit: (int) $this->option('subject-limit'),
            sourceRowLimit: (int) $this->option('source-row-limit'),
            execute: $execute,
        );
        $exitCode = $result['blocked_reason'] !== null || (int) $result['failed_subjects'] > 0 ? 1 : 0;

        if ((bool) $this->option('json')) {
            $this->line(json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $exitCode;
        }

        $this->line(sprintf(
            'reports:tag-month:build mode=%s available=%s months=%d/%d ignored=%d subjects=%d/%d ignored=%d source_rows=%d/%d truncated=%s would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d skipped=%d failed=%d writes=%d blocked_reason=%s',
            $result['mode'],
            $result['available'] ? 'true' : 'false',
            count($result['months']),
            $result['months_requested'],
            $result['months_ignored'],
            count($result['subjects']),
            $result['subjects_requested'],
            $result['subjects_ignored'],
            $result['source_rows'],
            $result['source_row_limit'],
            ($result['source_truncated'] ?? false) ? 'yes' : 'no',
            $result['would_insert'],
            $result['would_update'],
            $result['inserted'],
            $result['updated'],
            $result['unchanged'],
            $result['skipped'],
            $result['failed_subjects'],
            $result['writes'],
            $result['blocked_reason'] ?? 'none',
        ));

        foreach (array_slice($result['rows'], 0, 30) as $row) {
            $this->line(sprintf(
                '%s subject=%s status=%s source_dates=%d videos=%d views=%d reason=%s',
                $row['month'],
                $row['subject'],
                $row['status'],
                $row['source_dates'],
                $row['count_videos'],
                $row['total_views'],
                $row['reason'] ?? 'none',
            ));
        }

        return $exitCode;

    }
}
