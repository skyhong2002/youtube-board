# Release c01131a — daily live trend and open tables (2026-10-30)

Web service only; workers, scheduler, grants and schedules unchanged.

- Commits: 3f042992, e27c5418, ee07bcfd, 421098f7, c01131aa (fcc6760 → c01131a; ddfd6043 touches only the build-guard tool).
- `/live/trends/daily`: one shared-axis chart with legend toggles (全選／反選), camp colours, dashed second slot pass for >8 categories; period (一週／十天／一個月／一季), metric and group tab groups; 陣營政黨 = tags 3,6,4,5 and new 談話立場 = 48,49 (inferred from the current board.tw page; the old 立場陣營 held all six); 觀測列占比／峰值加總占比 columns.
- Every public page: filter rows and data tables lose their card; charts keep their panel. Admin, ops and API-document tables unchanged.

## Build

The guarded build on skyhong-blog (`/home/ubuntu/yt-release-livedaily-c01131a`, 2500 MB cap) was aborted by the watchdog at MemAvailable 547 MB before Next compiled; the site stayed up. Built instead on sky-mini (arm64 Docker, 2 CPU / 2.5 GB VM): the live web image `release-chadmin3-web-fcc6760` was copied there (`docker save | gzip -1 | docker load`, ~4 min), the same `Dockerfile.web` (Next rebuilt on the live image plus `api/src/report-contracts.ts` and `api/src/reports/live-stored-aggregates.ts`) built in a few minutes, and the result was loaded back on skyhong-blog (~2 min).

- Image `youtube-board-ts:release-livedaily-web-c01131a`, `sha256:d774ef77edd1affecaa8eb4cde9c55b639aa9094e6fc25bc85d4628810ab1163`, arm64, revision label c01131aa37bfebebf3ae386080acf69996f1dc28.

## Acceptance and swap

- Candidate (writers off, loopback 18180): `/runtime/ready` 200; `/api/v1/live/trends/daily?days=30` returned 陣營政黨 with four series, shares 39 / 2.38 / 50.23 / 8.39 and active tabs 一個月／來源列峰值加總／陣營政黨; `group=talk` returned 台灣立場／中國立場. Pages `/live/trends/daily`, `/channels`, `/live/days`, `/keywords`, `/videos`, `/ai/hours`, `/live/current` all 200. Dark-mode screenshot checked through a tunnel.
- Swap: `.local/dokploy/release-livedaily.py --execute` at 2026-10-29 16:33:01Z (load 3.14), web image only, everything else asserted identical. Update completed 16:33:54Z; the public pages above returned 200 right after.
- Rollback: `python3 .local/dokploy/release-livedaily.py --execute --rollback` (back to sha256:1d97c103…, fcc6760). Pre-swap compose backup: `.local/dokploy/release-livedaily-web-before-20261029T163301Z.private.json`.
