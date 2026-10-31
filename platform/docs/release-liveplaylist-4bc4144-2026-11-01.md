# Release 4bc41449 — 加入直播 playlist, live cleanup race fix, /admin video links (2026-11-01)

web, worker-youtube-source and scheduler on sky-server; schedules v12 → v13; one grant change. Every other service, the
Dokploy env and other top-level keys asserted identical by `.local/dokploy/release-liveplaylist.py`.

## Why

Gene listed `dKGM2rzKRjs` (歷史哥 Talk 115.10.31) in the public playlist「加入直播」(`PLWDKpvlDapjQ`, owned by the
有影儀表板 channel) because it was missing from the live board. The row existed but was hidden: published 2026-10-30
20:23Z, discovered about 20:26Z, and `youtube.live.cleanup` (27 */2) retired it at 20:27:10Z before `youtube.live.poll`
first read it. The Laravel predicate accepted any row with `ctime < now`. Re-discovery refreshes `ctime` but leaves
`del_flag`. 1–11 rows a day were lost this way.

## Changes (4bc41449)

- Cleanup retires a row only when `ctime` is older than two hours. One-off `youtube:live:cleanup --restore-unpolled-days=N`
  clears `del_flag` on rows retired before their first poll (`del_flag=1 AND mtime IS NULL AND actualEndTime IS NULL`).
- New `youtube.live.playlist` (youtube-source batch, `*/5`, `--playlist=PLWDKpvlDapjQ`): revives rows hit by the race,
  publishes videos of tracked channels like an uploads sweep (always with a live row), and queues an add-channel request
  (actor `live-playlist`, shown in /admin as「來源 加入直播清單」) for an untracked channel. Retired channels are not re-added.
- /admin add-channel and the bookmarklet accept video links (watch, youtu.be, /live, /shorts); the worker resolves the
  channel with videos.list (`VIDEO_NOT_FOUND` when unavailable).
- Review: gpt-6.1-sol (high), no blockers. Fixed: a publish interrupted between `urt_video` and `urt_video_schedule` is now
  completed on retry. Not changed: restore keeps the old `ctime` (refreshing it would show week-old streams as new); it was
  run right after a deploy, 90 minutes before the next cleanup, and every restored row was polled within a minute. The
  request dedupe reads the newest 1,000 requests (documented).

## Images (targeted overlays)

Build directory `/home/sky/yt-release-liveplaylist-4bc4144` (`head/` = `git archive 4bc41449`).

- web `youtube-board-ts:release-liveplaylist-web-4bc4144-amd64` `sha256:d1c502a8…2637`: Next rebuilt from 4bc41449 on the live
  7891484 web image (same recipe as 7891484: `NEXT_PUBLIC_GA_ID`, web-vitals in the build stage), plus
  `shared/channel-admin.ts` for the API. 7891484..4bc41449 outside docs is exactly 4bc41449. Candidate on loopback 18191:
  ready 200; `/`, `/live/current`, `/channels`, `/videos`, `/observe`, `/about`, `/sitemap.xml`, `/admin` 200; the admin
  chunk carries the new label.
- worker-youtube-source `…release-liveplaylist-source-4bc4144-amd64` `sha256:3efa596d…`: on 884c9f7, COPY of every
  `ingestion/src`, `jobs/src`, `shared` file that differed from 4bc41449, except the web-only `shared/legacy-redirects.ts` and
  `shared/media-cache/*` (verified by diff against the image).
- scheduler `…release-liveplaylist-sched-4bc4144-amd64` `sha256:1088f610…`: same on the 7891484 sitemetrics scheduler image
  (adds `channel-jobs`, `tag-backfill`, `websub-cli`, `shared/websub.ts`). Scheduler runtime code is unchanged since fcc6760.
- Both worker images validate v13 (`youtube:live:playlist --playlist=PLWDKpvlDapjQ --execute`,
  `youtube:live:cleanup --limit=100 --restore-unpolled-days=7 --execute`) and load the new job; the old scheduler rejects v13.

## Timeline (UTC, 2026-10-31)

| Time | Step |
| --- | --- |
| 18:53:16 | Backup `/srv/youtube-board-ts/backups/live-playlist-20261031T185316Z/principals` (root 0700): 24 principals / 805 grants, SHA256SUMS. `export-ts-principals.py` still filters on the skyhong-blog service label; it was run from a temporary copy using `youtube-board-ts-6oukfq-8na8gq_db`. |
| 18:53:38 | `release-liveplaylist.py --execute`: three images; `youtube.live.playlist` appended to `TS_INGESTION_OWNERS`/`TS_INGESTION_WRITE_ALLOWLIST` on the source worker and scheduler. |
| 18:53:41 | `tools/live-playlist-upgrade.mjs --execute --phase=worker` (4bc41449 source, dokploy-network, account host `10.201.1.0/255.255.255.0`): youtube-source principal INSERT on `ts_channel_admin_requests` (table + facade), plan `8a78952a…`, full grant set verified. |
| 18:54:11 | All three updates `completed`, healthy. |
| 18:54:17 | `release-liveplaylist.py --schedules --execute`: `yb_ts_schedules_v12` → `yb_ts_schedules_v13` (+`live-playlist-v1` `*/5 * * * *`); completed 18:54:32. |
| 18:54:52 | Restore on the source worker: dry run 38, `--execute` 38 (2026-10-25…11-01, includes `dKGM2rzKRjs`). |
| 18:55:12 | live.poll read `dKGM2rzKRjs`: started 2026-10-31 21:00:19, ended 2026-11-01 02:07:51 (Taipei). Viewer counts for that stream were not recorded. |
| 18:55:27 | First scheduled `youtube.live.playlist`: listed 1, unchanged 1, 1 API unit. |

After: hidden-unpolled rows in the last 7 days 0, alive never-polled rows 0, rows retired by the poller since the restore 0.
https://youtube.observe.tw `/`, `/live/current`, `/admin`, `/channels` 200.

## Rollback

1. `python3 .local/dokploy/release-liveplaylist.py --schedules --execute --rollback` (v13 → v12).
2. REVOKE INSERT on `ts_channel_admin_requests` from `youtube_ts_w_youtube_source`@`10.201.1.0/255.255.255.0` (table and
   facade; the old worker checks exact grants), then `python3 .local/dokploy/release-liveplaylist.py --execute --rollback`.
The restore is not rolled back: the poller has re-evaluated every restored row. Pre-change composes:
`.local/dokploy/release-liveplaylist-{images,schedules}-before-*.private.json`.
