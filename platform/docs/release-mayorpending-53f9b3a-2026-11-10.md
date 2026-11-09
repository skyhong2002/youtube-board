# Release 53f9b3a — mayor dates with still-accumulating buckets drawn dashed (2026-11-10)

Web service only, on sky-server. No grant, schedule, env or other service change (asserted by
`/home/sky/yt-release-mayorpending-53f9b3a/release-mayorpending.py`, modeled on `release-hermes-6.py`).

## Why

Each mayor tag-date bucket is rebuilt (schedules.mayor-cache.json, days=8) until it is seven days old, so the newest
rolling dates sum views that are still rising. The chart drew them as solid lines, so the tail looked like a drop in
attention.

## Changes

- `53f9b3a`: the API counts each date's still-rebuilding buckets (`pendingBuckets` in rows and `bucketCoverage`; a bucket
  is pending while its date is within today−7 and it was last written before date+7). The web marks fully covered but
  pending dates `provisional`: dashed line, hollow points, 累積中 in the tooltip and table, and a note in the coverage notice
  and the method block.
- Tests: api typecheck, full vitest pass (incl. new mayor test); web typecheck and 401 unit tests pass.

## Source line (important)

The live web was not built from GitHub `main`. The production checkout `/home/sky/Projects/youtube-board` is on
`29573c1e`, which holds 10 released commits that are not on `origin/main` (5ba0676c … 29573c1e: live playlist RSS/owner,
related videos, event descriptions, description links). It also has uncommitted brand files (logo, favicon, Wordmark.tsx,
site.ts, public/brand), which the live `favicon-web-20261108` image was built from. So this build used `git archive
29573c1e platform` + the working-tree `platform/web` changes + `git apply` of 53f9b3a (applied cleanly; the patched files were
identical at 29573c1e and at main's parent). Nothing in the production checkout was changed. Follow-up: push or merge
that line into `main` and commit the brand files.

## Image

`youtube-board-ts:release-mayorpending-web-53f9b3a-amd64` `sha256:48c87eb3dbc8e053efec8a3b88a42f1d28ae82904ccce92111e37c7d585b4ed7`
on the live `favicon-web-20261108` (`sha256:4f2ae67a…`): Next rebuilt (the build stage takes `web-vitals` from the
desclinks context's `node_modules`, which the live image lacks), plus COPY of `api/src/reports/mayor.ts` and
`api/src/report-contracts.ts`. The favicon, brand icons, `topic-related.ts` and `runtime/healthcheck.mjs` hashes match the
live image.

Candidate (read-only, writers false, no Redis, 127.0.0.1:18171): `/runtime/live` 200; the Taipei API marks 11/04–11/09
pending (4…24 buckets) with 11/03 and earlier settled; the page shows the 仍在累積 notice; `/`, `/channels`, `/videos`,
`/keywords`, `/about`, `/tags` 200.

## Timeline (UTC, 2026-11-09)

| Time | Step |
| --- | --- |
| 19:14:40 | `release-mayorpending.py --execute` (load 7.6 on 28 cores) |
| 19:15:15 | update `completed`, new task running |
| ~19:16 | public `/`, `/mayor/cities/taipei`, `/channels`, `/videos`, `/keywords`, `/about`, `/api/v1/videos` 200; pending markers live |

## Rollback

`python3 /home/sky/yt-release-mayorpending-53f9b3a/release-mayorpending.py --execute --rollback` (back to `sha256:4f2ae67a…`).
Pre-change compose: `/home/sky/yt-release-mayorpending-53f9b3a/release-mayorpending-before-20261109T191440Z.private.json`.
