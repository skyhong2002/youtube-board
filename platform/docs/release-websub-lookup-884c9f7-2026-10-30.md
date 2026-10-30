# Release 884c9f7 — WebSub videos.list lookup, general discovery 12 (2026-10-30)

First release on sky-server (the stack moved there on 2026-10-29; Dokploy compose `LQRtdwxmLHsFQZuJIU6Uk`,
app `youtube-board-ts-6oukfq-8na8gq`). worker-youtube-source image and the schedule config only; grants unchanged
(the youtube-source batch union is identical). Background and design: `websub-youtube-push-2026-10-26.md`, section
「2026-10-30 改版」.

## Build

Overlay on the live source image `youtube-board-ts:release-chadmin3-source-fcc6760-amd64` (`sha256:4e7fdc31…`):
COPY of `ingestion/src/channel-jobs.ts`, `ingestion/src/youtube.ts`, `jobs/src/websub-cli.ts`, `shared/websub.ts`,
`shared/worker-permissions.json` from 884c9f78 (sha256 in the image equal to git). The worker runs TypeScript through
tsx, so nothing is compiled. Build directory `/home/sky/yt-release-websub-lookup-884c9f7`.

- Image `youtube-board-ts:release-websub-lookup-884c9f7-amd64`, `sha256:85a53352c793b1c9eb36c78fded9e509fdf178a453e8f9dfcd1b7bbb476525d2`.
- Candidate check in the image: the WebSub dry run, `YoutubeDataApiClient.prototype.videoUploads` present, youtube-source batch profile loads.

## Schedules

`yb_ts_schedules_v11` = v10 with only `batch2-videos-general-v1` `limit` 10 → 12 (42 schedules, diff asserted),
validated with the scheduler image's `validateScheduleConfig`/`workflowArgs`
(`youtube:channels:videos --limit=12 --max-results=50 --execute`). Files in the build directory `sched/`.

## Swap

`.local/dokploy/release-websub-lookup.py --execute` at 09:46:56Z (load 9.9 on 28 cores): worker-youtube-source image and
the scheduler config/top-level config only, every other service and the env asserted identical. Both services
`completed` and healthy within 20 s. Backup `.local/dokploy/release-websub-lookup-before-20261030T094656Z.private.json`.

Rollback: `python3 .local/dokploy/release-websub-lookup.py --execute --rollback`.

## After the swap (first 5 minutes)

- `youtube.websub.sync` 09:48Z: 30 lookups → 29 published (11 live/upcoming), 1 unavailable; 09:52Z: 34 → 34 (11 live).
  The 09:50Z run skipped the lookup (four-minute spacing) as designed. Watch entries in the old bump format were read
  as rechecks and drained.
- `youtube.channels.videos.general` 09:50Z: selected 12, 12 API calls, completed.
- 60 videos stored by WebSub (`urt_video.id = ''`), 21 in `urt_video_live`, 10 already polled by live.poll.
- Quota for the Pacific day 2026-10-30: 940 units at 09:52Z.

## To watch

- Daily quota under 9,000 (estimate 8,600–8,900). If it gets close, set the general discovery limit back to 10 (new config v12).
- `HGETALL yt-ts:websub:stats`: published, unavailable, expired, lookup_failed.
- Overdue channels (`urt_channel.vtime <= NOW()`, 2,253 before the release) should start to fall.
