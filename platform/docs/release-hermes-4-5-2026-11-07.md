# Release 19f48811 + 7c1dc057 — scheduler readiness (#4), days-refresh failure lineage (#5) (2026-11-07)

scheduler and worker-ai-daily only, on sky-server. No grant, schedule, env or other service change (asserted by
`/home/sky/yt-release-hermes-4-5/release-hermes-4-5.py`, SHA256 `f7a9c245…`).

## Why

- #4: retained failed slots no longer failed scheduler readiness (b538a30/1e740c6), but submission uncertainty
  (`SUBMISSION_UNOBSERVED`, `SUBMISSION_IN_PROGRESS`, `RUN_ID_CONFLICT`), `ENQUEUE_ERROR` and an unreachable Redis still did.
  Every tick in the two-minute lookback re-plans the same run ID, so three probes failed and a working scheduler was replaced;
  the replacement plans the same IDs.
- #5: `ai:days-refresh` reported almost every failure as `source_generation_or_projection_failed` without a run ID, so the
  durable `partial_failure` results of the ai-events backfill could not be traced.

## Changes

- PR #16 (`19f48811`): readiness fails only on clock skew, attention-persistence failure, shutdown, a stalled loop, or a
  thrown cycle other than Redis PING failure (gates, configuration, watermark validation, mid-cycle transport loss). Per-run
  outcomes stay in `healthy=false`, the attention stream and `schedule-attention` logs. Stderr names the thrown category
  (`redis_unavailable` or our own message), never connection details.
- PR #17 (`7c1dc057`): `runDerived` tags errors with their stage and `ts_ai_runs` run ID; failed refresh rows carry an
  allowlisted `reason`, `stage`, `code` and `runId` (see `ai/README.md`). Messages, `failure_code`, locking and retry policy
  are unchanged.
- Review: claude-opus-5-5 (independent, one per PR), no blockers. Fixed: non-Redis thrown cycles staying ready with no
  record; README claiming `workflowStatus` was alertable; verify-phase and topic-cache capacity errors reported as source
  failures; journal writes staged as generation.
- Tests: typecheck clean; tools, api 926, web, jobs 355, ingestion, ai 38, notifications pass. GitHub `isolated-integration`
  passed on both heads. Merged to GitHub `main` as `35847c4`.

## Images (targeted overlays)

Build directory `/home/sky/yt-release-hermes-4-5`. The four overlaid files were byte-identical in the live images, at
`1a1bc6e` and on the production line (`/home/sky/Projects/youtube-board` `29573c1e`) before the change.

- scheduler `youtube-board-ts:release-hermes-sched-19f4881-amd64` `sha256:ba82e713…8dad`: on
  `release-liveplaylist-sched-4bc4144-amd64` (`sha256:1088f610…`), COPY of `jobs/src/scheduler.ts`, `runtime/scheduler.ts`.
- worker-ai-daily `youtube-board-ts:release-hermes-aidaily-7c1dc05-amd64` `sha256:c4cbb713…2c3e`: on
  `release-eventdesc-aidaily-c18ac01-amd64` (`sha256:dd29e43f…`), COPY of `ai/src/days-refresh.ts`, `ai/src/derived-runner.ts`.
- Candidate (`--network none`): both modules load; with Redis unreachable the new scheduler serves `/ready` 200
  `workflowStatus=unknown` and logs `redis_unavailable`, the old one 503 and its healthcheck exits 1.

## Timeline (UTC, 2026-11-07)

| Time | Step |
| --- | --- |
| 15:06 | worker-ai-daily idle (no log in 20 minutes; next job ai.daily at 16:00). |
| 15:07:01 | `release-hermes-4-5.py --execute`: two images swapped. |
| 15:07:28 | Both updates `completed`, healthy. Scheduler `/ready` 200 `workflowStatus=ok`; ticks healthy, no `missedWindow`, 15:06/15:07 slots completed. |
| 15:10:00 | `batch5-ai-hourly-v1` slot enqueued to `youtube-board-ts-batch-ai-hourly` (`waiting`), tick healthy/ready; no `schedule-attention` since the swap. |

## Rollback

`python3 /home/sky/yt-release-hermes-4-5/release-hermes-4-5.py --execute --rollback` (back to `sha256:1088f610…` and
`sha256:dd29e43f…`). Pre-change compose: `/home/sky/yt-release-hermes-4-5/release-hermes-4-5-before-20261107T150701Z.private.json`.

## Monitoring note (#4)

An unreachable Redis no longer replaces the scheduler or shows as 0/1 replicas. `/ready` and `workflowStatus` are loopback
only and the healthcheck reads only the status code, so alert from retained logs on `schedule-attention` and
`Scheduler tick failed` lines, and on Redis/worker health.

## Runbook: retrying the ai-events backfill failures (#5) — not executed

The 2026-10-20 backfill (`/tmp/ai-events-backfill.sh`) ran on the retired skyhong-blog host; neither the script nor a
running days-refresh exists on sky-server. Remaining failed rows need an explicit, approved production write:

1. Confirm a single writer: no `ai:days-refresh` CLI container running, and not within 20 minutes of the scheduled
   `ai-daily-events-v1` slots (07:40, 13:40 Taipei) or `ai.daily` / `ai.daily.catchup` (00:00, 02:20, 04:20, 06:20 Taipei).
2. Pick one window `(d-1, d)` and preview on the worker-ai-daily image with the ai-daily principal (no `--execute`):
   `ai:days-refresh --from=<d-1> --to=<d> --skip-daily --skip-cache --topic-limit=100 --call-limit=100`.
3. Execute the same window with `--execute`. Rows now show `reason`, `stage`, `code` and `runId`.
4. Only for `explicit_retry_required` rows whose `ts_ai_runs` `failure_code` is a generation failure, rerun that window
   with `--retry-failed --execute`. Do not retry `source_unavailable` (no AI call can fix missing source data) or
   `business_key_locked` (wait for the other writer instead).
5. Keep each run's JSON result; stop on any `journal_failed` or `projection_failed` row and inspect before continuing.
