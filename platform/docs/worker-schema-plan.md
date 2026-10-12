# Worker schema boundaries and source permissions

This describes implementation and a reviewable permissions inventory; it does not itself execute grants. Frontend `youtube_board_ts` source views have a SELECT-only report DEFINER and deliberately cannot publish source changes. Never change their definer to a writer or grant source DML to frontend principals.

The worker connection uses a separate facade schema: direct, same-column-name `ALGORITHM=MERGE SQL SECURITY INVOKER` views point at physical legacy source tables and the single physical TS-owned state schema. Worker identities get only their workflow's view and physical-table rights. No runtime identity receives DDL. Journals, quota state and Laravel dedup locks must each have exactly one physical owner. Generic migrations are forbidden in this mode, including source widening migrations007/008.

Before use, each configured view must be verified as an updatable INVOKER MERGE view with exactly the expected physical schema/table/column projection and no filters, joins, expressions or aliases. Resolve table engines from the verified backing BASE TABLE; a view's null ENGINE is not evidence of InnoDB. Notification transaction preflight must inspect all eight backing durable tables and reject MyISAM. Transactions span schemas on the same connection; this does not make MyISAM writes transactional.

`GET_LOCK` names in `withWriterLock`, AI publication and Laravel business-key helpers contain workflow/business identity rather than schema. A local cross-schema contention test is required before worker handoff; moving the connection's default schema must not create a second lock namespace. Database-mode Laravel source locks must point to the same physical `cache_locks`, with exact prefix. Stopped mode still requires stopping/draining the corresponding Laravel workflow.

## Source DML inventory

Every selected source is also read with SELECT. The following lists mutations, not all source SELECT requirements. `I/U` means INSERT and UPDATE; helpers inspect logical identity before INSERT/UPDATE and do not use REPLACE. Exact read dependency grants still need reconciliation against the chosen executable workflow and options before provisioning.

| Workflow | Physical legacy mutations |
| --- | --- |
| `youtube.videos.stats` | `urt_video` U; `urt_video_schedule`, `urt_video_log`, `urt_video_log_history` I/U. Schedule-origin refresh never changes `urt_video.mtime/stime`; failure scheduling updates selected source only. |
| `youtube.channels.stats` | `urt_channel` U; `urt_count`, `urt_log` I/U |
| `youtube.channels.retire` | `urt_channel` U |
| `youtube.channels.videos.general/live/live_group` | `urt_video`, `urt_video_schedule`, `urt_video_live` I/U; `urt_channel.vtime` U |
| `youtube.tvbs.videos` | Same capture tables with `urt_video_live_tvbs` for live rows |
| `youtube.live.poll` | `urt_video_live` U; `urt_video_live_log` I/U |
| `youtube.tvbs.live.poll` | `urt_video_live_tvbs` U; `urt_video_live_log_tvbs` I/U |
| `youtube.videos.duration` | `urt_video_duration` I/U |
| `youtube.tag_videos.backfill` | Capture tables I/U; optional `urt_show_tag_date` I/U (skip with `--no-cache`) |
| `youtube.comments.queue` | `urt_comment_queue` I/U |
| `youtube.comments.fetch` | `urt_comment_queue` U/D; `urt_comment_author`, `urt_comment_rev`, `urt_comment`, `urt_comment_queue_done` I/U |
| `youtube.comments.reset` (manual) | `urt_comment_queue` I/U if missing; TS stage archival/cleanup separately |
| `youtube.channels.adopt` (manual) | `urt_channel` INSERT only if missing; existing channel adopted by reference; no taxonomy or `urt_count` mutations |
| `reports.counts.build`, `reports.channel_predictions.build` | `urt_count` U |
| `reports.schedule.build` | `urt_video_schedule` U |
| `youtube.live.cleanup` | `urt_video_live` U |
| `reports.live.build` | `urt_show_video_live` I/U |
| `reports.live.clean` | `urt_show_live_tag_date` DELETE after TS archive |
| `reports.live_tag_date.build` | `urt_show_live_tag_date` I/U |
| `reports.tag_date.build`, `reports.people.build` | `urt_show_tag_date` I/U |
| `reports.channel_cloud.build` | `urt_show_cloud` I/U |
| `reports.tag_cloud.build` | `urt_show_tag_cloud` I/U |
| `reports.keyword_cloud.build` | `urt_show_tag_cloud_tag` I/U |
| `reports.keyword_relations.build` | `urt_show_video_tag_date` I/U |
| `reports.tag_month.build` | `urt_show_tag_month` I/U |
| `reports.keywords.cache` | `urt_show_data` I/U with `data_name='tags_all'`; no `tags_all` table |
| `reports.photos.build` | `urt_show_photo` I/U |
| `ai.channel`, `ai.daily`, `ai.hourly` | Respective `urt_channel_ai`, `urt_ai_date`, `urt_ai_hour` I/U |
| `ai.event`, `ai.period`, `ai.mayor_person` | Respective `urt_ai_event`, `urt_ai_period`, `urt_mayor_person_ai` I/U |
| `reports.ai_topic.build` | `urt_ai_date` U |
| `notify.telegram.daily/hourly` | `telegram_digest_stories` I/U, `telegram_digest_dispatches` I/U/D, shared `cache` I/U |
| `channels.avatars.refresh` | None; source channel SELECT, own run journal and filesystem |

Every YouTube external call also reserves/settles source `ingestion_youtube_quota_daily` with INSERT/UPDATE; preserve reserved units and breaker state, never grant DELETE. Database-mode Laravel locking requires shared `cache_locks` I/U/D. These are operational source tables not included in the frontend's36 report views.

TS sidecar rights remain per workflow: common `ts_job_runs` I/U; YouTube backoff I/U/D; comment staging I/U/D plus reset archive INSERT; caches their lineage I/U and selected item-state/archive I/U; AI `ts_ai_runs` I/U; notification runs/attempts/slots exact mutations and resolution journals INSERT only. Adoption needs editorial candidate U and request/audit append rights. Vocabulary/matching write only their TS-owned tables and read source video text. No worker gets auth/session/feed-token access.

## Composite workflow dependencies

- Daily/catchup generation that refreshes source requires `youtube.tag_videos.backfill`, `ai.daily`, `ai.channel`; catchup validates required channel crawl scope and all completed channels before generation. Backfill child uses no-cache mode.
- Hourly source refresh requires `youtube.channels.videos.general` before `ai.hourly`.
- `ai.days_refresh` always requires its own workflow and, depending on skip flags, `ai.daily` plus `ai.channel`, `ai.event`, `ai.period`, and `reports.ai_topic.build`. It does not implicitly grant every AI workflow.
- Backfill with cache publication requires its selected cache/lineage grants; `--no-cache` should not receive unused cache DML.
- Notification readiness reads only. Manual reconciliation has a separate execution gate and requires existing unresolved dispatch/attempt evidence; it must not acquire sending authority implicitly.

No production worker views, grants, engine changes or workflow executions have been performed by this inventory task. The implementation and grant manifest are described below; staged runtime verification remains required.

## Implemented facade and provisioning contract

`node tools/worker-schema.mjs` defaults to an offline plan for an explicit `WORKER_WORKFLOW`; no profile defaults to a wildcard. `shared/worker-permissions.json` is the reviewable per-workflow source/TS rights matrix, including composite dependencies and their optional child-operation envelope. Profiles represent the full supported options for that workflow, not a particular invocation's minimum rights. For example, backfill includes its optional cache publication rights; daily source refresh shares that child profile even though its current CLI uses `--no-cache`. For stricter per-invocation grants, a separately reviewed reduced profile is required rather than silently changing runtime ownership.

Provisioning `--execute` requires protected `WORKER_BOOTSTRAP_URL`, fresh `WORKER_USER` with a32+ character `WORKER_PASSWORD`, `WORKER_BACKUP_OFFHOST_VERIFIED=true` and `WORKER_RESTORE_VERIFIED=true`. Set `APP_ENV=production` and explicit restricted `WORKER_ACCOUNT_HOST` for production. Schema inputs are `WORKER_SOURCE_SCHEMA` (default youtube_board), `WORKER_STATE_SCHEMA` (youtube_board_ts) and `WORKER_TARGET_SCHEMA` (youtube_board_ts_worker). Only direct views and the fresh principal/grants are created. An existing facade is reused only after every existing object is verified against the reviewed table allowlist and its exact backing; nothing is replaced or altered. Missing physical source/TS tables reject execution. Actual grants are checked for table/schema/column/global/role/routine/proxy/PUBLIC expansion. Partial DDL failure is reported and preserved for explicit reconciliation, never automatically dropped.

Runtime uses `DB_DATABASE=youtube_board_ts_worker`, its per-profile DB credentials, `TS_WORKER_SCHEMA_MODE=facade`, `TS_WORKER_WORKFLOW`, `TS_SOURCE_SCHEMA` and `TS_STATE_SCHEMA`. `connectDatabase()` validates every view needed by that profile before returning a usable connection. Physical metadata verification checks MERGE, INVOKER, updatable/no-check-option, exact direct same-name column projection, and actual BASE TABLE engine. `SHOW VIEW` is granted only on the facade views, never DDL. Source notification cache and shared dedup tables remain physically in the legacy schema; notification TS journals remain physically in the TS schema. Migration CLI rejects a facade schema or facade mode even if the other setting is omitted.

## Partitioned queues

Facade mode requires workflow-partitioned BullMQ queues. The queue name is a deterministic hash of the declared workflow; each consumer requires `TS_WORKER_WORKFLOW`, checks that workflow's execution authorization and rejects any job whose name does not match both its queue and profile. Producers use the same function for routing. Explicit `TS_QUEUE_MODE=shared` cannot override facade isolation. Existing local/default single-schema mode retains the shared queue; unknown modes reject startup.

A central producer/scheduler can set `TS_QUEUE_MODE=workflow` without a DB worker profile and route its reviewed schedules to their own queues. A profile-specific scheduler rejects any other workflow before queue mutation. Watermarks are partitioned by central workflow-mode namespace or declared profile, so they cannot suppress one another's due ticks. Queue status queries inspect only the declared profile or bounded explicitly owned workflows. Existing run-input tombstones remain shared to prevent a mode change from replaying an old run; drain/reconcile the old shared queue before transition rather than resetting those tombstones.

## Local verification

`node --test tools/worker-schema.test.mjs` checks offline plans, forbidden grants, schema boundaries and backup preconditions. `WORKER_DB_TEST=1 node --test tools/worker-schema-db.test.mjs` uses only fixed loopback MariaDB11.4 with random disposable source/state/facade schemas and fresh principals. It proves actual MyISAM statistics publication, schedule-origin freshness preservation, auto-ID history insertion, denied unowned/private table and source-DDL actions, shared quota precharge preserving Laravel reservations, cross-schema GET_LOCK exclusion and ownership, and rejection of altered DEFINER/filtered/TEMPTABLE/wrong-source views. A separately provisioned notification principal proves transaction rollback across source cache and TS journal views, and fail-closed behavior when the backing cache engine becomes MyISAM. No external API calls occur. The integration lane enables this test.

Focused queue tests exercise actual producer/consumer constructor routing, wrong-job rejection before execution, scheduler scope and distinct watermark namespaces. Every workflow's full publication behavior is not individually replayed with its production principal by this new test; each staged handoff still needs its bounded profile-specific rehearsal and production schema/privilege parity check. No production worker provisioning or execution is performed by these tools unless explicitly invoked with execution preconditions.

## Startup grant verification and endpoint pin

Production facade connections require an explicit `TS_WORKER_DATABASE_HOST` equal to the configured nonempty `DB_HOST`. This pins the intended MariaDB endpoint; it is independent of `WORKER_ACCOUNT_HOST`, which restricts the DB account's client-origin address/subnet. This internal-network configuration does not claim TLS protection. Runtime schema names remain validated against the distinct source/state/facade boundary.

At each job connection, the worker reads its own `CURRENT_USER()`, `SHOW GRANTS`, PUBLIC grants and applicable/enabled roles. MariaDB11.4 permits these reads without `SELECT` on mysql system tables. Direct table grants must exactly match the reviewed profile, including facade SHOW VIEW. Only plain global USAGE is accepted; extra table/schema/global/routine/proxy/role/delegation rights and nonempty PUBLIC rights reject the connection. The expected DB username must match the authenticated principal. Native-password metadata is stripped internally and never logged or returned. Unsupported authentication/grant syntax fails closed and needs a reviewed parser update; never add mysql-system-table permissions to work around a startup failure.

Startup checking is not a continuous database privilege monitor. Any operator privilege/role/account change requires pausing the affected workers, re-running the privileged exact-grant/object audit, and restarting/rehearsing with their runtime identities. Existing facade routines, triggers or events reject provisioning even when the requested worker lacks EXECUTE, because independent DEFINER events are outside its privilege boundary.

## Controlled view refresh after backing schema change

The exact column projection check intentionally fails closed after a source or TS-owned backing table adds/removes/renames a column. A view refresh is an operator-maintenance step, not an automated migration or runtime privilege expansion:

1. Pause the affected workflow's producers/schedule and drain its worker. Confirm relevant Laravel source writers remain in their reviewed ownership state; do not start a second writer. Record the workflow, source/state/facade schemas, one affected view, expected physical table and backup/rollback evidence.
2. With the separately controlled migration identity, capture the affected view's current `SHOW CREATE VIEW` (object definition only), backing column metadata and the exact runtime grants. Check that the backing table change was independently authorized and completed. The view must still belong to the reviewed manifest and the same physical schema/table. Reject added routines/events/triggers or unrelated object changes.
3. Review and execute only the one own-facade view replacement: `CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW <facade>.<same_name> AS SELECT * FROM <approved_backing_schema>.<same_name>`. Identifiers must pass the bootstrap identifier rules; no user-supplied SQL, expressions, filters, source DDL or frontend DEFINER view changes are allowed.
4. Re-run `verifyFacadeTable` against the current physical columns and `verifyGrants` with the privileged audit identity. Verify runtime startup with the exact profile principal and its limited-grant view/publication rehearsal. Recheck notification physical InnoDB engines when relevant. Replacement must not change the principal or expand source rights.
5. Resume only the paused workflow after successful verification. If any check fails, keep it paused and preserve metadata/evidence; do not blindly restore/drop source data or remove the newly added backing column. The prior view definition is diagnostic/rollback evidence, not permission to bypass the column-shape check.

The local MariaDB regression now adds a column to a disposable source table, proves the old view is rejected as a mapping mismatch, recreates only that facade view and proves verification recovers. Notification shared-mode regression creates all seven other required InnoDB tables but omits cache, and verifies execution rejects before writing a run or invoking a sender. The resolver's optional missing-table behavior is retained solely for callers that explicitly support read-only preview; execution callers already require exact table counts.
