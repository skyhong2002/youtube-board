# Legacy Cron Inventory

Source: `/Users/sky/Documents/youtube-board-legacy/urtube/cron`

| Legacy job | Schedule | Modern owner |
| --- | --- | --- |
| `maint/get_statics.php` | Every 9 minutes | Channel statistics ingestion |
| `maint/get_live.php` | Every minute | Live stream polling |
| `maint/unlist_live.php` | Every 2 hours at minute 27 | Live stream cleanup |
| `maint/get_video.php live=2 force=3` | Twice hourly, hours 0-15 | Live-group video discovery |
| `maint/get_video.php live=1 force=3` | Daily during hours 2-16 | Live video refresh |
| `maint/get_video.php` | Every 5 minutes | General video discovery |
| `maint/get_video_count.php` | Every 7 minutes, hours 0-17 | Video view-count refresh |
| `maint/make_count.php` | Six times daily | Derived count reports |
| `maint/make_keyword.php` | Six times daily | Keyword reports |
| `maint/make_people.php` | Six times daily | People reports |
| `maint/get_group.php` | Six times daily | Group/tag aggregation |
| `maint/make_schedule.php` | Minutes 29 and 47 hourly | Schedule reports |
| `html/make_html.sh` | Daily 08:13 | Static HTML report generation |
| `mayor/make_mayor.sh` | Commented in legacy cron: every 5 hours at minute 13 | Mayor static HTML report generation |
| `html/make_live.sh` | Every 19 minutes | Static live HTML generation |
| `maint/get_duration.php` | Every 23 minutes | Video duration refresh |
| `maint/make_live.php` | Variable by hour | Live derived reports |
| `maint/show_live.php` | Every 7 minutes | Live display cache |
| `maint/clean_show_live.php` | 03:33, 13:33, 23:33 | Live display cache cleanup |
| `maint/make_ai_day.sh` | Daily 16:15 | Daily AI summaries |
| `prompt/ai_hour_prompt.php do=1` | Hourly, minute 10 | Hourly AI summaries |
| `maint/make_comments.php ...` | 04:23, 10:23, 16:23 | Comment queue generation |
| `maint/do_comments.php` | Hourly at minute 5 | Comment ingestion |

Modern jobs should be implemented as Laravel queued jobs and scheduled from `routes/console.php` or a dedicated scheduler provider.

## Modern Scheduler Registry

The new Laravel workspace now has a real-time YouTube ingestion registry and dashboard:

- Dashboard: `/ops/ingestion`
- Job detail: `/ops/ingestion/{jobKey}` with due/next-run preview and controlled execution guardrails
- Local one-shot runner: `POST /ops/ingestion/run`, exposed from the dashboard and recorded under Laravel local storage as `ingestion-runs/*.json`
- Registry: `config/ingestion.php`
- Console view: `php artisan ingestion:list`
- One-shot dry-run: `php artisan ingestion:run`
- Scheduled/local history: `php artisan ingestion:run --record` writes the same JSON record format shown at `/ops/ingestion/runs/{runId}`; the Laravel scheduler uses `ingestion:run --execute --record` only when `INGESTION_SCHEDULER_ENABLED=true`
- First ingestion-aware local commands: `php artisan youtube:channels:stats`, `php artisan youtube:channels:videos`, `php artisan youtube:tvbs:videos`, `php artisan youtube:live:poll`, `php artisan youtube:tvbs:live:poll`, `php artisan youtube:live:cleanup`, `php artisan youtube:videos:duration`, `php artisan youtube:videos:stats`, `php artisan youtube:comments:queue`, `php artisan youtube:comments:fetch`, `php artisan ai:daily`, `php artisan ai:hourly`, `php artisan reports:live:show`, `php artisan reports:live:build`, `php artisan reports:live:clean`, `php artisan reports:live:static`, `php artisan reports:static:build`, `php artisan reports:mayor:static`, `php artisan reports:counts:build`, `php artisan reports:groups:build`, `php artisan reports:keywords:build`, `php artisan reports:keywords:cache`, `php artisan reports:people:build`, `php artisan reports:schedule:build`
- Activation guardrails: see [scheduler-activation.md](scheduler-activation.md) for the env flags, rate limits, locks, retry policy, API quota handling, and local-vs-production separation required before any write-capable scheduled polling.

Current update: scheduled write/API execution uses capped `scheduled_execute_command` values by default. It is blocked only when scheduler/polling env gates are explicitly false, `INGESTION_SCHEDULED_WRITE_ALLOWLIST=off`, or a strict allowlist excludes the job; production additionally honors `INGESTION_PRODUCTION_POLLING_ENABLED=false` as a stop gate. `ai:hourly --execute` calls OpenCode-compatible chat completions and idempotently upserts `urt_ai_hour`; the preview/execute split stays explicit. `reports:keywords:cache --execute` is an explicit one-shot rebuild for the derived `urt_show_data.tags_all` cache used by `/keywords`; it uses local DB data and can be scheduled through the registry.

The registry documents legacy cron parity, Laravel command names, schedules, external dependencies, and write targets. Scheduled execution requires `--execute`, enabled scheduler config, an `active` registry status, an existing Laravel command, and a controlled execution profile. The dashboard one-shot form uses the same runner and temporarily enables execution only for that request; it writes a local JSON run record and never changes the global scheduler setting. Jobs that declare write targets or external API dependencies are routed through capped scheduled commands and env gates; an optional strict allowlist can narrow the default-on scope. YouTube, comment, derived-cache, and AI commands all keep preview plus execute paths: execute mode validates keys, applies caps, lists write targets, calls the relevant API or local builder, and updates local dashboard tables idempotently. Static HTML report jobs now map legacy shell targets to dynamic Laravel routes, while live discovery/polling and cache refresh are handled by the Laravel ingestion jobs.

## Migration Groups

| Modern group | Legacy jobs | Priority | Notes |
| --- | --- | --- | --- |
| `youtube:channels:stats` | `maint/get_statics.php` | 2 | Ingestion preview of due `urt_channel` statistics refresh rows, including the 23:00 null-stime sweep; scheduled writes use capped `youtube:channels:stats --execute --limit=25` when scheduled-write gates allow it. |
| `youtube:channels:videos` | `maint/get_video.php` | 2 | Dry-run preview of channel uploads discovery, including general `vtime`, `live=1`, `live=2`, single `id`, and `rescan` branches. Manual local-only `--execute` calls YouTube `playlistItems.list(part=snippet)` and idempotently writes `urt_channel.vtime`, `urt_video`, `urt_video_schedule`, and `urt_video_live`; the general scheduler job runs capped `--execute --limit=5 --max-results=3`, while live/live_group scheduler jobs run capped `--execute --limit=3 --max-results=5` when scheduled-write gates allow it. |
| `youtube:tvbs:videos` | `maint/get_video_tvbs.php` | 2 | Dry-run preview of the TVBS `[29]` channel loop plus manual local-only `--execute --id/--channel --limit --max-results`; execute checks `YOUTUBE_API_KEY`, calls YouTube `playlistItems.list(part=snippet)`, and idempotently writes local `urt_video`, `urt_video_schedule`, and `urt_video_live_tvbs`. The file is not in the current cron snapshot, so the registry schedule mirrors its internal 300-second sleep cadence; scheduler runs capped `--execute --limit=1 --max-results=1` when scheduled-write gates allow it. |
| `youtube:videos:stats` | `maint/get_video_count.php`, `maint/recount_video.php` | 2 | Ingestion preview of due `urt_video_schedule` statistics refresh rows, including `today` and single `videoId` branches, plus manual/scheduled `--execute` for `videos.list(statistics)` upserts into `urt_video_schedule`, `urt_video_log_history`, `urt_video_log`, and existing `urt_video`; scheduler runs capped `--execute --limit=25`. |
| `youtube:live:poll` | `maint/get_live.php` | 1 | Ingestion preview of due live rows, preserving the legacy interval filter, minimum batch threshold, and single `videoId` bypass. Manual local-only `--execute` calls YouTube `videos.list(part=liveStreamingDetails)` and idempotently writes `urt_video_live` plus `urt_video_live_log`; the scheduler runs capped `youtube:live:poll --execute --limit=50` when scheduled-write gates allow it. |
| `youtube:tvbs:live:poll` | `maint/get_live_tvbs.php` | 1 | Ingestion preview of TVBS due live rows from `urt_video_live_tvbs`, preserving the hard-coded 40-second freshness cutoff and TVBS log shape. Manual/scheduled `--execute` calls YouTube `videos.list(part=liveStreamingDetails)` and idempotently writes `urt_video_live_tvbs` plus `urt_video_live_log_tvbs`; scheduler runs capped `--execute --limit=20` when scheduled-write gates allow it. The file is not in the current cron snapshot, so the registry schedule mirrors the live poll cadence. |
| `youtube:live:cleanup` | `maint/unlist_live.php` | 1 | Dashboard preview by default; explicit/scheduled `--execute` marks selected stale `urt_video_live.del_flag=1` rows with no YouTube call. |
| `reports:live:clean` | `maint/clean_show_live.php` | 1 | Dashboard preview by default; explicit/scheduled `--execute` deletes selected invalid `urt_show_live_tag_date` cache rows. |
| `reports:live:show`, `reports:live:build`, `reports:live:static` | `maint/show_live.php`, `maint/make_live.php`, `html/make_live.sh` | 1 | `reports:live:show` emits a current local snapshot. `reports:live:build` previews display-cache inserts and upserts `urt_show_video_live` with explicit/scheduled `--execute`; `reports:live:static` maps `live_social.html` generation to the dynamic Laravel live dashboard. |
| `reports:static:build` | `html/make_html.sh` | 4 | Ingestion preview of group static HTML generation; maps active `group_chart.php` / `group_line.php` shell targets to clean dynamic routes. |
| `reports:mayor:static` | `mayor/make_mayor.sh` | 4 | Ingestion preview of mayor static HTML generation; maps legacy `mayor/html_*.html` outputs to `/mayor/cities/{city}` and supplements old five-city shell snapshots with the current 22 county/city targets. |
| `reports:counts:build` | `maint/make_count.php` | 3 | Dashboard preview by default; explicit/scheduled `--execute` updates selected `urt_count` weekly/monthly delta columns and `mtime` from `urt_log.thedata`. |
| `reports:keywords:build` | `maint/make_keyword.php` | 3 | Dashboard preview by default. Explicit/scheduled `--execute` calls 新文易數 `tag.analysis.tw/api/tag_json.php?hours=...` and upserts local `tags`; the Laravel dashboard uses database-backed keyword cache data instead of legacy filesystem JSON. |
| `reports:keywords:cache` | `api/tags_all.php force=1` | 3 | Dry-run by default; explicit `--execute` rebuilds derived `urt_show_data.tags_all` from local `urt_video`, `urt_count`, and `tags` for `/keywords` metric columns. No external fetch and no automatic scheduling. |
| `reports:people:build` | `maint/make_people.php` | 3 | Dashboard preview by default. Explicit/scheduled `--execute` builds selected political-people `urt_show_tag_date` cache rows from local DB through `TagDateCacheBuilder`. |
| `reports:groups:build` | `maint/get_group.php` | 3 | Dashboard preview by default. Explicit/scheduled `--execute` calls 新文易數 `tag.analysis.tw/api/group.php?hours=...` and upserts local `tag_group` rows when the incoming latest time is newer. |
| `reports:schedule:build` | `maint/make_schedule.php` | 3 | Dashboard preview by default; explicit/scheduled `--execute` updates selected `urt_video_schedule.stime/mtime` from recent schedule/log-history rows. |
| `youtube:videos:duration` | `maint/get_duration.php`, `api/api_duration.php` queue rows | 3 | Ingestion preview of queued duration refresh rows, plus manual/scheduled `--execute` for `videos.list(contentDetails)` updates to `urt_video_duration.mtime`, `stime`, `duration`, and `caption`; explicit/scheduled `--enqueue-missing` can create queue rows from existing local `urt_video`, and scheduler runs capped `--execute --limit=25 --enqueue-missing`. |
| `ai:daily` | `maint/make_ai_day.sh`, `maint/make_channel_ai.php`, `maint/get_ai_day.php` | 4 | Dashboard preview by default; explicit `--execute` refreshes `urt_channel_ai` from raw `urt_video` rows and upserts daily condition rows into `urt_ai_date`; scheduled execution uses `--channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120`, refreshing the full legacy configured-channel list in batches while bounding AI calls and per-channel prompt size. |
| `ai:hourly` | `prompt/ai_hour_prompt.php do=1` | 4 | Ingestion preview of the previous-hour video prompt and condition filter branches; no OpenAI/OpenCode call and no `urt_ai_hour` insert. Supports `--at` for reviewed backfills of a specific evaluation time. |
| `youtube:comments:queue` | `maint/make_comments.php` | 5 | Ingestion preview of comment queue candidates from `urt_count` and `urt_video`, plus manual local-only `--execute --limit` smoke for idempotent `urt_comment_queue` inserts; scheduler runs remain dry-run. |
| `youtube:comments:fetch` | `maint/do_comments.php`, `maint/get_comment.php` | 5 | Ingestion preview of queue drain and comment cache freshness, plus manual local-only `--execute --videoId/--limit --max-pages` smoke for `commentThreads.list` parsing, `urt_comment` / `urt_comment_author` / `urt_comment_rev` upserts, queue-done copy, and queue delete; scheduler runs remain dry-run. |

Priority `1` means it should be part of the live-stream vertical slice. Priorities after that are sequencing guidance, not a release promise.
