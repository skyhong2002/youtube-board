# Scheduler Activation Design

This document defines how legacy ingestion parity can move from manual local smokes to scheduled polling without weakening the current safety guardrails.

## Current State

- `INGESTION_SCHEDULER_ENABLED=false` by default.
- Laravel scheduler registration in `routes/console.php` runs `ingestion:run --execute --record` only when `INGESTION_SCHEDULER_ENABLED=true`.
- `IngestionSchedulerRunner` still applies the registry execution profile before calling any command.
- With only `INGESTION_SCHEDULER_ENABLED=true`, jobs still run their default dry-run/read-only command forms; command-level `--execute` is not passed automatically.
- Scheduled local polling requires all three gates: `INGESTION_SCHEDULER_ENABLED=true`, `INGESTION_LOCAL_POLLING_ENABLED=true`, and the job key in `INGESTION_SCHEDULED_WRITE_ALLOWLIST`.
- Allowlisted scheduled local polling uses each job's capped `scheduled_execute_command`, for example `youtube:channels:stats --execute --limit=1`.
- Manual pipeline smokes use the individual command-level `--execute` flags, not the scheduler runner.
- Manual execute commands must remain local-only, limited, idempotent, and explicit.

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
- AI generation remains dry-run by default; `ai:hourly --execute` is approved and implemented for OpenCode-compatible `urt_ai_hour` upsert.

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
- `playlistItems.list`: at most 1 channel and `maxResults=1` per scheduled run in the current capped scheduler command.
- `videos.list`: at most 1 video per scheduled run in the current capped scheduler command.
- `commentThreads.list`: at most 1 queued video and 1 page per scheduled run.
- AI hourly: capped scheduler command `ai:hourly --execute --limit=20` exists, but it only runs when the scheduler, local/production polling flag, and allowlist gates are all enabled. `OPENAI_ENDPOINT_STYLE=auto` follows the OpenCode Go endpoint table: MiniMax M2.5/M2.7 uses `/messages`, while Qwen, GLM, Kimi, MiMo, and DeepSeek models remain on `/chat/completions`.

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
- AI generation requires a command with explicit execute support; currently only `ai:hourly --execute` is implemented and verified.

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
| channel stats | implemented and smoked | allowlist-ready | Scheduler-enabled local polling smoke succeeded with `INGESTION_LOCAL_POLLING_ENABLED=true`, allowlist `youtube.channels.stats`, and capped `--execute --limit=1`; still off by default. |
| channel video discovery | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1 --max-results=1`; still off by default. |
| video stats | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1`; still off by default. |
| video duration | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1`; still off by default. |
| live polling | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1`; still off by default. |
| comment queue | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1`; no external API, but still writes queue rows and is off by default. |
| comment fetch | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1 --max-pages=1`; still needs queue failure policy before broader scheduling. |
| TVBS video discovery | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1 --max-results=1`; still off by default. |
| TVBS live polling | implemented and smoked | allowlist-ready | Capped scheduler command exists with `--execute --limit=1`; still off by default. |
| derived reports/cache builds | preview only | blocked | Write targets need per-command execute design. |
| hourly AI | implemented and smoked | allowlist-ready | `ai:hourly --execute --hour=3 --limit=5` called OpenCode-compatible chat completions and upserted `urt_ai_hour` for `2026-05-25 22:00:00` with sanitized usage; capped scheduler command is `ai:hourly --execute --limit=20`, still off unless allowlisted. Empty source windows return a sanitized skipped summary with exit code 0 so the daemon does not treat normal quiet hours as failures. |
| daily AI | dry-run prompt preview only | blocked | Daily/channel AI writeback still needs execute adapter and idempotent `urt_channel_ai` / `urt_ai_date` tests. |
