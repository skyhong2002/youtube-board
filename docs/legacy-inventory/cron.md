# Legacy Cron Inventory

Source: `/Users/skyhong/Documents/youtube-board-legacy/urtube/cron`

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
- Web one-shot runner: rate-limited `POST /ops/ingestion/run`; local/testing runs are recorded in MariaDB-backed `ingestion_runs` / `ingestion_run_jobs`, while Production previews are dry-run-only and non-persistent
- Registry: `config/ingestion.php`
- Console view: `php artisan ingestion:list`
- One-shot dry-run: `php artisan ingestion:run`
- Scheduled/local history: `php artisan ingestion:run --record` writes the same record shape shown at `/ops/ingestion/runs/{runId}` to MariaDB. Age cleanup runs at most hourly in 1,000-row batches until expired backlog is clear; the hard record cap is enforced after every successful write. Defaults are 14 days and 25,000 runs, and existing `ingestion-runs/*.json` records remain a read fallback. The Laravel scheduler uses `ingestion:run --execute --record` only when `INGESTION_SCHEDULER_ENABLED=true`.
- Authoritative command registry: `php artisan ingestion:list` reads all 41 current jobs from `config/ingestion.php` and reports command availability, status, schedules, dependencies, and write targets. The grouped command families and legacy ownership are summarized below; do not maintain a second partial inline command list.
- Activation guardrails: see [scheduler-activation.md](scheduler-activation.md) for the env flags, rate limits, locks, retry policy, API quota handling, and local-vs-production separation required before any write-capable scheduled polling.

Current update: scheduled write/API execution is fail-closed. Scheduler, local polling, Production polling, and the exact write allowlist must all be explicitly enabled before a capped `scheduled_execute_command` can run; missing gate values or the default `INGESTION_SCHEDULED_WRITE_ALLOWLIST=off` block writes. `ai:hourly --execute` calls OpenCode-compatible chat completions and idempotently upserts `urt_ai_hour`; the preview/execute split stays explicit. `reports:keywords:cache --execute` is an explicit one-shot rebuild for the derived `urt_show_data.tags_all` cache used by `/keywords`; it uses local DB data and can be scheduled through the registry only after explicit activation.

The registry documents legacy cron parity, Laravel command names, schedules, external dependencies, and write targets. Scheduled execution requires `--execute`, explicitly enabled scheduler/polling config, an `active` registry status, an existing Laravel command, and a controlled execution profile. The dashboard one-shot form uses the same runner, but only local/testing execute requests temporarily enable it and persist a MariaDB run record; Production accepts rate-limited, non-persistent dry-runs only and never changes the global scheduler setting. Jobs that declare write targets or external API dependencies are routed through capped scheduled commands and env gates; scheduled writes default off and require an exact reviewed allowlist. YouTube, comment, derived-cache, and AI commands all keep preview plus execute paths: execute mode validates keys, applies caps, lists write targets, calls the relevant API or local builder, and updates local dashboard tables idempotently. Static HTML report jobs now map legacy shell targets to dynamic Laravel routes, while live discovery/polling and cache refresh are handled by the Laravel ingestion jobs.

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
| `reports:mayor:static` | `mayor/make_mayor.sh` | 4 | Ingestion preview of mayor static HTML generation; maps legacy `mayor/html_*.html` outputs to `/mayor/cities/{city}` and supplements old five-city shell snapshots with the current 22 county/city targets. The legacy cron was commented, while modern capped `--execute --limit=5 --keyword-limit=5000` refreshes DB cache behind scheduler gates. |
| `reports:counts:build` | `maint/make_count.php` | 3 | Dashboard preview by default; explicit/scheduled `--execute` updates selected `urt_count` weekly/monthly delta columns and `mtime` from `urt_log.thedata`. |
| `reports:keywords:build` | `maint/make_keyword.php` | 3 | Dashboard preview by default. Explicit/scheduled `--execute` calls 新文易數 `tag.analysis.tw/api/tag_json.php?hours=...` and upserts local `tags`; the Laravel dashboard uses database-backed keyword cache data instead of legacy filesystem JSON. |
| `reports:keywords:cache` | `api/tags_all.php force=1` | 3 | Dry-run by default; explicit/scheduled `--execute --days=31 --recent-days=7 --keyword-limit=1000` rebuilds derived `urt_show_data.tags_all` from local `urt_video`, `urt_count`, and `tags` for `/keywords` metric columns. No external fetch; registry cadence is six times daily behind scheduler gates. |
| `reports:people:build` | `maint/make_people.php` | 3 | Dashboard preview by default. Explicit/scheduled `--execute` builds selected political-people `urt_show_tag_date` cache rows from local DB through `TagDateCacheBuilder`. |
| `reports:tag-cloud:build` | `maint/make_tag_cloud.php` | 3 | Preview by default; active scheduled/local execute rebuilds selected `urt_show_tag_cloud` tag/day combinations from local DB under caps. |
| `reports:channel-cloud:build` | `api/cloud.php uid=...` | 3 | Preview by default; active scheduled/local execute rebuilds selected/recent channel `urt_show_cloud` rows from local DB under caps. |
| `reports:tag-date:build` | `maint/make_tag_date.php` | 3 | Preview by default; active scheduled/local execute rebuilds capped `urt_show_tag_date` rows from local DB. |
| `reports:groups:build` | `maint/get_group.php` | 3 | Dashboard preview by default. Explicit/scheduled `--execute` calls 新文易數 `tag.analysis.tw/api/group.php?hours=...` and upserts local `tag_group` rows when the incoming latest time is newer. |
| `reports:schedule:build` | `maint/make_schedule.php` | 3 | Dashboard preview by default; explicit/scheduled `--execute` updates selected `urt_video_schedule.stime/mtime` from recent schedule/log-history rows. |
| `youtube:videos:duration` | `maint/get_duration.php`, `api/api_duration.php` queue rows | 3 | Ingestion preview of queued duration refresh rows, plus manual/scheduled `--execute` for `videos.list(contentDetails)` updates to `urt_video_duration.mtime`, `stime`, `duration`, and `caption`; explicit/scheduled `--enqueue-missing` can create queue rows from existing local `urt_video`, and scheduler runs capped `--execute --limit=25 --enqueue-missing`. |
| `ai:daily` | `maint/make_ai_day.sh`, `maint/make_channel_ai.php`, `maint/get_ai_day.php` | 4 | Dashboard preview by default; explicit `--execute` refreshes `urt_channel_ai` from raw `urt_video` rows and upserts daily condition rows into `urt_ai_date`; scheduled execution uses `--date=today --type=todate --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120`, so the public daily page can use current-day channel fallback as soon as channel rows arrive while the full configured-channel and condition batch continues. |
| `ai:mayor-person` | new Laravel mayor/person daily AI dashboard | 4 | Preview by default; active capped scheduler command calls the configured OpenAI-compatible provider and idempotently upserts `urt_mayor_person_ai` behind provider/runtime allowlist gates. |
| `ai:period`, `ai:event`, `ai:days:refresh` | legacy continuity/event prompts and operator refresh sequence | 4 | Implemented preview/explicit execute flows with provider call caps and idempotent AI cache writes; registry entries remain planned/manual with empty scheduled commands. |
| `ai:hourly` | `prompt/ai_hour_prompt.php do=1` | 4 | Preview makes no provider call or DB insert. Explicit/scheduled `--execute --limit=20` calls the configured OpenAI-compatible provider and idempotently upserts `urt_ai_hour`; `--at` supports reviewed backfills. Modern cadence is hourly all day, intentionally broader than legacy `10 0-15 * * *`. |
| `youtube:comments:queue` | `maint/make_comments.php` | 5 | Ingestion preview of comment queue candidates from `urt_count` and `urt_video`, plus capped manual/scheduled `--execute --limit` for idempotent `urt_comment_queue` inserts behind scheduler write gates. |
| `youtube:comments:fetch` | `maint/do_comments.php`, `maint/get_comment.php` | 5 | Ingestion preview of queue drain and comment cache freshness, plus capped manual/scheduled `--execute --videoId/--limit --max-pages --max-reply-pages` for `commentThreads.list` / `comments.list` parsing, `urt_comment` / `urt_comment_author` / `urt_comment_rev` upserts, queue-done copy, and queue delete. Scheduled execution remains behind scheduler/polling gates and the exact write allowlist. |

Priority `1` means it should be part of the live-stream vertical slice. Priorities after that are sequencing guidance, not a release promise.
