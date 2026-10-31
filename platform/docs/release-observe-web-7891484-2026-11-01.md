# Release 7891484 — Web Vitals and /observe, web only (2026-11-01)

Web service only on sky-server; workers, scheduler, grants, schedules, env and secrets unchanged (asserted).
Ships 603f9b87 (`web_vital` GA4 events) and the web/API half of 7891484 (`/observe`, `GET /api/v1/site-observation`).
The data half (table `ts_site_metrics`, grants, worker-cache image, schedule `schedules.site-analytics.json`, Google
service-account secret and env) is **not released**; until then the API returns empty data and logs one
`ER_TABLEACCESS_DENIED_ERROR` reader warning per uncached request. Steps: `analytics.md`.

## Build

Overlay on the live web image `youtube-board-ts:release-tagtoken-web-88e0014-amd64` (`sha256:10c068dd…`): Next rebuilt
from 7891484 with `NEXT_PUBLIC_GA_ID=G-X2G1PLNP7K` (the build fails unless chunks contain the ID and `web_vital`;
`web-vitals` 6.2.3 copied into the build stage, the image's node_modules predate it). API files copied:
`api/src/app.ts`, `api/src/public-api/catalog.ts`, `api/src/seo/sitemaps.ts` (live copies equalled 88e0014 before),
new `api/src/reports/site-observation.ts`, `shared/site-analytics.ts`. Build directory `/home/sky/yt-release-observe-7891484`.

- Image `youtube-board-ts:release-observe-web-7891484-amd64`, `sha256:0f9d4238a3dc90de6e2baee457de27426ae6840dd445d5b3cfddd9ef46e5403c`.

Candidate (live env, loopback 18191, no secrets/log mounts): `/runtime/ready` 200; `/`, `/observe`, `/observe/opt-out`,
`/about`, `/channels`, `/videos`, `/live/current`, `/keywords`, `/sitemap.xml` 200; site-observation `days=28` 200 with
empty data, `days=5` 400.

## Swap

`.local/dokploy/release-observe-web.py --execute` at 2026-10-31T17:38:17Z; `completed`. Backup
`.local/dokploy/release-observe-web-before-20261031T173817Z.private.json`.
Rollback: `python3 .local/dokploy/release-observe-web.py --execute --rollback` (back to 88e0014).

After: the pages above and the API 200 on https://youtube.observe.tw; served chunk still has `G-X2G1PLNP7K`.
