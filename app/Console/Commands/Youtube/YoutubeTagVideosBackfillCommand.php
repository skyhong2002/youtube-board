<?php

namespace App\Console\Commands\Youtube;

use App\Services\Ingestion\DirectYoutubeQuotaGuard;
use App\Services\Ingestion\TagVideoBackfillIngestion;
use DateTimeImmutable;
use Illuminate\Console\Command;
use Throwable;

class YoutubeTagVideosBackfillCommand extends Command
{
    protected $signature = 'youtube:tag-videos:backfill {--tagid=102 : Comma-separated required channel tag ids} {--or= : Comma-separated OR channel tag ids} {--not= : Comma-separated excluded channel tag ids} {--from= : Start date YYYY-MM-DD} {--to= : End date YYYY-MM-DD} {--days=2 : Relative day count when --from is omitted} {--limit=100 : Channel cap} {--max-pages=20 : Playlist pages per channel, max 200} {--max-results=50 : Playlist items per page, max 50} {--keyword-limit=100000 : Keywords scanned when rebuilding tag-date cache, max 100000} {--no-rebuild : Skip urt_show_tag_date rebuild after video crawl} {--execute : Call YouTube and write local video/cache rows} {--dry-run : Force dry-run preview; this is the default} {--json : Emit JSON instead of text}';

    protected $description = 'Paginated uploads crawl for all channels in a tag, then rebuild local tag-date cache';

    public function handle(TagVideoBackfillIngestion $backfill, DirectYoutubeQuotaGuard $quotaGuard): int
    {
        $ids = fn (string $option): array => collect(explode(',', (string) $this->option($option)))
            ->map(fn (string $id): int => (int) trim($id))
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();
        $tagIds = $ids('tagid');

        if ($tagIds === []) {
            $this->error('youtube:tag-videos:backfill requires --tagid');

            return 1;
        }

        $execute = (bool) $this->option('execute') && ! (bool) $this->option('dry-run');
        $from = $this->option('from');
        $to = $this->option('to');
        $validDate = static function (mixed $date): bool {
            if (! is_string($date)) {
                return false;
            }

            $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

            return $parsed instanceof DateTimeImmutable && $parsed->format('Y-m-d') === $date;
        };

        if (($from !== null && ! $validDate($from)) || ($to !== null && ! $validDate($to))) {
            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'available' => false,
                'blocked_reason' => 'invalid_date',
                'error' => 'date_options_must_be_valid_calendar_dates',
                'writes' => 0,
                'secrets' => 'not_printed',
            ];

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            } else {
                $this->error('youtube:tag-videos:backfill date options must be valid calendar dates in YYYY-MM-DD');
            }

            return 1;
        }

        $limit = max(1, min(500, (int) $this->option('limit')));
        $maxPages = max(1, min(200, (int) $this->option('max-pages')));
        $maxResults = max(1, min(50, (int) $this->option('max-results')));
        $keywordLimit = max(1, min(TagVideoBackfillIngestion::TAG_DATE_KEYWORD_LIMIT, (int) $this->option('keyword-limit')));

        try {
            $backfillCall = fn (): array => $backfill->run(
                tagIds: $tagIds,
                orTagIds: $ids('or'),
                notTagIds: $ids('not'),
                from: is_string($from) ? $from : null,
                to: is_string($to) ? $to : null,
                days: (int) $this->option('days'),
                limit: $limit,
                maxPages: $maxPages,
                maxResults: $maxResults,
                keywordLimit: $keywordLimit,
                rebuildTagDate: ! (bool) $this->option('no-rebuild'),
                execute: $execute,
            );

            if ($execute) {
                $quotaRun = $quotaGuard->run(
                    jobKey: 'youtube.tag_videos.backfill',
                    effectiveCommand: sprintf(
                        'youtube:tag-videos:backfill --execute --limit=%d --max-pages=%d --max-results=%d --keyword-limit=%d',
                        $limit,
                        $maxPages,
                        $maxResults,
                        $keywordLimit,
                    ),
                    callback: $backfillCall,
                );

                if (! $quotaRun['allowed']) {
                    $payload = $quotaGuard->blockedPayload($quotaRun['guard']);

                    if ((bool) $this->option('json')) {
                        $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
                    } else {
                        $this->line(sprintf(
                            'youtube:tag-videos:backfill unavailable: %s quota_date=%s planned_units=%d remaining_units=%d secrets=not_printed',
                            $payload['blocked_reason'],
                            (string) data_get($payload, 'youtube_quota_budget.quota_date', '-'),
                            (int) data_get($payload, 'youtube_quota_budget.planned_units', 0),
                            (int) data_get($payload, 'youtube_quota_budget.remaining_units', 0),
                        ));
                    }

                    return 1;
                }

                $payload = $quotaRun['payload'];
            } else {
                $payload = $backfillCall();
            }
        } catch (Throwable $exception) {
            $payload = [
                'mode' => $execute ? 'execute' : 'dry-run',
                'available' => false,
                'blocked_reason' => 'command_failed',
                'error' => $quotaGuard->sanitizedMessage($exception),
                'writes' => 0,
                'secrets' => 'not_printed',
            ];

            if ((bool) $this->option('json')) {
                $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            } else {
                $this->line('youtube:tag-videos:backfill unavailable: '.$payload['error'].' secrets=not_printed');
            }

            return 1;
        }

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return (int) ($payload['exit_code'] ?? ((int) ($payload['failed_channels'] ?? 0) > 0 ? 1 : 0));
        }

        $this->line(sprintf(
            'youtube:tag-videos:backfill mode=%s tagid=%s from=%s to=%s channels=%d failed_channels=%d crawl_complete=%s api_pages=%d videos=%d tag_date_writes=%d tag_date_skip=%s quota_planned=%d quota_actual=%d quota_remaining=%d quota_date=%s',
            $payload['mode'],
            $payload['tagid'],
            $payload['from'],
            $payload['to'],
            $payload['selected_channels'],
            (int) ($payload['failed_channels'] ?? 0),
            ($payload['crawl_complete'] ?? false) ? 'yes' : 'no',
            (int) ($payload['api_pages'] ?? 0),
            (int) ($payload['videos_in_range'] ?? 0),
            (int) ($payload['tag_date_writes'] ?? 0),
            $payload['tag_date_rebuild_skipped_reason'] ?? '-',
            (int) data_get($payload, 'youtube_quota_budget.planned_units', 0),
            (int) data_get($payload, 'youtube_quota_budget.actual_units', 0),
            (int) data_get($payload, 'youtube_quota_budget.remaining_units', 0),
            (string) data_get($payload, 'youtube_quota_budget.quota_date', '-'),
        ));

        return (int) ($payload['exit_code'] ?? ((int) ($payload['failed_channels'] ?? 0) > 0 ? 1 : 0));

    }
}
