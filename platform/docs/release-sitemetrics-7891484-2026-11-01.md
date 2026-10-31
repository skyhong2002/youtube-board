# Release 7891484 data half — GA4/Search Console sync for /observe (2026-11-01)

worker-cache and scheduler on sky-server, schedules v11 → v12, new table and grants, new secret. Web was released
earlier (`release-observe-web-7891484-2026-11-01.md`). Every other service, the Dokploy env and other top-level keys
asserted identical.

## Google access (verified before the release)

Service account `tag-observe-analytics-reader@skys-gemini-api.iam.gserviceaccount.com` (reused from tag.observe.tw).
A one-off probe with `jobs/src/google-analytics.ts`, run as root on the host, printed only statuses and counts:
GA4 Data API runReport, Realtime and Search Console searchAnalytics for `https://youtube.observe.tw/` all returned
HTTP 200 with zero rows (about 17:50Z). That is **access granted, no data yet**, not an access failure. A permission
or API failure would surface as `Google API HTTP 4xx/5xx` and fail the run.

GA receipt. The browser side only shows that requests were attempted. The Google readback below is the evidence.
- **Contains test traffic.** At 17:51Z (twice, 17:51:14 and 17:51:32) a Playwright Chromium visit to `/about` → `/channels`
  was sent to production GA on purpose. It used a normal UA and hid `navigator.webdriver`, the one-off method tag's
  analytics doc describes; DNT, GPC and opt-out were all off. Requests seen in the browser: `page_view` and `web_vital` POSTs to
  `www.google-analytics.com/g/collect` (`tid=G-X2G1PLNP7K`, `dt=有影儀表板`), no CSP errors. Playwright reported those
  requests as `net::ERR_ABORTED`. That alone does not show they were delivered.
- **Google readback (evidence):** GA Data API `runRealtimeReport` for property 558497452 at **2026-10-31T17:52:01Z**:
  `page_view` 2, `web_vital` 2, `session_start` 2, `first_visit` 1, activeUsers 2.
  The scheduled `site.analytics.live` stored activeUsers 2 / views 2 at 18:01:08Z. All of these counts **include the test
  visits** and must not be read as organic traffic.
- No further test traffic is to be generated, and the DNT/GPC/opt-out/automation guards stay as they are.

## Images (targeted overlays, not the full HEAD)

worker-cache ran `c51bebd`, 90 commits behind. Overlaying all of HEAD would also change the report-cache workflows, so
only the site-analytics change was applied to each live image's own source (hand-merged, `git apply` did not fit):
`jobs/src/{cli,workflow-registry}.ts`, `shared/{worker-batches.ts,worker-permissions.json}` (adds only the two
profiles), plus new `jobs/src/{google-analytics,site-analytics-cli}.ts`, `shared/site-analytics.ts`,
`runtime/schedules.site-analytics.json`. The live images' copies of the patched files equalled their base commits.
The cache-batch permission profiles equal 7891484's, so the upgrade tool's grants match what the worker checks.
Build directory `/home/sky/yt-release-sitemetrics-workers` (`cache/`, `sched/`; worktrees `/home/sky/yt-sitemetrics-wt`,
`/home/sky/yt-sitemetrics-sched-wt`).

- worker-cache `youtube-board-ts:release-sitemetrics-cache-7891484-amd64`, `sha256:1f57a45e88a6f373f682da44b6894004a289c612cb8611d19829a0551d28cc50` (base c51bebd `d9616981…`).
- scheduler `youtube-board-ts:release-sitemetrics-sched-7891484-amd64`, `sha256:0c0c5f66cc588e9b2733de803688d66da951877d1d410fdab2a48c03215a7ea5` (base fcc6760 `d90b41e7…`).
- Checks: typecheck and the site-analytics/schedule tests passed on the patched c51bebd tree. The only failure was c51bebd's
  own `worker-batches` test, which still expects the 13 old cache workflows. The new scheduler image validates the 44-schedule v12
  (`site:analytics:sync|live --execute`); the old image rejects it (`Unregistered workflow`).

## Timeline (UTC, 2026-10-31)

| Time | Step |
| --- | --- |
| 17:56:18 | Backup `/srv/youtube-board-ts/backups/site-metrics-20261031T175618Z/` (root 0700): `export-ts-principals.py` 24 principals / 802 grants (sha256 `da8f7b0a…`), schema-only dump of `youtube_board_ts` + `youtube_board_ts_worker_cache` (44 tables), SHA256SUMS. Nightly NAS full dump unchanged. |
| 17:56:27 | `docker secret create yb_ts_google_analytics_sa_v1` from `/root/youtube-board-secrets/google-analytics-sa.json` (never printed). |
| 17:58:50 | `tools/site-metrics-upgrade.mjs --execute --phase=prepare` (pinned 7891484 source, container on dokploy-network, root URL passed through a pipe), account host `10.201.1.0/255.255.255.0`: table, INVOKER facade view, report SELECT; plan `8dbf3472…`; source writes/DDL 0. API stopped logging TABLEACCESS_DENIED. |
| 17:59:47 | `.local/dokploy/release-sitemetrics.py --execute`: worker-cache image + Google env + secret (uid/gid 1000, 0400) + owners/allowlist; scheduler image + owners/allowlist. |
| 17:59:50 | `--execute --phase=worker`: cache principal SELECT/INSERT/DELETE (table) and +SHOW VIEW (facade); full grant set verified. |
| ~18:00 | Both updates `completed`, healthy, 0 restarts; `reports.live.build` completed 18:00:13 on the new worker. |
| 18:00:54 | `release-sitemetrics.py --schedules --execute`: `yb_ts_schedules_v11` → `yb_ts_schedules_v12` (+`site-analytics-sync-v1` `20 * * * *`, `site-analytics-live-v1` `*/2 * * * *`, Asia/Taipei). |
| 18:01:08 | First scheduled `site.analytics.live`: 2 active users, 2 views. |
| 18:01:26–40 | Manual `site:analytics:sync --execute`: GA 90-day backfill 49 rows (2026-10-12…13, the short window when GA worked before later builds dropped the ID); GSC: the read succeeded (run `completed`) and returned 0 rows, because the URL-prefix property was only verified today. That is no data yet, not a failure. |

Old-subnet accounts (`10.0.1.0/24`, kept for 36 definer views) were not granted: the new view is SQL SECURITY INVOKER and
no live connection uses that subnet.

## Scheduled runs (evidence)

- Scheduler (v12) `site.analytics.live` 2026-10-31T18:00:00Z and 18:02:00Z `completed`, then every 2 minutes; the latest stored
  `fetched_at` was 18:20:05.028Z.
- Scheduler `site.analytics.sync` 2026-10-31T18:20:00Z (queue `youtube-board-ts-batch-cache`, runId `schedule-1dc58bec…`) `completed`;
  `ts_job_runs` 18:20:05.015Z: GA refresh window 2026-10-25…11-01 rows 0 (`backfill:false`), GSC rows 0 (`backfill:true`).
  Both reads **succeeded without data**: GA has not yet processed 2026-11-01, and the new GSC property has no data yet. While GSC
  stays empty, each run requests the full 90-day backfill again (cheap, read-only) until rows appear.
- Manual `site.analytics.live` was not run: the scheduled job covers it, and a second writer for the same workflow is avoided.
- Public API 18:20:35Z: `updatedAt` 2026-10-31T18:20:05.013Z, `live` {fetchedAt 18:20:05.028Z, activeUsers 2, views 2}. The live
  figures are inside the 30-minute window of the 17:51Z test visits, so they **include test traffic**. `search` and `vitals` are null.

## After

`GET /api/v1/site-observation?days=90`: `updatedAt` 18:01:40Z, `live` {2, 2}, `trackingSince` 2026-10-12, top pages named from paths;
`search` and `vitals` null (no GSC rows yet; no processed `web_vital` yet). `/observe` 200 and shows 最近 30 分鐘.

Expected next: GA processed reports for 2026-11-01 onward within 24–48 h (hourly sync rewrites the last 7 days); GSC
rows in a few days; vitals once processed `web_vital` events carry the custom dimensions created on 2026-11-01.

## Rollback

1. `python3 .local/dokploy/release-sitemetrics.py --schedules --execute --rollback` (v12 → v11).
2. REVOKE the cache principal's three `ts_site_metrics` grants (worker checks exact grants), then
   `python3 .local/dokploy/release-sitemetrics.py --execute --rollback` (images, env, secret mount).
The table, view, report SELECT and the secret are additive and can stay. Pre-change composes:
`.local/dokploy/release-sitemetrics-{images,schedules}-before-*.private.json`.
