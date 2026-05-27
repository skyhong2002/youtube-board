# Scheduler Activation Design

This document defines how legacy ingestion parity can move from manual local smokes to scheduled polling without weakening the current safety guardrails.

## Current State

- `INGESTION_SCHEDULER_ENABLED=false` by default.
- Laravel scheduler registration in `routes/console.php` runs `ingestion:run --execute --record` only when `INGESTION_SCHEDULER_ENABLED=true`.
- `IngestionSchedulerRunner` still applies the registry execution profile before calling any command.
- With only `INGESTION_SCHEDULER_ENABLED=true`, jobs still run their default dry-run/read-only command forms; command-level `--execute` is not passed automatically.
- Scheduled local polling requires all three gates: `INGESTION_SCHEDULER_ENABLED=true`, `INGESTION_LOCAL_POLLING_ENABLED=true`, and the job key in `INGESTION_SCHEDULED_WRITE_ALLOWLIST`.
- Allowlisted scheduled local polling uses each job's capped `scheduled_execute_command`, for example `youtube:live:poll --execute --limit=50`.
- Manual pipeline smokes use the individual command-level `--execute` flags, not the scheduler runner.
- Manual execute commands must remain local-only, limited, idempotent, and explicit.
- `/ops/ingestion` now separates web request gates from external scheduler activity. The web request may correctly show `scheduler disabled` / `local polling disabled` because those env flags are not permanently enabled for normal HTTP traffic. A Dokploy scheduled task can still inject the scheduler/polling env flags only for its one-shot CLI process; the dashboard detects that separately from recent `ingestion:run --execute --record` JSON run files.
- External scheduler activity is considered active when the latest artisan execute run-history record is no more than three minutes old. If no recent external record exists, the dashboard reports `external scheduler not observed` and lists likely causes without reading secrets, calling Dokploy, or SSHing production.

## Activation Levels

| Level | Purpose | Enabled by | Allowed commands | Writes | External API calls |
| --- | --- | --- | --- | --- | --- |
| `0` | Default local/dev and production-safe preview | no flags | all preview commands and `/ops/ingestion` dry-runs | no DB writes except optional run-history JSON | none from preview commands |
| `1` | Manual local smoke | per-command `--execute` plus small `--limit` / `--id` / `--videoId` / `--channel` | commands with implemented local-only execute mode | local MariaDB only | only after sanitized key check |
| `2` | Scheduled read-only previews | `INGESTION_SCHEDULER_ENABLED=true` | read-only registry jobs whose execution profile has no blocks | local run-history JSON only | none |
| `3` | Scheduled local polling | `INGESTION_LOCAL_POLLING_ENABLED=true` plus `INGESTION_SCHEDULED_WRITE_ALLOWLIST` | only jobs with capped `scheduled_execute_command` | local MariaDB only | quota-limited |
| `4` | Production polling | explicit production approval, backups, deployment controls, and separate allowlist | allowlisted capped scheduler jobs | production DB only after approval | quota-limited and monitored |

Level `3` is implemented for local-only, allowlisted one-shot/scheduler execution, but it is off by default. Level `4` has user approval as of this goal continuation, but it still requires deployment credentials, backup/rollback evidence, and production env activation outside this local workspace.

## Required Env Flags

| Env | Default | Scope | Meaning |
| --- | --- | --- | --- |
| `INGESTION_SCHEDULER_ENABLED` | `false` | scheduler runner | Registers and allows `ingestion:run --execute --record`; does not bypass read-only guardrail. |
| `INGESTION_TIMEZONE` | `Asia/Taipei` | all scheduler previews | Cron evaluation timezone. |
| `YOUTUBE_API_KEY` | unset | manual execute commands | Required for YouTube `channels.list`, `playlistItems.list`, `videos.list`, and `commentThreads.list`; diagnostics must print only configured/missing state, never the key. |
| `OPENAI_API_KEY` / OpenCode-compatible key | unset | AI adapters | Required for explicit AI execute modes; diagnostics print only present/missing state and sanitized failures. |
| `OPENAI_TIMEOUT` | `180` | AI adapters | Chat completion timeout in seconds. |
| `OPENAI_MAX_TOKENS` | `1200` | AI adapters | Output cap for OpenCode-compatible chat completions. |
| `INGESTION_LOCAL_POLLING_ENABLED` | `false` | local scheduler writes | Required before any write-capable job can be scheduled locally. |
| `INGESTION_SCHEDULED_WRITE_ALLOWLIST` | empty | scheduler writes | Comma-separated registry job keys allowed to use capped `scheduled_execute_command`. |
| `INGESTION_PRODUCTION_POLLING_ENABLED` | `false` | production scheduler writes | Production gate; must require deployment approval and backup verification. |

Production polling remains blocked by default. In `APP_ENV=production`, `INGESTION_PRODUCTION_POLLING_ENABLED=true` is additionally required before scheduled write polling can run.

For the first production polling phase, enable only the live, stats, derived-report, and AI jobs that have already been backed up, smoke-tested, and approved:

```env
INGESTION_SCHEDULER_ENABLED=true
INGESTION_LOCAL_POLLING_ENABLED=true
INGESTION_PRODUCTION_POLLING_ENABLED=true
INGESTION_SCHEDULED_WRITE_ALLOWLIST=youtube.live.poll,youtube.tvbs.live.poll,youtube.channels.videos.live,youtube.channels.videos.live_group,youtube.tvbs.videos,youtube.channels.stats,youtube.videos.stats,reports.live.build,reports.live.clean,youtube.live.cleanup,reports.counts.build,reports.schedule.build,reports.keywords.build,reports.groups.build,reports.people.build,ai.hourly,ai.daily
YOUTUBE_API_KEY=<youtube-data-api-key>
```

Those jobs map to `urt_video_live` / `urt_video_live_log` polling, live/upcoming video discovery into `urt_video` / `urt_video_schedule` / `urt_video_live`, local display/cache maintenance in `urt_show_video_live` and `urt_show_live_tag_date`, derived count/schedule updates in `urt_count` and `urt_video_schedule`, hourly AI upserts into `urt_ai_hour`, and daily AI upserts into `urt_channel_ai` / `urt_ai_date`. Legacy mutating PHP routes remain disabled; Laravel artisan commands own these writes.

The next production polling phase still needs explicit approval before enabling these additional write-capable capped jobs in production:

```env
youtube.channels.videos.general,youtube.videos.duration,youtube.comments.queue,youtube.comments.fetch,reports.mayor.static
```

They cover regular upload discovery, duration queue draining, comment queue/fetch, and mayor/city tag-date cache refreshes.

## Command-Level Safety Rules

Every write-capable command must keep these properties before it can be considered for scheduled polling:

- Default invocation is dry-run and writes nothing.
- `--execute` is required for any DB write or external API call.
- `--dry-run` overrides `--execute`.
- Execute mode supports a narrow selector: `--limit`, `--id`, `--videoId`, `--channel`, or equivalent.
- Execute mode lists write targets in the summary output.
- Execute mode checks required API keys before any external call and prints sanitized diagnostics only.
- Writes are transactional or idempotent upserts.
- Re-running the same limited command must not duplicate dirty rows.
- AI generation remains dry-run by default; `ai:hourly --execute` is implemented for OpenCode-compatible `urt_ai_hour` upsert, and `ai:daily --execute` is implemented for legacy channel-first `urt_channel_ai` plus `urt_ai_date` upserts.

## Rate Limits

Manual local smoke defaults should stay below these caps:

| Pipeline | Current cap / selector | External call |
| --- | --- | --- |
| channel stats | `--limit` capped to 5 during execute | YouTube `channels.list(part=statistics)` |
| channel video discovery | `--limit` capped to 3 channels; `--max-results` capped to 50 | YouTube `playlistItems.list(part=snippet)` |
| video stats | `--limit` / batch capped to 50 | YouTube `videos.list(part=statistics)` |
| video duration | `--limit` / batch capped to 50 | YouTube `videos.list(part=contentDetails)` |
| live polling | `--limit` capped to 50; smoke should use `--videoId --limit=1` | YouTube `videos.list(part=liveStreamingDetails)` |
| comment queue | `--limit` capped to 20; no external call | none |
| comment fetch | `--limit` capped to 10; `--max-pages` capped to 3 | YouTube `commentThreads.list(part=id,replies,snippet)` |

Before scheduled local polling, add per-job quota budgets and daily counters. A safe first pass is:

- `channels.list`: at most 1 channel per scheduled run in the current capped scheduler command.
- `playlistItems.list`: live discovery uses at most 3 channels and `maxResults=5` per scheduled run in the current capped scheduler commands.
- `videos.list`: live polling uses at most 50 videos per scheduled run in the current capped scheduler command.
- `commentThreads.list`: at most 1 queued video and 1 page per scheduled run.
- AI hourly: capped scheduler command `ai:hourly --execute --limit=20` exists, but it only runs when the scheduler, local/production polling flag, and allowlist gates are all enabled. `OPENAI_ENDPOINT_STYLE=auto` follows the OpenCode Go endpoint table: MiniMax M2.5/M2.7 uses `/messages`, while Qwen, GLM, Kimi, MiMo, and DeepSeek models remain on `/chat/completions`.
- AI daily: capped scheduler command `ai:daily --execute --channel-limit=3 --limit=1000` intentionally starts below the legacy full 39-channel batch because the OpenCode-compatible endpoint can return long 524 timeouts. While capped, the limit is spent on legacy configured channels that meet the legacy minimum 10-video threshold, so the safe cap does not empty-run on early configured channels with too few videos. It can be raised after production run history shows stable completion times.

## Locks

Current locks:

- Laravel scheduler uses `withoutOverlapping(10)` around `ingestion:run --execute --record`.
- Legacy per-command locking behavior has only been preserved as selection semantics where implemented.
- Capped scheduled local polling is limited by allowlist and per-command row caps, but it does not yet have per-job distributed locks.

Required before scheduled write polling:

- Add command-level locks per job key, for example `ingestion:{jobKey}`.
- For per-row fetchers, also use row reservation columns already present in legacy schema where applicable (`stime`, `mtime`, `vtime`) before external calls.
- Locks must expire and produce a sanitized skipped summary, not crash the scheduler.

## Retries And Failure Recovery

Current behavior:

- Individual execute commands catch API/config/runtime errors and return non-zero sanitized output.
- Manual writes are transactional or idempotent, so re-running a failed smoke is the recovery path.
- `ingestion:run --record` writes local JSON history for scheduler and one-shot runs.
- `/ops/ingestion` uses the same JSON history to show external scheduler liveness. It only treats records with `request.source=artisan`, `request.mode=execute`, and `result.mode=execute` as external scheduler evidence, so web one-shot runs do not mask a paused Dokploy schedule.

## Dokploy Autodeploy Relay

The Dokploy deploy webhook URL is a tailnet-only address, so GitHub's hosted webhook delivery cannot reach it directly. The production app exposes `POST /ops/deploy/dokploy` as a narrow relay for GitHub push events:

- The route is inert unless both `DOKPLOY_DEPLOY_WEBHOOK_URL` and `DOKPLOY_DEPLOY_RELAY_SECRET` are configured in the runtime environment.
- The GitHub webhook must use the same relay secret; the route validates `X-Hub-Signature-256` with HMAC-SHA256 before doing anything.
- Only `X-GitHub-Event: push` and `ref=refs/heads/main` can trigger the internal Dokploy deploy webhook.
- The route forwards only a minimal `{ "ref": "refs/heads/main" }` payload and never logs or returns secrets.
- The Dokploy URL and relay secret must stay in deployment/GitHub configuration, not in code.

Required before scheduled write polling:

- Record per-job run summaries with selected rows, API calls, write targets, skipped rows, and sanitized failure reason.
- Distinguish quota/config failures from parse/schema failures.
- Retry only transient HTTP failures, with low retry count and backoff.
- Do not retry quota exhaustion in the same run.
- Keep partial row failures isolated so one bad API item does not poison the whole batch.
- Queue drain commands must leave rows in queue when the API/update transaction fails before `queue_done` copy.

## API Quota Handling

Execute commands must treat API quota as a first-class runtime constraint:

- Check key presence before any call.
- Do not print keys, request URLs containing keys, or raw response bodies that may contain sensitive request data.
- On quota or auth failures, return a sanitized non-zero summary.
- For scheduled polling, maintain a local quota budget per API method and stop before exceeding it.
- Prefer small batches and explicit selectors until local evidence proves the parse/upsert/report path.

Known API methods in scope:

- `channels.list(part=statistics)`
- `playlistItems.list(part=snippet)`
- `videos.list(part=statistics)`
- `videos.list(part=contentDetails)`
- `videos.list(part=liveStreamingDetails)`
- `commentThreads.list(part=id,replies,snippet)`

## Local Vs Production Separation

Local-only execute mode is allowed because it writes only the imported local MariaDB and is manually invoked. It is not a production activation mechanism.

Production polling requires all of the following before any enablement:

- Written approval for the exact job keys and schedules.
- Fresh production DB backup and rollback plan.
- Separate production env flags distinct from local smoke flags.
- Production write allowlist scoped to job keys.
- Confirmed `APP_ENV=production` behavior does not bypass dry-run defaults.
- API quota budget and alerting.
- Run-history retention and failure reporting.
- AI generation requires a command with explicit execute support; `ai:hourly --execute` and `ai:daily --execute` are implemented and verified with fake API tests.

## Promotion Checklist

To promote a pipeline from manual local smoke to scheduled local polling:

1. Legacy schedule, SQL selection, external calls, write targets, skip/retry behavior, and downstream dependencies are documented in `scheduler-parity.md`.
2. Dry-run command exists and tests prove it does not write DB or call external APIs.
3. Execute mode exists behind explicit `--execute`.
4. Execute mode has fake API tests for parse, upsert, and idempotency.
5. Real local smoke with `--limit=1` or exact id succeeds with sanitized summary.
6. Read-only page/report confirms the updated local rows.
7. The job has a quota cap, command lock, and failure recovery behavior.
8. The job is added to a local scheduled-write allowlist.

To promote a pipeline to production polling, repeat the checklist against production deployment controls and obtain explicit approval.

## Current Pipeline Status

| Pipeline | Manual local execute | Scheduled write polling | Notes |
| --- | --- | --- | --- |
| channel stats | implemented and smoked | production-enabled | Scheduler-enabled production polling smoke succeeded with capped `--execute --limit=1`; still gated by the production allowlist. |
| channel video discovery | implemented and smoked | partially production-enabled | Live/group live discovery is production-allowlisted; regular upload discovery has a capped scheduler command and still needs explicit production allowlist approval. |
| video stats | implemented and smoked | production-enabled | Capped scheduler command exists with `--execute --limit=1` and is production-allowlisted. |
| video duration | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1`; still needs explicit production allowlist approval. |
| live polling | implemented and smoked | production-enabled | Capped scheduler commands are production-allowlisted for normal and TVBS live polling. |
| comment queue | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=5`; no external API, but still writes queue rows and needs explicit production allowlist approval. |
| comment fetch | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=5 --max-pages=1`; still needs explicit production allowlist approval before broader scheduling. |
| TVBS video discovery | implemented and smoked | production-enabled | Capped scheduler command exists with `--execute --limit=1 --max-results=1` and is production-allowlisted. |
| TVBS live polling | implemented and smoked | production-enabled | Capped scheduler command exists with `--execute --limit=20` and is production-allowlisted. |
| live cleanup/cache clean | implemented and tested | production-enabled | `youtube:live:cleanup --execute --limit=100` marks stale live rows deleted; `reports:live:clean --execute --limit=500` deletes invalid live tag-date cache rows. Both are production-allowlisted. |
| derived count/schedule/keyword/group/people builds | implemented and tested | production-enabled | `reports:counts:build --execute --limit=500` updates count deltas from `urt_log`; `reports:schedule:build --execute --limit=100` updates `urt_video_schedule.stime/mtime`; `reports:keywords:build --execute --hours=2 --limit=100` syncs `tags` from `tag.analysis.tw`; `reports:groups:build --execute --hours=22 --limit=100` syncs `tag_group`; `reports:people:build --execute --limit=5 --days=37 --tagid=13 --keyword-limit=5000` refreshes selected `urt_show_tag_date` people cache rows. These are production-allowlisted. |
| remaining derived static report builds | preview only | intentionally replaced | Legacy filesystem HTML writes are not reproduced; dynamic Laravel routes serve the rebuilt public pages. Mayor/city cache refresh has a capped execute mode and still needs explicit production allowlist approval. |
| hourly AI | implemented and smoked | production-enabled but provider-dependent | `ai:hourly --execute --limit=20` is production-allowlisted. Empty source windows return a sanitized skipped summary with exit code 0 so the daemon does not treat normal quiet hours as failures. |
| daily AI | implemented and tested | production-enabled but provider-blocked | `ai:daily --execute` refreshes legacy configured channel summaries from raw `urt_video` rows, then upserts `urt_ai_date` condition rows; capped scheduler command is `ai:daily --execute --channel-limit=3 --limit=1000`, spending the cap on configured channels with at least 10 videos. Production smoke found OpenCode-compatible `status=524`, so AI_day freshness is currently blocked by the provider response, not the scheduler/write gate. |
