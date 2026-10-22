# Scheduler and report history repairs — 2026-10-22

## Scheduler readiness (#4)

A retained `PREVIOUS_RUN_FAILED` or `FAILED_REQUIRES_RESUME` result no longer makes an otherwise functioning scheduler unready. `runScheduleCycle.ready` describes current queue/persistence availability; `healthy`, attention records in Redis, and `schedule-attention` log events continue to describe workflow outcomes and coverage gaps. Missing initial baselines and historical missed windows remain visible without making a functioning scheduler fail its container probe.

Independent review also covers a fast worker failing a newly accepted job before its enqueue snapshot is read (`state=failed`): it follows the same readiness/attention separation. An isolated real scheduler process with a deliberately failing BullMQ worker stayed alive across 80 seconds, retained failed jobs with exactly one attempt each, and kept durable attention visible; this is controlled runtime evidence, not a synthetic production job.

`/ready` still requires a successful readiness observation within 60 seconds. Queue submission uncertainty, enqueue failures, clock skew, persistence failures, shutdown and thrown cycle failures remain unready. The endpoint additionally exposes `workflowStatus` (`unknown`, `ok`, `attention`); readiness must not be interpreted as publication acceptance. No failed job is replayed or removed by this change.

## Single pre-publication report sample (#3)

For `reports.schedule.build`, a single valid observation at or before `publishedAt`, or with no publication time, cannot establish a growth interval. It now schedules a new observation no later than two hours after the workflow's actual execution time, matching the existing minimum observation interval. An earlier existing check, including an already-due check, is preserved so repeated report ticks cannot postpone observation indefinitely. The durable result lists the item in `deferred` with `reason=insufficient_history` and `nextCheckAt`; `applied` means the scheduling decision was written, not that a growth estimate became available.

The policy does not alter source timestamps or view counts, clamp an interval, or replay historical work. Ordered pairs retain the existing rate calculation. Invalid timestamps and reversed pairs remain skipped failures, preserving existing failed-publication visibility. Dry-runs return the proposed deferral without writes. This addresses the insufficient-history branch; it does not identify the upstream origin of publication/history timestamp changes.

## Discovery failure visibility (#7)

Channel discovery retains an allowlisted provider category, HTTP status and reason for each playlist API failure. Unknown provider reasons become `other`; arbitrary thrown errors become `unknown`. URLs, credentials, response bodies and driver messages are excluded. Results include aggregate skip/failure counts and `allSkipped`. An all-skipped batch with transient/invalid/unknown provider failures or item-processing failures is a failed workflow. Missing/inaccessible playlists retain the expected per-item skip behavior. Existing cooldowns, quotas and partial writes remain unchanged; no historical job is replayed.

These diagnostics identify future failure categories. They do not retrospectively establish the provider cause of earlier generic `playlist-api-error` records.

## Web data-source diagnostics (#6)

The reader distinguishes missing configuration, pool admission, connection acquisition, statement deadlines and other driver availability failures. Diagnostics contain fixed categories and allowlisted codes, are coalesced per category for 30 seconds, and omit SQL, parameters, URLs and credentials. `/ready` reports database/sitemap subchecks; `/runtime/ready` reports API/UI/security subchecks. Responses remain 503 when their current readiness requirements fail. Query deadlines, pool capacity and probe policy were not relaxed.

This establishes diagnostic coverage; a production recurrence or representative workload with categorized evidence is still needed to identify and validate a root-cause repair of the historical Web outage.

## Dormant comment quota guard (#2, partial)

`youtube.comments.fetch` has a 600-unit daily default sub-budget, configurable only within the shared daily budget. Its fixed `youtube_data_api_v3_comments` ledger row and the existing global row are charged by one conditional join UPDATE. Rejection charges neither row; global outstanding reservations and provider exhaustion still stop requests. Non-comment workflows retain the original single-row precharge path.

An isolated MariaDB test with two competing connections verifies one accepted request at a one-unit comment cap, no extra global charge on rejection, preserved video reservations, continued video use of the shared budget, and the global exhaustion breaker. The parent's earlier focused integration run reported 14 passes; independent review reran this actual database test successfully. No production ledger row was manually changed. Comment schedules and UI remain disabled; #2 is not complete and this release does not enable collection.

## Verification and release status

- Scheduler regression tests cover retained failures, durable attention, continued scheduling, failed queue transport, failed persistence, clock skew and shutdown.
- Report regression tests cover zero/positive counts, publication-time equality, missing publication time, dry-run, subsequent ordered observations, and malformed/reversed history.
- Independent review: isolated MariaDB reader deadlines and diagnostic tests 7 passed; ingestion quota/history/discovery tests 32 passed; scheduler tests with real isolated Redis plus YouTube CLI tests 15 passed, 1 unrelated DB CLI case skipped. Suites ran sequentially under the shared integration-lane advisory lock. API/jobs/ingestion and runtime typechecks passed.
- Parent broad offline results: jobs 296 passed / 48 skipped, ingestion 68 passed / 46 skipped, API 867 passed / 363 skipped / 1 timeout. The sitemap case that timed out passed separately (15 tests, 3.27 seconds). These are not a complete integration-lane pass.
- Deployment and real scheduled acceptance are recorded separately in the release record. Existing failed runs must remain discoverable. #5 AI backfill is outside this repair.
