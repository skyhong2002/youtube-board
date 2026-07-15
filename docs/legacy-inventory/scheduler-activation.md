# Scheduler Activation Design

This document defines how legacy ingestion parity can move from manual local smokes to scheduled polling without weakening the current safety guardrails.

## Current State

- Scheduler, local polling, and Production polling default to `false` in code. Runtime env must explicitly enable each required gate.
- Laravel scheduler registration in `routes/console.php` runs `ingestion:run --execute --record` only when `INGESTION_SCHEDULER_ENABLED=true`.
- `IngestionSchedulerRunner` still applies the registry execution profile before calling any command.
- Scheduled writes default to `INGESTION_SCHEDULED_WRITE_ALLOWLIST=off`; an exact reviewed allowlist is required before capped execute commands can run.
- Scheduled local polling additionally requires `INGESTION_LOCAL_POLLING_ENABLED=true`; Production also requires `INGESTION_PRODUCTION_POLLING_ENABLED=true`.
- Scheduled polling uses each job's capped `scheduled_execute_command`, for example `youtube:live:poll --execute --limit=50`.
- Manual pipeline smokes use the individual command-level `--execute` flags, not the scheduler runner.
- Manual operator execute commands remain local-only, limited, idempotent, and explicit. Production execution is owned by reviewed scheduler/CLI paths; the web dashboard never executes writes in Production.
- `/ops/ingestion` separates web request gates from external scheduler activity and shows the effective explicit env state. External scheduler activity is detected separately from recent MariaDB-backed `ingestion:run --execute --record` records, with legacy JSON records retained as a read fallback.
- External scheduler activity is considered active when the latest artisan execute run-history record is no more than three minutes old. If no recent external record exists, the dashboard reports `external scheduler not observed` and lists likely causes without reading secrets, calling Dokploy, or SSHing production.

## Activation Levels

| Level | Purpose | Enabled by | Allowed commands | Writes | External API calls |
| --- | --- | --- | --- | --- | --- |
| `0` | Scheduler paused | `INGESTION_SCHEDULER_ENABLED=false` or paused Dokploy scheduler | all preview commands and `/ops/ingestion` dry-runs | no scheduler writes except optional bounded run history | none from preview commands |
| `1` | Manual local smoke | per-command `--execute` plus small `--limit` / `--id` / `--videoId` / `--channel` | commands with implemented local-only execute mode | local MariaDB only | only after sanitized key check |
| `2` | Scheduled ingestion previews | `INGESTION_SCHEDULER_ENABLED=true` | registry jobs whose execution profile has no blocks | bounded MariaDB run history only | none |
| `3` | Scheduled local polling | scheduler/local polling explicitly true plus an exact reviewed write allowlist | only allowlisted jobs with capped `scheduled_execute_command` | local MariaDB only | quota-limited |
| `4` | Production polling | Dokploy scheduler plus production polling gate and the current exact allowlist | only approved capped scheduler jobs | production DB | quota-limited and monitored |

Level `3` is implemented for local one-shot/scheduler execution but is fail-closed by default. Level `4` follows the same reviewed capped commands only when the current Dokploy gates and exact allowlist permit each job; changing those runtime values requires separate operator approval.

## Required Env Flags

| Env | Default | Scope | Meaning |
| --- | --- | --- | --- |
| `INGESTION_SCHEDULER_ENABLED` | `false` | scheduler runner | Must be explicitly true to register and allow `ingestion:run --execute --record`. |
| `INGESTION_TIMEZONE` | `Asia/Taipei` | all scheduler previews | Cron evaluation timezone. |
| `YOUTUBE_API_KEY` | unset | manual execute commands | Required for YouTube `channels.list`, `playlistItems.list`, `videos.list`, `commentThreads.list`, and `comments.list`; diagnostics must print only configured/missing state, never the key. |
| `OPENAI_API_KEY` / OpenAI-compatible key | unset | AI adapters | Required for explicit AI execute modes; diagnostics print only present/missing state and sanitized failures. |
| `OPENAI_TIMEOUT` | `180` | AI adapters | Chat completion timeout in seconds. |
| `OPENAI_MAX_TOKENS` | `4096` | AI adapters | Output cap for primary OpenAI-compatible completions; `gpt-5.4-mini` receives `max_completion_tokens`, while compatible fallback chat providers receive `max_tokens`. |
| `OPENAI_FALLBACK_BASE_URL` / `OPENAI_FALLBACK_MODEL` / `OPENAI_FALLBACK_API_KEY` | unset | AI adapters | Optional secondary provider. Used only after the primary `OPENAI_*` provider fails; keys must stay in Dokploy secrets/env. |
| `INGESTION_LOCAL_POLLING_ENABLED` | `false` | local scheduler writes | Must be explicitly true before local scheduled writes are eligible. |
| `INGESTION_SCHEDULED_WRITE_ALLOWLIST` | `off` | scheduler writes | An exact comma-separated job list is required. `off`/`false`/`none`, empty, and missing values block all scheduled writes; `*` is supported only as an explicit broad operator choice. |
| `INGESTION_PRODUCTION_POLLING_ENABLED` | `false` | production scheduler writes | Must be explicitly true in Dokploy before Production scheduled writes are eligible. |
| `INGESTION_JOB_LOCK_SECONDS` | `14400` | runner execute jobs | Expiring per-job cache lock TTL. A PCNTL wall-clock deadline hard-exits the worker before lease expiry, so broad per-item exception handlers cannot let retries continue after another runner could acquire the job. |
| `INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET` | `9000` | scheduled and direct YouTube API jobs | Maximum projected YouTube units per Pacific Time quota day. A missing, invalid, or non-positive value fails closed for YouTube API jobs. |
| `INGESTION_COMMENT_CLAIM_MINUTES` | `30` | comment queue drain | Active `urt_comment_queue.stime` claim lease. Expired claims are eligible for recovery; active claims are excluded. |

The code defaults are fail-closed. Production behavior is determined by Dokploy runtime gates and the exact allowlist. In `APP_ENV=production`, scheduled writes are blocked unless `INGESTION_PRODUCTION_POLLING_ENABLED=true`, and web execute requests return 403 regardless of that scheduler gate.

The committed local Compose environment overrides only `INGESTION_SCHEDULER_ENABLED` to `true`, so a fresh checkout registers and exercises the real minute schedule. It keeps `INGESTION_LOCAL_POLLING_ENABLED=false`, `INGESTION_PRODUCTION_POLLING_ENABLED=false`, and `INGESTION_SCHEDULED_WRITE_ALLOWLIST=off`. Each default local minute invokes `ingestion:run --execute --record` and records bounded, sanitized diagnostic run history, while every ingestion job resolves to a preview. It makes no external API calls or ingestion/API target writes; those writes still require explicit opt-in values.

Production must use an exact reviewed allowlist rather than the code default `off`. Any change requires the approved keys, dry-run evidence, risk/rollback plan, and operator approval:

```env
INGESTION_SCHEDULER_ENABLED=true
INGESTION_LOCAL_POLLING_ENABLED=true
INGESTION_PRODUCTION_POLLING_ENABLED=true
INGESTION_SCHEDULED_WRITE_ALLOWLIST=<exact-reviewed-comma-separated-job-keys>
INGESTION_JOB_LOCK_SECONDS=14400
INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET=9000
INGESTION_COMMENT_CLAIM_MINUTES=30
YOUTUBE_API_KEY=<youtube-data-api-key>
```

Approved jobs map to their documented Laravel-owned tables. Legacy mutating PHP routes are routed to Laravel guard pages; reviewed Artisan commands own writes. Manual-only builders with an empty `scheduled_execute_command` remain outside scheduler execution even if their registry key is accidentally listed.

When using a strict allowlist, include these additional write-capable capped jobs only after explicit approval:

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
- Imported legacy tables may be MyISAM. Commands use idempotent writes plus explicit ordering: validate first, write history/derived rows next, and write the source freshness or public publication marker last. They do not claim rollback protection that the storage engine cannot provide.
- Re-running the same limited command must not duplicate dirty rows.
- Explicit dates, AI conditions/types, prompt types, and similar operator selectors fail closed before external calls or DB writes instead of silently falling back to defaults.
- AI generation has both prompt preview and explicit execute paths. Manual `ai:hourly --execute` and `ai:daily --execute` remain available; scheduled `ai:hourly:pipeline` and `ai:daily:pipeline` add a required YouTube source-refresh stage before the same idempotent AI writes. Provider/model is result metadata, not logical identity; switching providers updates the latest active logical row and its `ai_type`.

## Rate Limits

Manual local smoke defaults should stay below these caps:

| Pipeline | Current cap / selector | External call |
| --- | --- | --- |
| channel stats | direct `--limit` capped to 50; scheduled command selects at most 25 channels in one batched request | YouTube `channels.list(part=statistics)` |
| channel video discovery | direct `--limit` capped to 10 channels; scheduled commands select 3-5 channels; `--max-results` capped to 50 | YouTube `playlistItems.list(part=snippet)` |
| video stats | `--limit` / batch capped to 50 | YouTube `videos.list(part=statistics)` |
| video duration | `--limit` / batch capped to 50 | YouTube `videos.list(part=contentDetails)` |
| live polling | `--limit` capped to 50; smoke should use `--videoId --limit=1` | YouTube `videos.list(part=liveStreamingDetails)` |
| comment queue | `--limit` capped to 20; no external call | none |
| comment fetch | `--limit` capped to 10; `--max-pages` capped to 3; shared `--max-reply-pages` capped to 100 | YouTube `commentThreads.list(part=id,replies,snippet)` plus `comments.list(parentId)` when embedded replies are incomplete |

The scheduler now enforces a Pacific Time daily quota budget before starting YouTube API jobs. Current command-level upper bounds are:

- `channels.list`: at most 25 channels in one batched API request per scheduled run.
- `playlistItems.list`: live discovery uses at most 3 channels and `maxResults=5`; general discovery uses at most 5 channels and `maxResults=3` per scheduled run.
- `videos.list`: live polling uses at most 50 videos per scheduled run in the current capped scheduler command.
- comment ingestion: at most 5 queued videos, 1 thread page and 20 shared full-reply pages per video in the reviewed scheduled command; the quota preflight includes both page caps.
- AI hourly: capped scheduler command `ai:hourly:pipeline --execute --limit=20 --source-max-results=50` runs at minute 10 each hour. It refreshes all 39 AI channels first and requires the returned uploads window to reach the previous complete hour. Any failed refresh or 50-item page cap that does not cover the window returns nonzero without an AI call. Command-level `--at` supports reviewed backfills of a specific evaluation time.
- AI daily: at 00:00 the scheduler runs `ai:daily:pipeline --execute --date=yesterday --channel-limit=39 --channel-batch-size=12 --ai-call-limit=45 --channel-video-limit=120 --limit=1000`. It first performs the paginated tag 102 uploads crawl for the closed day, requires `crawl_complete=true`, and proves that every configured daily-AI channel ID is in the successful crawl set. Only then does it attempt configured channel summaries and six daily condition summaries; a channel with fewer than 10 videos is a valid skip, so 39 channel rows are not guaranteed. An eligible channel failure blocks all six daily writes. If eligible channel sources exist but `all` has no mergeable prompt events, the pipeline returns nonzero rather than reporting an empty success; a genuinely low-volume day where every channel is below the ten-video threshold remains a valid skip. Daily results must contain 15-20 topics for `all` or 8-12 for another condition, with at least two media sources per topic; undersized, oversized, single-media, or truncated responses fail without replacing the prior cache. The daily index can render up to 20 request-time channel fallback topics while the AI stage continues. The standalone tag 102 backfill no longer runs again at 00:17; its remaining cadence starts at 03:17.
- AI provider fallback: legacy `make_channel_ai.php`, `get_ai_day.php`, and `ai_hour_prompt.php` call OpenAI `chat/completions` with `gpt-4o-mini`. Current Production tries OpenAI `gpt-5.4-mini` first, using `max_completion_tokens`, then the configured OpenCode Go `qwen3.6-plus` fallback with `max_tokens`. Each provider has bounded HTTP 429/5xx retries controlled by `OPENAI_TRANSIENT_RETRIES`; a provider failure, truncated completion, or invalid payload advances to fallback without publishing the incomplete output. `--ai-call-limit` is a logical-chain cap, while execute output separately reports the provider-attempt cap, whole-run HTTP request limit, and actual provider requests. Both keys stay in Dokploy secrets/env. The fallback was configured but externally quota-limited with HTTP 429 on 2026-07-15.

## Locks

Current locks:

- Laravel scheduler uses `withoutOverlapping(10)` around `ingestion:run --execute --record`.
- `IngestionSchedulerRunner` also acquires an expiring cache lock per job key before every execute-mode command. A competing runner returns `skip:job-locked` with a sanitized summary and does not call the command.
- `INGESTION_JOB_LOCK_SECONDS` defaults to four hours. The command wrapper terminates the PHP worker with exit code 124 five minutes before that lease expires, leaves the lock until TTL recovery, and therefore prevents a worst-case AI/provider retry chain from overlapping a later runner even when callback code catches `Throwable`. This hard exit can leave the active `ingestion:run --record` without a terminal history row; use the Docker stderr deadline message and retained lock as the immediate evidence. The scheduler shell remains alive and evaluates due work again on the next minute.
- Row reservation columns (`stime`, `mtime`, `vtime`) remain the next layer for per-row fetchers and must be claimed atomically where concurrent row processing is possible.

## Retries And Failure Recovery

Current behavior:

- Individual execute commands catch API/config/runtime errors and return non-zero sanitized output.
- `youtube:comments:fetch` atomically claims each eligible queue row through `stime`. Active claims are excluded, claims older than `INGESTION_COMMENT_CLAIM_MINUTES` recover automatically, and an item failure releases its claim while leaving the queue row available for retry. Later rows continue processing; the completed batch summary is emitted before a non-zero partial-failure exit.
- A complete comment crawl prevalidates revision JSON, writes author/revision rows first, and publishes `urt_comment` last. New Laravel rows use `stime == mtime` as a durable publication marker; imported legacy rows may instead use their compatible queue-done marker. A failed crawl stays queued and unpublished.
- Manual writes use idempotent keys and MyISAM-safe ordering, so re-running a failed smoke completes or refreshes the same logical target. Time-series polling intentionally retains a later real API observation under its new observation timestamp.
- `ingestion:run --record` writes new scheduler and one-shot history to MariaDB-backed `ingestion_runs` / `ingestion_run_jobs`. Retention defaults to 14 days and 25,000 runs, pruning expired rows before the oldest excess rows; legacy `ingestion-runs/*.json` files remain readable as a compatibility fallback.
- `/ops/ingestion` uses the same combined history to show external scheduler liveness. It only treats records with `request.source=artisan`, `request.mode=execute`, and `result.mode=execute` as external scheduler evidence, so web one-shot runs do not mask a paused Dokploy schedule.
- Execute-mode run records include per-job `started_at`, `finished_at`, `runtime_ms`, and sanitized telemetry summaries. YouTube Data API telemetry records method, resource count, status, quota/rate-limit retry flag, and latency without printing API keys or resource ids. AI telemetry records each OpenAI-compatible provider attempt, model, endpoint style, prompt/completion size, token usage, status, and latency without printing secrets.
- `php artisan ingestion:health --date=YYYY-MM-DD` health-checks scheduler liveness, per-job runtimes, YouTube API latency, AI provider latency, daily quota estimate, `urt_ai_date`/`urt_channel_ai` completeness, and the scheduled `ai:mayor-person` city/person cache completeness. `/ops/ingestion` shows the same summary; `--json` returns the full payload for monitoring.

## Dokploy Autodeploy Relay

The Dokploy deploy webhook URL is a tailnet-only address, so GitHub's hosted webhook delivery cannot reach it directly. The production app exposes `POST /ops/deploy/dokploy` as a narrow relay for GitHub push events:

- The route is inert unless both `DOKPLOY_DEPLOY_WEBHOOK_URL` and `DOKPLOY_DEPLOY_RELAY_SECRET` are configured in the runtime environment.
- The GitHub webhook must use the same relay secret; the route validates `X-Hub-Signature-256` with HMAC-SHA256 before doing anything.
- Only `X-GitHub-Event: push` and `ref=refs/heads/main` can trigger the internal Dokploy deploy webhook.
- The route forwards only a minimal `{ "ref": "refs/heads/main" }` payload and never logs or returns secrets.
- The Dokploy URL and relay secret must stay in deployment/GitHub configuration, not in code.

Required before scheduled write polling:

- Record per-job run summaries with selected rows, API calls, write targets, skipped rows, and sanitized failure reason.
- Keep per-job runtime and external-call latency telemetry in run history so slow YouTube/API/AI bottlenecks can be separated from local DB/cache processing time.
- Distinguish quota/config failures from parse/schema failures.
- Retry only transient HTTP failures, with low retry count and backoff.
- Do not retry YouTube quota exhaustion with the same key in the same run; AI HTTP 429 responses follow the bounded `OPENAI_TRANSIENT_RETRIES` policy before provider fallback.
- Keep partial row failures isolated so one bad API item does not poison the whole batch.
- Queue drain commands must leave rows in queue when API, validation, author/revision, publication, or queue-done work fails before the final queue delete.

## API Quota Handling

Execute commands must treat API quota as a first-class runtime constraint:

- Check key presence before any call.
- Do not print keys, request URLs containing keys, or raw response bodies that may contain sensitive request data.
- On quota or auth failures, return a sanitized non-zero summary.
- YouTube 5xx and connection failures use the configured bounded transient retry (`YOUTUBE_API_TRANSIENT_RETRIES`, default 1); quota/auth failures are never retried with the same key. A configured fallback key may be tried after quota exhaustion or a key-specific authentication failure, including invalid, expired, not-found, and explicit revoked-key responses. Canonical reason codes are normalized before classification, and exhausting every configured key fails closed.
- For scheduled polling, maintain a local quota budget per API method and stop before exceeding it.
- Prefer small batches and explicit selectors until local evidence proves the parse/upsert/report path.
- Before a scheduled YouTube command starts, the runner atomically reserves the command's capped worst-case request estimate in the Laravel-owned `ingestion_youtube_quota_daily` row for the current Pacific Time day. It returns `skip:youtube-quota-budget` without calling Artisan when the conditional reservation would exceed `INGESTION_YOUTUBE_DAILY_QUOTA_BUDGET`; a missing/unavailable ledger fails closed.
- The top-level `ingestion:run --execute` process returns nonzero whenever any evaluated child job is marked failed, after optional sanitized run-history recording. Normal not-due, controlled, lock-contention, and quota-budget skips remain non-failures. This lets the dedicated scheduler container and external monitoring distinguish a completed evaluation from a failed ingestion batch.
- Every direct YouTube `--execute` command uses the same atomic ledger, shared credential check, and expiring per-job direct-command lock, and requires a positive configured budget. It reserves from the real current Pacific Time day, not the requested report date, and settles handled success/partial-failure paths to sanitized `IngestionTelemetry` request attempts. The guard writes fixed blocked/completed/exception audit events containing only job key, status/reason code, quota counters, runtime, exit code, and exception class; effective command options, payload/output, resource ids, exception text, and credentials are excluded. A settlement accounting failure returns nonzero and leaves the reservation fail-safe. When invoked by `IngestionSchedulerRunner`, an explicit process-scoped, job-key-matched reservation context transfers accounting and locking ownership to the scheduler and prevents a second reservation or lock.
- The three active jobs sharing `youtube:channels:videos` declare an explicit `--live` lock discriminator: no value selects `youtube.channels.videos.general`, `1` selects `.live`, and `2` selects `.live_group`. Scheduled execution instead trusts the runner's already-owned matching job context, so each variant keeps a distinct per-job lock without attempting to acquire that lock twice.
- Before each reserved HTTP attempt, the client verifies that the request timeout cannot cross the Pacific Time quota reset. Near or after reset it stops before sending HTTP and surfaces a sanitized nonzero result; batch polling includes the fixed `quota_window_reset` reason and performs no API-result row writes. Duration rows explicitly enqueued before the guard remain incomplete and retryable. Channel discovery stops before later API attempts while keeping prior per-channel commits and leaving remaining crawl rows due for an idempotent retry. Tag-video backfill validates explicit calendar dates before quota reservation, discards an incomplete current-channel page set, preserves prior committed channels, and remains idempotent on rerun. Comment fetching releases its active claim and preserves the queue row. Settlement releases only the original quota-day reservation without charging an unreserved next-day request.
- Scheduled upper bounds include configured fallback-key and transient attempts. Completed jobs settle reservations to sanitized request telemetry, so retries count as separate request attempts. A crash leaves the conservative reservation in place until the quota day changes. Bounded run history remains diagnostic telemetry and is not the enforcement source.

Known API methods in scope:

- `channels.list(part=statistics)`
- `playlistItems.list(part=snippet)`
- `videos.list(part=statistics)`
- `videos.list(part=contentDetails)`
- `videos.list(part=liveStreamingDetails)`
- `commentThreads.list(part=id,replies,snippet)` and capped `comments.list(part=id,snippet,parentId)`

## Local Vs Production Separation

Local-only execute mode is allowed because it writes only the imported local MariaDB and is manually invoked. It is not a production activation mechanism.

Production polling changes require all of the following before expanding or narrowing write-capable jobs:

- Written approval for the exact job keys and schedules being changed.
- Fresh production DB backup and rollback plan.
- Dokploy production env gates reviewed before deploy/reload.
- Strict production write allowlist scoped to job keys when using a narrowed scope instead of `*`.
- Confirmed `APP_ENV=production` behavior does not bypass dry-run defaults.
- API quota budget and alerting.
- Run-history retention and failure reporting.
- AI generation requires a command with explicit execute support; the manual AI commands and source-first `ai:hourly:pipeline` / `ai:daily:pipeline` scheduled commands are implemented and verified with fake API tests, including fail-closed source failures.

## Promotion Checklist

To promote a pipeline from manual local smoke to scheduled local polling:

1. Legacy schedule, SQL selection, external calls, write targets, skip/retry behavior, and downstream dependencies are documented in `scheduler-parity.md`.
2. Preview command exists and tests prove preview mode stays diagnostic while execute tests cover DB/API behavior.
3. Execute mode exists behind explicit `--execute`.
4. Execute mode has fake API tests for parse, upsert, and idempotency.
5. Real local smoke with `--limit=1` or exact id succeeds with sanitized summary.
6. Real-time dashboard page/report confirms the updated local rows.
7. The job has a quota cap, command lock, and failure recovery behavior.
8. The job has a capped `scheduled_execute_command`; if using a strict allowlist, the job key is included.

To promote a pipeline to production polling, repeat the checklist against production deployment controls and obtain explicit approval.

## Current Pipeline Status

| Pipeline | Manual local execute | Scheduled write polling | Notes |
| --- | --- | --- | --- |
| channel stats | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Capped command is `youtube:channels:stats --execute --limit=25`. |
| channel video discovery | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Live/group/general discovery each have capped scheduler commands. |
| video stats | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Capped command uses `--execute --limit=25`. |
| video duration | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Capped command uses `--execute --limit=25 --enqueue-missing`. |
| live polling | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Normal and TVBS polling both have capped scheduler commands. |
| comment queue | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Capped command uses `--execute --limit=5`; no external API. |
| comment fetch | implemented and tested | scheduler-capable; runtime allowlist-dependent | Capped command uses `--execute --limit=5 --max-pages=1 --max-reply-pages=20`; a command lock, atomic expiring claims, full-reply continuation, cap-incomplete refusal, and MyISAM-safe done-before-delete ordering protect the queue. |
| TVBS video discovery | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Capped command uses `--execute --limit=1 --max-results=1`. |
| TVBS live polling | implemented and smoked | scheduler-capable; runtime allowlist-dependent | Capped command uses `--execute --limit=20`. |
| live cleanup/cache clean | implemented and tested | scheduler-capable; runtime allowlist-dependent | `youtube:live:cleanup` marks stale live rows deleted; `reports:live:clean` deletes invalid cache rows under caps. |
| derived count/schedule/keyword/group/people/tag-cloud/channel-cloud/tag-date builds | implemented and tested | scheduler-capable; runtime allowlist-dependent | Each command has a capped execute profile; external keyword/group sync remains credential/network dependent, while cloud/date cache builders use local DB only. |
| remaining derived static report builds | dynamic routes | intentionally replaced | Dynamic Laravel routes serve the rebuilt public pages instead of legacy filesystem HTML outputs. Mayor/city cache refresh has a capped execute mode and is scheduler-capable only when included in the exact reviewed allowlist. |
| manual keyword-relation/keyword-cloud/live-tag-date/tag-month/photo cache and prediction builders | implemented and tested | intentionally unscheduled | Manual-only registry entries have empty scheduled commands, explicit execute, caps, locks, idempotency, and focused read-path tests; photo execution additionally depends on the public zh.wikipedia.org pageimages API. Production allowlists are unchanged. |
| hourly AI | implemented and tested | scheduler-capable; provider and runtime allowlist-dependent | `ai:hourly:pipeline --execute --limit=20 --source-max-results=50` refreshes all 39 source channels, proves coverage of the previous complete hour, and only then runs hourly AI. |
| daily AI | implemented and tested | scheduler-capable; provider and runtime allowlist-dependent | `ai:daily:pipeline --execute --date=yesterday` requires a complete tag 102 paginated crawl plus successful crawl coverage of every configured daily-AI channel before channel and daily AI. Low-volume channels remain valid skips. Provider fallback configuration remains in runtime secrets, not git. |
| mayor person AI | implemented and tested | scheduler-capable; provider and runtime allowlist-dependent | Capped command is `ai:mayor-person --execute --city=taipei --limit=10 --ai-call-limit=10`; page requests only read the generated cache. |
