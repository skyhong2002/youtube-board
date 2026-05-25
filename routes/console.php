<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schedule;
use Carbon\CarbonImmutable;
use App\Services\Ingestion\AiDailyPreview;
use App\Services\Ingestion\AiHourlyPreview;
use App\Services\Ingestion\CommentFetchPreview;
use App\Services\Ingestion\CommentQueuePreview;
use App\Services\Ingestion\GroupReportsPreview;
use App\Services\Ingestion\ChannelCountsPreview;
use App\Services\Ingestion\ChannelStatisticsPreview;
use App\Services\Ingestion\ChannelVideosDiscoveryPreview;
use App\Services\Ingestion\IngestionJobRegistry;
use App\Services\Ingestion\IngestionRunHistory;
use App\Services\Ingestion\IngestionSchedulerRunner;
use App\Services\Ingestion\KeywordReportsPreview;
use App\Services\Ingestion\LiveCleanupPreview;
use App\Services\Ingestion\LiveDisplayCachePreview;
use App\Services\Ingestion\LivePollingPreview;
use App\Services\Ingestion\LiveStaticHtmlPreview;
use App\Services\Ingestion\MayorStaticReportsPreview;
use App\Services\Ingestion\PeopleReportsPreview;
use App\Services\Ingestion\ScheduleReportsPreview;
use App\Services\Ingestion\StaticHtmlReportsPreview;
use App\Services\Ingestion\TvbsChannelVideosDiscoveryPreview;
use App\Services\Ingestion\TvbsLivePollingPreview;
use App\Services\Ingestion\VideoDurationsPreview;
use App\Services\Ingestion\VideoStatisticsPreview;
use Illuminate\Database\QueryException;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('ingestion:list', function (IngestionJobRegistry $registry) {
    $summary = $registry->summary();

    $this->line(sprintf(
        'scheduler=%s total=%d planned=%d active=%d blocked=%d command_ready=%d command_missing=%d',
        $summary['scheduler_enabled'] ? 'enabled' : 'disabled',
        $summary['total'],
        $summary['planned'],
        $summary['active'],
        $summary['blocked'],
        $summary['command_ready'],
        $summary['command_missing'],
    ));

    foreach ($registry->jobs() as $job) {
        $this->line(sprintf(
            '[P%d] %s command:%s %s -> %s (%s)',
            $job['priority'],
            $job['status'],
            $job['command_exists'] ? 'ready' : 'missing',
            $job['legacy_command'],
            $job['modern_command'],
            $job['schedule'],
        ));
    }
})->purpose('List the planned legacy-to-Laravel ingestion command registry');

Artisan::command('ingestion:run {--execute : Execute active due jobs instead of dry-running} {--record : Store the run result in local ingestion run history} {--at= : Timestamp to evaluate, for deterministic checks} {--job= : Evaluate one registry job key} {--all : Include jobs that are not currently due}', function (IngestionSchedulerRunner $runner, IngestionRunHistory $history) {
    $timezone = config('ingestion.timezone', config('app.timezone', 'Asia/Taipei'));
    $at = $this->option('at')
        ? CarbonImmutable::parse((string) $this->option('at'), $timezone)
        : CarbonImmutable::now($timezone);

    $result = $runner->run(
        at: $at,
        execute: (bool) $this->option('execute'),
        jobKey: $this->option('job') ? (string) $this->option('job') : null,
        showAll: (bool) $this->option('all'),
    );

    $this->line(sprintf(
        'mode=%s scheduler=%s at=%s evaluated=%d due=%d executed=%d skipped=%d failed=%d',
        $result['mode'],
        $result['scheduler_enabled'] ? 'enabled' : 'disabled',
        $result['at'],
        $result['summary']['evaluated'],
        $result['summary']['due'],
        $result['summary']['executed'],
        $result['summary']['skipped'],
        $result['summary']['failed'],
    ));

    foreach ($result['jobs'] as $job) {
        $this->line(sprintf(
            '[%s] %s %s -> %s (%s)',
            $job['due'] ? 'due' : 'not-due',
            $job['key'],
            $job['action'],
            $job['command'],
            $job['schedule'],
        ));
    }

    if ((bool) $this->option('record')) {
        $record = $history->record($result, [
            'mode' => (bool) $this->option('execute') ? 'execute' : 'dry-run',
            'job' => $this->option('job') ? (string) $this->option('job') : null,
            'at' => $at->toDateTimeString().' '.$at->getTimezone()->getName(),
            'show_all' => (bool) $this->option('all'),
            'scheduler_enabled_temporarily' => false,
            'original_scheduler_enabled' => (bool) config('ingestion.scheduler_enabled', false),
            'source' => 'artisan',
        ]);

        $this->line(sprintf('recorded=%s path=%s', $record['id'], $record['path']));
    }
})->purpose('Evaluate or execute due ingestion jobs from the legacy cron registry');

Artisan::command('youtube:channels:stats {--u_id= : Optional channel u_id to preview} {--hours=22 : Legacy stime expiration window} {--limit=20 : Number of channels to print, capped at the legacy loop count} {--json : Emit JSON instead of text}', function (ChannelStatisticsPreview $preview) {
    $uId = $this->option('u_id') !== null ? max(1, (int) $this->option('u_id')) : null;
    $hours = max(1, min(168, (int) $this->option('hours')));
    $limit = max(1, min(61, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(uId: $uId, hours: $hours, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:channels:stats mode=read-only-preview source=%s active_channels=%d unchecked_channels=%d stale_channels=%d eligible_rows=%d selected_rows=%d missing_youtube_id=%d hours=%d expire_time=%s would_call_api=%s generated_at=%s writes=0 api_call=skipped channel_update=skipped count_update=skipped log_update=skipped',
            $payload['source'],
            $payload['active_channels'],
            $payload['unchecked_channels'],
            $payload['stale_channels'],
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['missing_youtube_id'],
            $payload['hours'],
            $payload['expire_time'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d u_id=%d youtube_id=%s stime=%s would_set_stime=%s view=%s sub=%s videos=%s title="%s"',
                $index + 1,
                $row['u_id'],
                $row['youtube_id'],
                $row['current_stime'] ?? '-',
                $row['would_set_stime'],
                $row['channel_counts']['viewCount'] !== null ? number_format($row['channel_counts']['viewCount']) : 'n/a',
                $row['channel_counts']['subscriberCount'] !== null ? number_format($row['channel_counts']['subscriberCount']) : 'n/a',
                $row['channel_counts']['videoCount'] !== null ? number_format($row['channel_counts']['videoCount']) : 'n/a',
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:channels:stats unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy channel statistics polling; does not call YouTube or update channel/count/log tables');

Artisan::command('youtube:channels:videos {--id= : Optional legacy channel u_id to preview} {--live= : Legacy live filter, 1 uses tag 52 and 2 uses tag 89} {--rescan : Preview legacy large-channel rescan branch} {--hours=700 : Legacy hours option, retained for compatibility} {--force=1 : Legacy duplicate-process threshold, shown only} {--limit=20 : Number of channels to print, capped at legacy loop count} {--json : Emit JSON instead of text}', function (ChannelVideosDiscoveryPreview $preview) {
    $uId = $this->option('id') !== null ? max(1, (int) $this->option('id')) : null;
    $live = $this->option('live') !== null ? (int) $this->option('live') : null;
    $hours = max(1, min(24 * 365, (int) $this->option('hours')));
    $force = max(1, min(20, (int) $this->option('force')));
    $limit = max(1, min(81, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(
            uId: $uId,
            live: $live,
            rescan: (bool) $this->option('rescan'),
            hours: $hours,
            force: $force,
            limit: $limit,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:channels:videos mode=read-only-preview source=%s active_channels=%d due_channels=%d tagged_channels=%s eligible_rows=%d selected_rows=%d missing_uploads_playlist=%d live=%s limit=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped video_insert=skipped schedule_insert=skipped live_insert=skipped channel_vtime_update=skipped',
            $payload['source'],
            $payload['active_channels'],
            $payload['due_channels'],
            $payload['tagged_channels'] !== null ? (string) $payload['tagged_channels'] : 'n/a',
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['missing_uploads_playlist'],
            $payload['live'] !== null ? (string) $payload['live'] : 'none',
            $payload['limit'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d u_id=%d uploads=%s vtime=%s local_week=%d estimated_next_vtime=%s title="%s"',
                $index + 1,
                $row['u_id'],
                $row['uploads'] !== '' ? $row['uploads'] : '-',
                $row['current_vtime'] ?? '-',
                $row['local_recent_week_count'],
                $row['estimated_next_vtime_from_local_week_count'],
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:channels:videos unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy channel playlist discovery; does not call YouTube or insert video/live/schedule rows');

Artisan::command('youtube:tvbs:videos {--tag=29 : Legacy TVBS channel tag id in urt_count.tags} {--hours=700 : Legacy hours option, retained for compatibility} {--force=1 : Legacy duplicate-process threshold, shown only} {--limit=20 : Number of channels to print, capped at the legacy loop count} {--json : Emit JSON instead of text}', function (TvbsChannelVideosDiscoveryPreview $preview) {
    $tagId = max(1, (int) $this->option('tag'));
    $hours = max(1, min(24 * 365, (int) $this->option('hours')));
    $force = max(1, min(20, (int) $this->option('force')));
    $limit = max(1, min(80, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(
            tagId: $tagId,
            hours: $hours,
            force: $force,
            limit: $limit,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:tvbs:videos mode=read-only-preview source=%s tag=%d active_channels=%d tagged_channels=%d eligible_rows=%d selected_rows=%d missing_uploads_playlist=%d legacy_loop_limit=%d legacy_sleep_seconds=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped video_insert=skipped schedule_insert=skipped tvbs_live_insert=skipped',
            $payload['source'],
            $payload['tvbs_tag_id'],
            $payload['active_channels'],
            $payload['tagged_channels'],
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['missing_uploads_playlist'],
            $payload['legacy_loop_limit'],
            $payload['legacy_sleep_seconds'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d u_id=%d uploads=%s local_week=%d tvbs_live=%d tvbs_active=%d title="%s"',
                $index + 1,
                $row['u_id'],
                $row['uploads'] !== '' ? $row['uploads'] : '-',
                $row['local_recent_week_count'],
                $row['local_tvbs_live_rows'],
                $row['local_tvbs_active_live_rows'],
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:tvbs:videos unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy TVBS channel playlist discovery; does not call YouTube or insert video/live/schedule rows');

Artisan::command('youtube:live:poll {--videoId= : Optional live video id to preview} {--interval=11 : Legacy freshness interval in minutes} {--limit=20 : Number of live rows to print, capped at the legacy loop count} {--json : Emit JSON instead of text}', function (LivePollingPreview $preview) {
    $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;
    $interval = max(1, min(240, (int) $this->option('interval')));
    $limit = max(1, min(50, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(videoId: $videoId, intervalMinutes: $interval, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:live:poll mode=read-only-preview source=%s active_live_rows=%d eligible_rows=%d selected_rows=%d existing_today_log_rows=%d missing_today_log_rows=%d interval_minutes=%d too_soon=%s would_call_api=%s generated_at=%s writes=0 api_call=skipped live_update=skipped log_update=skipped',
            $payload['source'],
            $payload['active_live_rows'],
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['existing_today_log_rows'],
            $payload['missing_today_log_rows'],
            $payload['interval_minutes'],
            $payload['too_soon'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        if ($payload['skip_reason'] !== null) {
            $this->line('skip_reason='.$payload['skip_reason']);
        }

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d videoId=%s u_id=%s mtime=%s viewers=%s max=%s today_log=%s log_points=%d minute=%s title="%s"',
                $index + 1,
                $row['video_id'],
                $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                $row['mtime'] ?? '-',
                $row['concurrent_viewers'] !== null ? number_format($row['concurrent_viewers']) : 'n/a',
                $row['max_current'] !== null ? number_format($row['max_current']) : 'n/a',
                $row['today_log_exists'] ? 'yes' : 'no',
                $row['today_log_points'],
                $row['would_write_minute'],
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:live:poll unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy live stream polling; does not call YouTube or update live/log tables');

Artisan::command('youtube:tvbs:live:poll {--videoId= : Optional TVBS live video id to preview} {--interval=11 : Legacy interval option retained; get_live_tvbs.php uses a hard-coded 40 seconds} {--stale-seconds=40 : Actual TVBS freshness cutoff in seconds} {--limit=20 : Number of live rows to print, capped at the legacy batch count} {--json : Emit JSON instead of text}', function (TvbsLivePollingPreview $preview) {
    $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;
    $interval = max(1, min(240, (int) $this->option('interval')));
    $staleSeconds = max(10, min(3600, (int) $this->option('stale-seconds')));
    $limit = max(1, min(50, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(videoId: $videoId, intervalMinutes: $interval, staleSeconds: $staleSeconds, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:tvbs:live:poll mode=read-only-preview source=%s active_live_rows=%d eligible_rows=%d selected_rows=%d existing_today_log_rows=%d missing_today_log_rows=%d effective_stale_seconds=%d too_soon=%s would_call_api=%s generated_at=%s writes=0 api_call=skipped tvbs_live_update=skipped tvbs_log_update=skipped',
            $payload['source'],
            $payload['active_live_rows'],
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['existing_today_log_rows'],
            $payload['missing_today_log_rows'],
            $payload['effective_stale_seconds'],
            $payload['too_soon'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        if ($payload['single_video_table_note'] !== null) {
            $this->line('compatibility_note='.$payload['single_video_table_note']);
        }

        if ($payload['skip_reason'] !== null) {
            $this->line('skip_reason='.$payload['skip_reason']);
        }

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d videoId=%s u_id=%s mtime=%s viewers=%s max=%s today_log=%s log_points=%d minute=%s title="%s"',
                $index + 1,
                $row['video_id'],
                $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                $row['mtime'] ?? '-',
                $row['concurrent_viewers'] !== null ? number_format($row['concurrent_viewers']) : 'n/a',
                $row['max_current'] !== null ? number_format($row['max_current']) : 'n/a',
                $row['today_log_exists'] ? 'yes' : 'no',
                $row['today_log_points'],
                $row['would_write_minute'],
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:tvbs:live:poll unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy TVBS live stream polling; does not call YouTube or update TVBS live/log tables');

Artisan::command('reports:live:show {--limit=10 : Number of top live rows to print} {--json : Emit JSON instead of text}', function () {
    $limit = max(1, min(50, (int) $this->option('limit')));
    $now = now(config('ingestion.timezone', 'Asia/Taipei'));
    $latestTime = $now->copy()->subHour()->format('Y-m-d H:i:s');
    $today = $now->toDateString();

    try {
        $activeLive = DB::table('urt_video_live')
            ->whereNull('actualEndTime')
            ->where('concurrentViewers', '>', 0)
            ->where('mtime', '>=', $latestTime)
            ->count();

        $topRows = DB::table('urt_video_live')
            ->select(['videoId', 'u_id', 'concurrentViewers', 'max_current', 'mtime'])
            ->whereNull('actualEndTime')
            ->where('concurrentViewers', '>', 0)
            ->where('mtime', '>=', $latestTime)
            ->orderByDesc('concurrentViewers')
            ->limit($limit)
            ->get();

        $videoIds = $topRows->pluck('videoId')->filter()->unique()->values()->all();
        $displayRows = $videoIds === []
            ? collect()
            : DB::table('urt_show_video_live')
                ->whereIn('videoId', $videoIds)
                ->get()
                ->keyBy('videoId');

        $logRowsToday = DB::table('urt_video_live_log')
            ->where('the_date', $today)
            ->count();

        $rows = $topRows
            ->map(function (object $row, int $index) use ($displayRows): array {
                $display = $displayRows->get($row->videoId);

                return [
                    'rank' => $index + 1,
                    'video_id' => (string) $row->videoId,
                    'u_id' => $row->u_id !== null ? (int) $row->u_id : null,
                    'title' => (string) ($display->title ?? $row->videoId),
                    'channel_title' => (string) ($display->channelTitle ?? 'Unknown channel'),
                    'current_viewers' => (int) $row->concurrentViewers,
                    'max_current' => $row->max_current !== null ? (int) $row->max_current : null,
                    'mtime' => (string) ($row->mtime ?? ''),
                ];
            })
            ->values()
            ->all();

        $payload = [
            'mode' => 'read-only',
            'generated_at' => $now->format('Y-m-d H:i:s'),
            'active_live' => $activeLive,
            'shown' => count($rows),
            'log_rows_today' => $logRowsToday,
            'rows' => $rows,
            'writes' => [],
        ];

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:live:show mode=read-only active_live=%d shown=%d log_rows_today=%d generated_at=%s writes=0',
            $payload['active_live'],
            $payload['shown'],
            $payload['log_rows_today'],
            $payload['generated_at'],
        ));

        foreach ($rows as $row) {
            $this->line(sprintf(
                '#%d %s viewers=%d peak=%s channel="%s" title="%s"',
                $row['rank'],
                $row['video_id'],
                $row['current_viewers'],
                $row['max_current'] !== null ? number_format($row['max_current']) : 'n/a',
                $row['channel_title'],
                mb_strimwidth($row['title'], 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:show unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only local snapshot of the live display report; does not call YouTube or write cache tables');

Artisan::command('reports:live:build {--hours=2 : Live rows newer than this many hours are considered} {--limit=20 : Number of preview rows to print} {--json : Emit JSON instead of text}', function (LiveDisplayCachePreview $preview) {
    $hours = max(1, min(720, (int) $this->option('hours')));
    $limit = max(1, min(100, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(hours: $hours, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:live:build mode=read-only-preview candidates=%d already_cached=%d would_insert=%d missing_video_metadata=%d hours=%d expire_time=%s generated_at=%s writes=0',
            $payload['candidates'],
            $payload['already_cached'],
            $payload['would_insert'],
            $payload['missing_video_metadata'],
            $payload['hours'],
            $payload['expire_time'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d pk_live=%d video=%s v_pk=%d channel="%s" title="%s"',
                $index + 1,
                $row['pk_live'],
                $row['video_id'],
                $row['v_pk'],
                $row['channel_title'],
                mb_strimwidth($row['title'], 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:build unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy live display cache inserts; does not call YouTube or write cache tables');

Artisan::command('youtube:live:cleanup {--limit=20 : Number of stale live rows to print} {--json : Emit JSON instead of text}', function (LiveCleanupPreview $preview) {
    try {
        $payload = $preview->staleLivePreview(limit: (int) $this->option('limit'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:live:cleanup mode=read-only-preview candidates=%d would_mark_deleted=%d grace_rows=%d too_soon=%s scheduled_before=%s generated_at=%s writes=0 live_update=skipped',
            $payload['candidates'],
            $payload['would_mark_deleted'],
            $payload['grace_rows'],
            $payload['too_soon'],
            $payload['scheduled_before'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s mtime=%s scheduledStartTime=%s max_current=%s',
                $index + 1,
                $row['video_id'],
                $row['mtime'] ?? '-',
                $row['scheduled_start_time'] ?? '-',
                $row['max_current'] ?? '-',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:live:cleanup unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy stale live cleanup; does not update urt_video_live');

Artisan::command('reports:live:clean {--limit=20 : Number of invalid live tag-date cache rows to print} {--json : Emit JSON instead of text}', function (LiveCleanupPreview $preview) {
    try {
        $payload = $preview->tagDateCachePreview(limit: (int) $this->option('limit'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:live:clean mode=read-only-preview total_rows=%d would_delete=%d retained_rows=%d generated_at=%s writes=0 cache_delete=skipped',
            $payload['total_rows'],
            $payload['would_delete'],
            $payload['retained_rows'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d pk=%d ctime=%s the_date=%s tagid=%s count_videos=%s',
                $index + 1,
                $row['pk'],
                $row['ctime'],
                $row['the_date'],
                $row['tagid'] ?? '-',
                $row['count_videos'] ?? '-',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:clean unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy live tag-date cache cleanup; does not delete cache rows');

Artisan::command('reports:live:static {--limit=20 : Number of static live targets to print} {--json : Emit JSON instead of text}', function (LiveStaticHtmlPreview $preview) {
    try {
        $payload = $preview->preview(limit: (int) $this->option('limit'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:live:static mode=read-only-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
            $payload['targets'],
            $payload['would_generate'],
            $payload['source_status'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s -> %s output=%s dynamic_rows=%d available=%s',
                $index + 1,
                $row['legacy_url'],
                $row['modern_url'],
                $row['output_path'],
                $row['dynamic_rows'],
                $row['dynamic_report_available'] ? 'yes' : 'no',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:live:static unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy static live HTML generation; does not write HTML files');

Artisan::command('reports:static:build {--limit=20 : Number of static group targets to print} {--json : Emit JSON instead of text}', function (StaticHtmlReportsPreview $preview) {
    try {
        $payload = $preview->preview(limit: (int) $this->option('limit'));

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:static:build mode=read-only-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
            $payload['targets'],
            $payload['would_generate'],
            $payload['source_status'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s -> %s output=%s type=%s dynamic_rows=%d cache_rows=%s available=%s',
                $index + 1,
                $row['legacy_url'],
                $row['modern_url'],
                $row['output_path'],
                $row['report_type'],
                $row['dynamic_rows'],
                $row['cache_rows'] !== null ? (string) $row['cache_rows'] : 'n/a',
                $row['dynamic_report_available'] ? 'yes' : 'no',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:static:build unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy group static HTML generation; does not write HTML files');

Artisan::command('reports:mayor:static {--city= : Optional mayor city key to preview} {--limit=20 : Number of mayor static targets to print} {--json : Emit JSON instead of text}', function (MayorStaticReportsPreview $preview) {
    try {
        $payload = $preview->preview(
            city: $this->option('city') ? (string) $this->option('city') : null,
            limit: (int) $this->option('limit'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:mayor:static mode=read-only-preview targets=%d would_generate=%d source_status="%s" generated_at=%s writes=0 static_write=skipped',
            $payload['targets'],
            $payload['would_generate'],
            $payload['source_status'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s / %s -> %s output=%s type=%s dynamic_rows=%d cache_rows=%d available=%s has_data=%s',
                $index + 1,
                $row['legacy_static_url'],
                $row['legacy_url'],
                $row['modern_url'],
                $row['output_path'],
                $row['report_type'],
                $row['dynamic_rows'],
                $row['cache_rows'],
                $row['dynamic_report_available'] ? 'yes' : 'no',
                $row['dynamic_report_has_data'] ? 'yes' : 'no',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:mayor:static unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy mayor static HTML generation; does not write HTML files');

Artisan::command('youtube:videos:duration {--videoId= : Optional queued video id to preview} {--batch-size=50 : Legacy batch size, capped at 50} {--loops=1 : Number of batches to preview} {--json : Emit JSON instead of text}', function (VideoDurationsPreview $preview) {
    try {
        $payload = $preview->preview(
            videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
            batchSize: (int) $this->option('batch-size'),
            loops: (int) $this->option('loops'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:videos:duration mode=read-only-preview queue_total=%d ready_queue_rows=%d selected_rows=%d completed_rows=%d reserved_rows=%d failed_or_missing_rows=%d unqueued_missing_videos=%s batch_size=%d loops=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped queue_update=skipped',
            $payload['queue_total'],
            $payload['ready_queue_rows'],
            $payload['selected_rows'],
            $payload['completed_rows'],
            $payload['reserved_rows'],
            $payload['failed_or_missing_rows'],
            $payload['unqueued_missing_videos'] !== null ? (string) $payload['unqueued_missing_videos'] : 'n/a',
            $payload['batch_size'],
            $payload['loops'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        if ($payload['would_reserve_until'] !== null) {
            $this->line('would_reserve_until='.$payload['would_reserve_until']);
        }

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d pk_video=%d video=%s u_id=%s published=%s reserve_until=%s title="%s"',
                $index + 1,
                $row['pk_video'],
                $row['video_id'],
                $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                $row['published_at'] ?? '-',
                $row['would_set_stime'],
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:videos:duration unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy video duration refresh queue; does not call YouTube or update duration rows');

Artisan::command('youtube:videos:stats {--videoId= : Optional video id to preview through the legacy single-video branch} {--today : Preview the legacy today/missing-viewCount branch from urt_video} {--batch-size=50 : Legacy batch size, capped at 50} {--loops=1 : Number of batches to preview, capped at the legacy loop count} {--json : Emit JSON instead of text}', function (VideoStatisticsPreview $preview) {
    $batchSize = max(1, min(50, (int) $this->option('batch-size')));
    $loops = max(1, min(31, (int) $this->option('loops')));
    $videoId = $this->option('videoId') ? (string) $this->option('videoId') : null;

    try {
        $payload = $preview->preview(
            videoId: $videoId,
            today: (bool) $this->option('today'),
            batchSize: $batchSize,
            loops: $loops,
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:videos:stats mode=read-only-preview source=%s schedule_total=%d due_schedule_rows=%d today_missing_rows=%d eligible_rows=%d selected_rows=%d first_batch_rows=%d batch_size=%d loops=%d would_call_api=%s generated_at=%s writes=0 api_call=skipped stats_update=skipped',
            $payload['source'],
            $payload['schedule_total'],
            $payload['due_schedule_rows'],
            $payload['today_missing_rows'],
            $payload['eligible_rows'],
            $payload['selected_rows'],
            $payload['first_batch_rows'],
            $payload['batch_size'],
            $payload['loops'],
            $payload['would_call_api'] ? 'yes' : 'no',
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s published=%s view=%s stime=%s would_set_stime=%s title="%s"',
                $index + 1,
                $row['video_id'],
                $row['published_at'] ?? '-',
                $row['current_view_count'] !== null ? number_format($row['current_view_count']) : 'n/a',
                $row['current_stime'] ?? '-',
                $row['would_set_stime'],
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:videos:stats unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy video statistics refresh queue; does not call YouTube or update video stats tables');

Artisan::command('reports:counts:build {--id= : Optional u_id to preview, matching legacy id=... behavior} {--limit=20 : Number of changed preview rows to print} {--json : Emit JSON instead of text}', function (ChannelCountsPreview $preview) {
    $uId = $this->option('id') !== null ? max(1, (int) $this->option('id')) : null;
    $limit = max(1, min(100, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(uId: $uId, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:counts:build mode=read-only-preview candidates=%d with_logs=%d missing_logs=%d would_update=%d unchanged=%d date=%s generated_at=%s writes=0',
            $payload['candidates'],
            $payload['with_logs'],
            $payload['missing_logs'],
            $payload['would_update'],
            $payload['unchanged'],
            $payload['date'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $computed = $row['computed'];
            $this->line(sprintf(
                '#%d u_id=%d view_week=%d sub_week=%d video_week=%d view_month=%d sub_month=%d video_month=%d',
                $index + 1,
                $row['u_id'],
                $computed['view_week'],
                $computed['sub_week'],
                $computed['video_week'],
                $computed['view_month'],
                $computed['sub_month'],
                $computed['video_month'],
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:counts:build unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy channel weekly/monthly count deltas; does not update urt_count');

Artisan::command('reports:keywords:build {--limit=20 : Number of preview keywords to print} {--recent-days=7 : Window for keyword_all preview, matching legacy weekly freshness} {--json : Emit JSON instead of text}', function (KeywordReportsPreview $preview) {
    $limit = max(1, min(100, (int) $this->option('limit')));
    $recentDays = max(1, min(30, (int) $this->option('recent-days')));

    try {
        $payload = $preview->preview(limit: $limit, recentDays: $recentDays);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:keywords:build mode=read-only-preview source_tags=%d eligible_keywords=%d recent_keywords=%d recent_since=%s generated_at=%s writes=0 external_fetch=skipped',
            $payload['source_tags'],
            $payload['eligible_keywords'],
            $payload['recent_keywords'],
            $payload['recent_since'],
            $payload['generated_at'],
        ));
        $this->line(sprintf(
            'excluded no_tag=%d single_char=%d numeric=%d short_ascii=%d targets=%s',
            $payload['excluded']['no_tag'],
            $payload['excluded']['single_char'],
            $payload['excluded']['numeric'],
            $payload['excluded']['short_ascii'],
            implode(',', $payload['filesystem_targets']),
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s weight=%s max_count=%d hours_count=%d recent=%s mtime=%s',
                $index + 1,
                $row['tag'],
                $row['legacy_weight'],
                $row['max_count'],
                $row['hours_count'],
                $row['included_in_keyword_all'] ? 'yes' : 'no',
                $row['mtime'],
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:keywords:build unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy keyword JSON generation from local tags; skips external fetch and file writes');

Artisan::command('reports:people:build {--group=政治人物 : tag_group group_name to preview} {--tagid=13 : Legacy tagid filter passed to tag_period.php} {--days=37 : Legacy period length passed to tag_period.php} {--limit=20 : Number of people tags to print} {--json : Emit JSON instead of text}', function (PeopleReportsPreview $preview) {
    $groupName = trim((string) $this->option('group')) ?: '政治人物';
    $tagId = max(1, (int) $this->option('tagid'));
    $days = max(1, min(365, (int) $this->option('days')));
    $limit = max(1, min(200, (int) $this->option('limit')));

    try {
        $payload = $preview->preview(groupName: $groupName, tagId: $tagId, days: $days, limit: $limit);

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'reports:people:build mode=read-only-preview group="%s" candidates=%d latest_time=%s tagid=%d days=%d generated_at=%s writes=0 cache_generation=skipped',
            $payload['group_name'],
            $payload['candidates'],
            $payload['latest_time'] ?? 'n/a',
            $payload['tagid'],
            $payload['days'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s latest_time=%s preview="%s"',
                $index + 1,
                $row['tag'],
                $row['latest_time'],
                $row['modern_api_preview'],
            ));
        }

        return 0;
} catch (QueryException $exception) {
    $this->error('reports:people:build unavailable: '.$exception->getMessage());

    return 1;
}
})->purpose('Read-only preview of legacy political-people tag period generation; does not call tag_period.php');

Artisan::command('reports:groups:build {--group= : Preview one tag_group group_name} {--hours=22 : Legacy tag.analysis.tw lookback parameter, shown only} {--limit=20 : Number of groups to print} {--json : Emit JSON instead of text}', function (GroupReportsPreview $preview) {
    try {
        $payload = $preview->preview(
            groupName: $this->option('group') ? (string) $this->option('group') : null,
            hours: (int) $this->option('hours'),
            limit: (int) $this->option('limit'),
        );

        if ($this->option('json')) {
            $this->line(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            return 0;
        }

        $this->line(sprintf(
            'reports:groups:build mode=read-only-preview groups=%d tag_rows=%d active_rows=%d deleted_rows=%d latest_time=%s hours=%d generated_at=%s writes=0 external_fetch=skipped',
            $payload['group_count'],
            $payload['tag_rows'],
            $payload['active_rows'],
            $payload['deleted_rows'],
            $payload['latest_time'] ?? '-',
            $payload['hours'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s active=%d deleted=%d total=%d latest_time=%s',
                $index + 1,
                $row['group_name'],
                $row['active_rows'],
                $row['deleted_rows'],
                $row['tag_rows'],
                $row['latest_time'] ?? '-',
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:groups:build unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy tag_group sync; does not call tag.analysis.tw or write tag_group');

Artisan::command('reports:schedule:build {--videoId= : Preview one scheduled video} {--hours=1 : Lookback window for recently refreshed schedule rows} {--limit=20 : Number of schedule rows to print} {--json : Emit JSON instead of text}', function (ScheduleReportsPreview $preview) {
    try {
        $payload = $preview->preview(
            videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
            hours: (int) $this->option('hours'),
            limit: (int) $this->option('limit'),
        );

        if ($this->option('json')) {
            $this->line(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

            return 0;
        }

        $this->line(sprintf(
            'reports:schedule:build mode=read-only-preview candidates=%d with_history=%d missing_history=%d would_update=%d window_start=%s generated_at=%s writes=0 schedule_update=skipped',
            $payload['candidates'],
            $payload['with_history'],
            $payload['missing_history'],
            $payload['would_update'],
            $payload['window_start'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d %s views_delta=%d views_per_hour=%.3f current_stime=%s estimated_stime=%s cap=%s',
                $index + 1,
                $row['video_id'],
                $row['view_delta'],
                $row['views_per_hour'],
                $row['current_stime'] ?? '-',
                $row['estimated_stime'],
                $row['cap'],
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('reports:schedule:build unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy schedule stime recalculation; does not update urt_video_schedule');

Artisan::command('ai:daily {--date= : Legacy date, defaults to yesterday in Asia/Taipei} {--condition= : Optional single legacy condition; default previews make_ai_day.sh conditions} {--type=oneday : Legacy urt_channel_ai data_type} {--limit=1000 : Max channel AI rows per condition} {--json : Emit JSON instead of text}', function (AiDailyPreview $preview) {
    try {
        $payload = $preview->preview(
            date: $this->option('date') ? (string) $this->option('date') : null,
            condition: $this->option('condition') ? (string) $this->option('condition') : null,
            dataType: (string) $this->option('type'),
            limit: (int) $this->option('limit'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $existingAiDateRows = collect($payload['condition_rows'])->sum('existing_ai_date_rows');

        $this->line(sprintf(
            'ai:daily mode=read-only-preview source=%s date=%s type=%s conditions=%d channel_refresh_attempts=%d channel_refresh_candidates=%d prompt_source_rows=%d prompt_media_rows=%d prompt_event_rows=%d prompt_video_refs=%d existing_ai_date_rows=%d would_call_ai_requests=%d would_insert_ai_date_rows=%d generated_at=%s writes=0 api_call=skipped ai_date_insert=skipped channel_ai_insert=skipped',
            $payload['source'],
            $payload['date'],
            $payload['data_type'],
            count($payload['conditions']),
            $payload['channel_ai_refresh']['would_attempt_channel_ai_refresh'],
            $payload['channel_ai_refresh']['would_insert_channel_ai_candidates'],
            $payload['total_prompt_source_rows'],
            $payload['total_prompt_media_rows'],
            $payload['total_prompt_event_rows'],
            $payload['total_prompt_video_refs'],
            $existingAiDateRows,
            $payload['would_call_ai_requests'],
            $payload['would_insert_ai_date_rows'],
            $payload['generated_at'],
        ));

        $this->line(sprintf(
            'channel_ai_refresh configured=%d existing_channels=%d existing_channel_ai_rows=%d min_videos=%d data_type=%s',
            $payload['channel_ai_refresh']['configured_channels'],
            $payload['channel_ai_refresh']['existing_channels'],
            $payload['channel_ai_refresh']['existing_channel_ai_rows'],
            $payload['channel_ai_refresh']['minimum_video_rows_per_channel'],
            $payload['channel_ai_refresh']['data_type'],
        ));

        foreach ($payload['condition_rows'] as $row) {
            $matchingChannels = $row['matching_channels'] === null ? 'all' : (string) $row['matching_channels'];
            $this->line(sprintf(
                '# condition=%s matching_channels=%s source_rows=%d media_rows=%d events=%d video_refs=%d existing_ai_date=%d bounds=%d-%d prompt_chars=%d',
                $row['condition'],
                $matchingChannels,
                $row['source_rows'],
                $row['media_rows'],
                $row['prompt_event_rows'],
                $row['prompt_video_refs'],
                $row['existing_ai_date_rows'],
                $row['prompt_bounds']['min'],
                $row['prompt_bounds']['max'],
                $row['prompt_chars'],
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('ai:daily unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy daily AI summary generation; does not call AI or insert urt_channel_ai/urt_ai_date rows');

Artisan::command('ai:hourly {--condition= : Optional legacy condition; omitted matches cron default} {--hour=1 : Legacy hours-back offset} {--period=1 : Legacy number of hourly buckets to include} {--limit=20 : Number of candidate videos to print} {--json : Emit JSON instead of text}', function (AiHourlyPreview $preview) {
    try {
        $payload = $preview->preview(
            condition: $this->option('condition') ? (string) $this->option('condition') : null,
            hour: (int) $this->option('hour'),
            period: (int) $this->option('period'),
            limit: (int) $this->option('limit'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $matchingChannels = $payload['matching_channels'] === null ? 'all' : (string) $payload['matching_channels'];

        $this->line(sprintf(
            'ai:hourly mode=read-only-preview source=%s condition=%s explicit_condition=%s matching_channels=%s video_rows=%d displayed_rows=%d hour=%d period=%d date_from=%s date_to=%s existing_ai_hour_rows=%d prompt_bounds=%d-%d prompt_chars=%d would_call_ai_requests=%d would_insert_ai_hour_rows=%d generated_at=%s writes=0 api_call=skipped ai_hour_insert=skipped',
            $payload['source'],
            $payload['condition_type'],
            $payload['explicit_condition'] ? 'yes' : 'no',
            $matchingChannels,
            $payload['video_rows'],
            $payload['displayed_rows'],
            $payload['hour'],
            $payload['period'],
            $payload['date_from'],
            $payload['date_to'],
            $payload['existing_ai_hour_rows'],
            $payload['prompt_bounds']['min'],
            $payload['prompt_bounds']['max'],
            $payload['prompt_chars'],
            $payload['would_call_ai_requests'],
            $payload['would_insert_ai_hour_rows'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d videoId=%s u_id=%s publishedAt=%s views=%s comments=%s title="%s"',
                $index + 1,
                $row['video_id'],
                $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                $row['published_at'] ?? '-',
                $row['view_count'] !== null ? number_format($row['view_count']) : 'n/a',
                $row['comment_count'] !== null ? number_format($row['comment_count']) : 'n/a',
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('ai:hourly unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy hourly AI summary generation; does not call AI or insert urt_ai_hour rows');

Artisan::command('youtube:comments:queue {--tagid= : Legacy AND tag filter} {--or= : Legacy OR tag filter} {--not= : Legacy NOT tag filter} {--hours=24 : Recent publishedAt window} {--min=500 : Minimum viewCount and commentCount threshold} {--limit=20 : Number of candidate rows to print} {--json : Emit JSON instead of text}', function (CommentQueuePreview $preview) {
    try {
        $payload = $preview->preview(
            tagid: $this->option('tagid') ? (string) $this->option('tagid') : null,
            or: $this->option('or') ? (string) $this->option('or') : null,
            not: $this->option('not') ? (string) $this->option('not') : null,
            min: (int) $this->option('min'),
            hours: (int) $this->option('hours'),
            limit: (int) $this->option('limit'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:comments:queue mode=read-only-preview matching_channels=%d recent_video_rows=%d comment_threshold_rows=%d already_queued_rows=%d already_done_rows=%d would_insert_queue_rows=%d hours=%d min=%d published_after=%s generated_at=%s writes=0 queue_insert=skipped',
            $payload['matching_channels'],
            $payload['recent_video_rows'],
            $payload['comment_threshold_rows'],
            $payload['already_queued_rows'],
            $payload['already_done_rows'],
            $payload['would_insert_queue_rows'],
            $payload['hours'],
            $payload['min'],
            $payload['published_after'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d videoId=%s u_id=%s publishedAt=%s views=%s comments=%s queued=%s done=%s title="%s"',
                $index + 1,
                $row['video_id'],
                $row['u_id'] !== null ? (string) $row['u_id'] : '-',
                $row['published_at'] ?? '-',
                $row['view_count'] !== null ? number_format($row['view_count']) : 'n/a',
                $row['comment_count'] !== null ? number_format($row['comment_count']) : 'n/a',
                $row['already_queued'] ? 'yes' : 'no',
                $row['already_done'] ? 'yes' : 'no',
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:comments:queue unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy comment queue generation; does not insert urt_comment_queue rows');

Artisan::command('youtube:comments:fetch {--videoId= : Optional queued video id to preview} {--limit=20 : Number of queued rows to print} {--json : Emit JSON instead of text}', function (CommentFetchPreview $preview) {
    try {
        $payload = $preview->preview(
            videoId: $this->option('videoId') ? (string) $this->option('videoId') : null,
            limit: (int) $this->option('limit'),
        );

        if ((bool) $this->option('json')) {
            $this->line(json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return 0;
        }

        $this->line(sprintf(
            'youtube:comments:fetch mode=read-only-preview queue_total=%d selected_rows=%d existing_comment_rows=%d recent_comment_cache_rows=%d would_insert_comment_rows=%d would_call_get_comment=%d would_call_comment_threads=%d would_move_to_done_rows=%d refresh_expire_time=%s generated_at=%s writes=0 api_call=skipped queue_move=skipped',
            $payload['queue_total'],
            $payload['selected_rows'],
            $payload['existing_comment_rows'],
            $payload['recent_comment_cache_rows'],
            $payload['would_insert_comment_rows'],
            $payload['would_call_get_comment'],
            $payload['would_call_comment_threads'],
            $payload['would_move_to_done_rows'],
            $payload['refresh_expire_time'],
            $payload['generated_at'],
        ));

        foreach ($payload['rows'] as $index => $row) {
            $this->line(sprintf(
                '#%d pk=%s videoId=%s queued_at=%s comment_mtime=%s would_call_api=%s done=%s title="%s"',
                $index + 1,
                $row['pk'] !== null ? (string) $row['pk'] : '-',
                $row['video_id'],
                $row['queue_ctime'] ?? '-',
                $row['comment_mtime'] ?? '-',
                $row['would_call_comment_threads'] ? 'yes' : 'no',
                $row['already_in_done'] ? 'yes' : 'no',
                mb_strimwidth($row['title'] ?? '', 0, 72, '...', 'UTF-8'),
            ));
        }

        return 0;
    } catch (QueryException $exception) {
        $this->error('youtube:comments:fetch unavailable: '.$exception->getMessage());

        return 1;
    }
})->purpose('Read-only preview of legacy comment queue drain; does not call YouTube, update comments, or move queue rows');

if (config('ingestion.scheduler_enabled', false)) {
    Schedule::command('ingestion:run --execute --record')
        ->everyMinute()
        ->withoutOverlapping(10);
}
