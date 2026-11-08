# Release ed1c6406 — web liveness healthcheck (#6) (2026-11-08)

web only, on sky-server. No grant, schedule, env or other service change (asserted by
`/home/sky/yt-release-hermes-6/release-hermes-6.py`, SHA256 `aab1eca4…`). account-maintenance keeps its image: its
`healthcheck.mjs` and probe allowlist ship together, so the old pair stays consistent.

## Why

The web container healthcheck called `/runtime/ready`, whose API check runs `SELECT 1` through the shared 6-connection
reader pool. A saturated pool (admission queue 24/24, 3 s acquire deadline) or a slow database failed three probes on a
healthy process and Swarm replaced the only web task, turning degraded data into a public 502.

## Changes

- PR #18 (`23ff363`, `ed1c640`, merged as `d644c21`): the healthcheck calls `/runtime/live`. It requires the Next page and
  CSP, and the database check only until it has passed once since boot; afterwards a database failure reports
  `api: degraded` and the task stays. `/runtime/ready` is unchanged and still reports data-source failure.
- Review: claude-opus-5-5 (independent), no blockers. Fixed: a Next child that accepts connections but never answers held
  the check open (undici 300 s header timeout) while liveness returned the last good result; the `/about` check now has a
  4 s deadline. Docs updated.
- Tests: typecheck clean; api 929, jobs 355, web 122, ai 38, notifications, tools pass. GitHub `isolated-integration`
  passed on `ed1c640`.
- Isolated candidate (internal network, scratch MariaDB): MariaDB paused → old image healthcheck exit 1, new exit 0 with
  `api: degraded` while `/runtime/ready` fails; Next child SIGSTOPped → new healthcheck fails from the second probe;
  cold start without a database → not live.

## Image (targeted overlay)

`youtube-board-ts:release-hermes-web-ed1c640-amd64` `sha256:bca5347c…d9ba` on `release-desclinks-web-bacb350-amd64`
(`sha256:9a1f5665…`), COPY of `runtime/server.ts`, `runtime/readiness.ts`, `runtime/healthcheck.mjs`. The three files
were byte-identical in the live image, on GitHub `main` and on the production line (`/home/sky/Projects/youtube-board`
`29573c1e`) before the change, and equal `d644c21` after.

## Timeline (UTC, 2026-11-08)

| Time | Step |
| --- | --- |
| 06:29:40 | `release-hermes-6.py --execute`: web image swapped (start-first). |
| 06:29:46 | New task started; healthy after its start period. |
| 06:30:12 | Public `/` and `/api/v1/videos` answered 503 once, most likely the old task draining while Traefik still routed to it (not confirmed). |
| 06:30:21 | Update `completed`. `/runtime/live` and `/runtime/ready` 200; public `/`, `/api/v1/videos`, `/tags` 200. Old task exited cleanly (gateway 0, ui 143). |

## Rollback

`python3 /home/sky/yt-release-hermes-6/release-hermes-6.py --execute --rollback` (back to `sha256:9a1f5665…`).
Pre-change compose: `/home/sky/yt-release-hermes-6/release-hermes-6-before-20261108T062940Z.private.json`.

## Monitoring note

A degraded data source no longer replaces the web task or shows as 0/1 replicas. Alert on `/runtime/ready` and
`data-source-failure` logs for data-source health.

## Separate finding: daily web exits (not fixed)

The four web task exits between 2026-11-05 and 2026-11-07 (`non-zero exit (1)`, lifetimes 12–24 h) were the gateway
child (`runtime/server.ts`, `--max-old-space-size=384`) reaching the V8 heap limit (`FATAL ERROR: Reached heap limit`,
SIGABRT; ~381 MB live after Mark-Compact). Not cgroup OOM, not healthcheck replacement. The exited containers and their
logs are retained (`docker ps -a`). A read-only inspector sample of the gateway at 8.6 h uptime showed 187 MB heap used
(old space 155 MB), RSS 604 MB. The retaining structure is not identified; a code scan found no unbounded structure, and
mysql2's per-connection prepared-statement cache is unconfirmed (idle connections close after 60 s; the server held 571
prepared statements across all clients).
