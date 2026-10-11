<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\TagDateCacheBuilder;
use Carbon\CarbonImmutable;
use DateTimeImmutable;

class ReportsTagDateBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:tag-date:build {--tagid= : Comma-separated required channel tag ids, max 50} {--or= : Comma-separated OR channel tag ids, max 50} {--not= : Comma-separated excluded channel tag ids, max 50} {--date= : Single cache date} {--from= : Start date for cache range} {--to= : End date for cache range} {--days=30 : Relative day count when --from is omitted} {--today=0 : Days before today for relative end date} {--date-limit=400 : Date target cap, max 400; larger ranges are blocked} {--channel-limit=1000 : Matched source channel scan cap, max 5000} {--video-limit=10000 : Raw video scan cap per date, max 100000} {--keyword-limit=5000 : Local keyword source scan cap, max 20000} {--keywords= : Optional comma-separated keyword subset, max 500} {--execute : Write urt_show_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Build legacy urt_show_tag_date rows from local videos and tags; dry-run by default';

    public function handle(TagDateCacheBuilder $builder): int
    {
        $timezone = (string) config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
        $now = CarbonImmutable::now($timezone);
        $tagIds = collect(explode(',', (string) $this->option('tagid')))
            ->map(fn (string $id): int => (int) trim($id))
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();

        if ($tagIds === []) {
            $this->error('reports:tag-date:build requires --tagid');

            return 1;
        }

        $validDate = static function (string $date): bool {
            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

            return $parsed instanceof DateTimeImmutable && $parsed->format('Y-m-d') === $date;
        };
        $to = $this->option('date')
            ? (string) $this->option('date')
            : ($this->option('to') ? (string) $this->option('to') : $now->subDays(max(0, (int) $this->option('today')))->toDateString());

        if (! $validDate($to)) {
            $this->error('reports:tag-date:build date options must be valid calendar dates in YYYY-MM-DD');

            return 1;
        }

        $from = $this->option('date')
            ? $to
            : ($this->option('from') ? (string) $this->option('from') : CarbonImmutable::parse($to, $timezone)->subDays(max(1, (int) $this->option('days')) - 1)->toDateString());

        if (! $validDate($from)) {
            $this->error('reports:tag-date:build date options must be valid calendar dates in YYYY-MM-DD');

            return 1;
        }

        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $ids = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
            ->map(fn (string $id): int => (int) trim($id))
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();
        $keywords = collect(explode(',', (string) $this->option('keywords')))
            ->map(fn (string $keyword): string => trim($keyword))
            ->filter(fn (string $keyword): bool => $keyword !== '')
            ->values()
            ->all();

        $payload = $builder->buildRange(
            tagIds: $tagIds,
            from: $from,
            to: $to,
            orTagIds: $ids('or'),
            notTagIds: $ids('not'),
            keywordLimit: (int) $this->option('keyword-limit'),
            onlyKeywords: $keywords,
            channelLimit: (int) $this->option('channel-limit'),
            videoLimit: (int) $this->option('video-limit'),
            execute: (bool) $this->option('execute') && ! (bool) $this->option('dry-run'),
            now: $now,
            maxDates: (int) $this->option('date-limit'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? 0);
        }

        $this->line(sprintf(
            'reports:tag-date:build mode=%s status=%s tagid=%s from=%s to=%s rows=%d writes=%d failed_rows=%d source_complete=%s truncated=%s caps=date:%d,channels:%d,videos:%d,keywords:%d blocked_reason=%s',
            $payload['mode'],
            $payload['status'],
            implode(',', $tagIds),
            $from,
            $to,
            $payload['dates_selected'],
            $payload['writes'],
            $payload['failed_rows'],
            $payload['source_complete'] ? 'yes' : 'no',
            $payload['source_truncated'] ? 'yes' : 'no',
            $payload['caps']['date_range'],
            $payload['caps']['channel_scan'],
            $payload['caps']['video_scan_per_date'],
            $payload['caps']['keyword_scan'],
            $payload['blocked_reason'] ?? 'none',
        ));

        foreach (array_slice($payload['rows'], 0, 20) as $row) {
            $this->line(sprintf(
                '%s status=%s channels=%d videos=%d tags=%d views=%d writes=%d truncated=%s blocked_reason=%s',
                $row['date'],
                $row['status'],
                $row['channels_matched'],
                $row['videos_scanned'],
                $row['tags_count'],
                $row['total_views'],
                $row['writes'],
                $row['source_truncated'] ? 'yes' : 'no',
                $row['blocked_reason'] ?? 'none',
            ));
        }

        return (int) ($payload['exit_code'] ?? 0);

    }
}
