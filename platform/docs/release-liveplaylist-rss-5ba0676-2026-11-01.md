# Release 5ba0676c — 加入直播 playlist read from its RSS feed (2026-11-01)

worker-youtube-source only, on sky-server. No grant, schedule, env or other service change (asserted by
`.local/dokploy/release-liveplaylist-rss.py`).

## Why

Gene suggested reading the playlist through its RSS feed so the five-minute check costs no YouTube quota, since items are
removed by hand only occasionally. Before this release every run spent one unit on playlistItems.list (about 288 a day).

## Changes (5ba0676c)

- `youtube.live.playlist` reads `https://www.youtube.com/feeds/videos.xml?playlist_id=PLWDKpvlDapjQ` every run (no quota). The
  feed must be one complete Atom feed naming the playlist; anything else counts as a failed read.
- The API page (one unit) is read only when the feed failed or held 15 entries (the feed cap, so possibly cut off), at most
  once an hour. The hold is a `ts_youtube_item_backoff` row (workflow `youtube.live.playlist.api`), written before the call.
- videos.list lookups that found nothing to do (unavailable video, retired channel, full request queue) back off per video:
  5 minutes, doubling to 6 hours. The backoff is cleared once the video is published or its channel requested.
- `--limit` (default 50) bounds every run, whichever source the list came from.
- The `youtube.live.playlist` profile now lists `ts_youtube_item_backoff`. The youtube-source batch union is unchanged (other
  jobs of the batch already hold SELECT/INSERT/UPDATE/DELETE on it), so no grant was applied.
- Review: gpt-6.1-sol (high), no blockers. Fixed its four P2 findings: merged lists over 50 ids, duplicate feed entries
  hiding a full feed, `<entry>` with attributes and damaged feeds, `limit` ignored for the feed.
- Tests: typecheck clean; tools 127, api 926, web 413, jobs 350, ingestion 129, ai 34, notifications 36 pass.

Suggested to Gene: set the playlist to add new videos at the top, so a new item is always within the feed's 15.

## Image

`youtube-board-ts:release-liveplaylist-rss-source-5ba0676-amd64` `sha256:c64c3ded…eec4`: on the 4bc41449 source overlay
(`sha256:3efa596d…`), COPY of `ingestion/src/{index,live-playlist,playlist-feed}.ts` and `shared/worker-permissions.json` from
5ba0676c (the base's copies verified identical to 4bc41449). Build directory `/home/sky/yt-release-liveplaylist-rss-5ba0676`.
The feed was fetched from inside the running source worker before the release: 200, 1 entry.

## Timeline (UTC, 2026-11-01)

| Time | Step |
| --- | --- |
| 14:31:52 | `release-liveplaylist-rss.py --execute`: worker-youtube-source image swapped; update completed, 1/1. |
| 14:35:15 | First scheduled run: `source: feed`, listed 1, unchanged 1, `apiAttempts: 0`, completed. |

Other youtube-source and youtube-live jobs completed normally after the swap.

## Rollback

`python3 .local/dokploy/release-liveplaylist-rss.py --execute --rollback` (back to `sha256:3efa596d…`). The hold and backoff rows
are harmless to the old code. Pre-change compose: `.local/dokploy/release-liveplaylist-rss-source-before-*.private.json`.
