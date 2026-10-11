<?php

namespace App\Console\Commands\Reports;

use App\Console\GuardedIngestionCommand;
use App\Services\Ingestion\LiveTagDateCacheBuilder;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use InvalidArgumentException;
use Throwable;

class ReportsLiveTagDateBuildCommand extends GuardedIngestionCommand
{
    protected $signature = 'reports:live-tag-date:build {--from= : First cache date YYYY-MM-DD; preview defaults to yesterday} {--to= : Last cache date YYYY-MM-DD; preview defaults to --from} {--tagid= : Comma-separated channel tags that must all match} {--or= : Comma-separated channel tags where one must match} {--not= : Comma-separated channel tags to exclude} {--channel-limit=1000 : Matching channel source cap, max 5000} {--video-limit=1000 : Per-date live log cap, max 10000} {--keyword-limit=1000 : Keyword dictionary cap, max 5000} {--execute : Write urt_show_live_tag_date rows} {--dry-run : Force preview mode; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Preview or explicitly rebuild live tag/date cache rows from local polling logs and video titles';

    public function handle(LiveTagDateCacheBuilder $builder): int
    {
        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $from = trim((string) $this->option('from'));
        $to = trim((string) $this->option('to'));

        if ($execute && ($from === '' || $to === '')) {
            $this->error('reports:live-tag-date:build unavailable: --execute requires explicit --from and --to dates');

            return 1;
        }

        $defaultDate = CarbonImmutable::now((string) config('ingestion.timezone', 'Asia/Taipei'))->subDay()->toDateString();
        $from = $from !== '' ? $from : $defaultDate;
        $to = $to !== '' ? $to : $from;
        $integerList = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
            ->map(fn (string $value): int => (int) trim($value))
            ->filter(fn (int $value): bool => $value > 0)
            ->unique()
            ->sort()
            ->values()
            ->all();

        try {
            $payload = $builder->build(
                from: $from,
                to: $to,
                tagIds: $integerList('tagid'),
                orTagIds: $integerList('or'),
                notTagIds: $integerList('not'),
                videoLimit: (int) $this->option('video-limit'),
                keywordLimit: (int) $this->option('keyword-limit'),
                channelLimit: (int) $this->option('channel-limit'),
                execute: $execute,
            );
        } catch (InvalidArgumentException $exception) {
            $validDate = static function (string $date): bool {
                $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

                return $parsed !== false && $parsed->format('Y-m-d') === $date;
            };
            $payload = [
                'mode' => $execute ? 'execute' : 'ingestion-preview',
                'available' => false,
                'blocked_reason' => ! $validDate($from) || ! $validDate($to)
                    ? 'invalid_date_range'
                    : 'date_range_out_of_bounds',
                'failure' => 'validation_failed',
                'exception_class' => $exception::class,
                'from' => $from,
                'to' => $to,
                'writes' => 0,
                'failed_dates' => 0,
                'rows' => [],
            ];
        } catch (Throwable $exception) {
            $payload = [
                'mode' => $execute ? 'execute' : 'ingestion-preview',
                'available' => false,
                'blocked_reason' => 'cache_build_failed',
                'failure' => 'unexpected_exception',
                'exception_class' => $exception::class,
                'from' => $from,
                'to' => $to,
                'writes' => 0,
                'failed_dates' => 0,
                'rows' => [],
            ];
        }

        $failed = ! (bool) ($payload['available'] ?? false)
            || (int) ($payload['failed_dates'] ?? 0) > 0
            || ($payload['blocked_reason'] ?? null) !== null;

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return $failed ? 1 : 0;
        }

        $this->line(sprintf(
            'reports:live-tag-date:build mode=%s available=%s from=%s to=%s filters=%s/%s/%s dates=%d channels=%d/%d keywords=%d videos=%d invalid_logs=%d would_insert=%d would_update=%d inserted=%d updated=%d unchanged=%d failed=%d truncated=%s blocked_reason=%s generated_at=%s',
            $payload['mode'],
            ($payload['available'] ?? false) ? 'yes' : 'no',
            $payload['from'],
            $payload['to'],
            $payload['tagid'] ?? '',
            $payload['or'] ?? '',
            $payload['not'] ?? '',
            (int) ($payload['dates'] ?? 0),
            (int) ($payload['channels_matched'] ?? 0),
            (int) ($payload['channel_limit'] ?? 0),
            (int) ($payload['keywords_scanned'] ?? 0),
            (int) ($payload['videos_scanned'] ?? 0),
            (int) ($payload['invalid_log_rows'] ?? 0),
            (int) ($payload['would_insert'] ?? 0),
            (int) ($payload['would_update'] ?? 0),
            (int) ($payload['inserted'] ?? 0),
            (int) ($payload['updated'] ?? 0),
            (int) ($payload['unchanged'] ?? 0),
            (int) ($payload['failed_dates'] ?? 0),
            ($payload['source_truncated'] ?? false) ? 'yes' : 'no',
            $payload['blocked_reason'] ?? '-',
            $payload['generated_at'] ?? '-',
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d date=%s status=%s reason=%s videos=%d invalid_logs=%d channels=%d tags=%d distinct_tags=%d total_views=%d',
                $index + 1,
                $row['date'],
                $row['status'],
                $row['reason'] ?? '-',
                $row['count_videos'],
                $row['invalid_log_rows'],
                $row['count_channels'],
                $row['count_tags'],
                $row['tags_count'],
                $row['total_views'],
            ));
        }

        return $failed ? 1 : 0;

    }
}
