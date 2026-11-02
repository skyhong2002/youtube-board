# Release 7a9ec1e7 — 加入直播 handled items removed with the owner grant (2026-11-02)

worker-youtube-source only, on sky-server: image, one Swarm secret, one env var. No grant, schedule or other service change
(asserted by `.local/dokploy/release-liveplaylist-owner.py`).

## Why

Gene asked that the playlist work as an inbox: videos he adds are handled, then removed, so what stays needs a person.
Removing playlist items needs an OAuth grant from the channel that owns the playlist; the API key cannot write.

## Changes (7a9ec1e7)

- With `YOUTUBE_OWNER_CREDENTIALS_FILE`, `youtube.live.playlist` removes handled videos: tracked (unchanged, revived,
  published), final (retired, retired channel) and unavailable at three consecutive lookups. Kept: a channel still waiting for
  `youtube.channels.admin`, a full request queue, a video in backoff. At most 10 deletes (50 units each) a run. A video is marked
  removed for six hours (`ts_youtube_item_backoff` workflow `youtube.live.playlist.removed`) only once every copy is known gone;
  any owner failure holds removal for an hour (`youtube.live.playlist.owner`) and marks the run incomplete.
- `MysqlQuotaLedger.precharge` takes a unit count; owner calls are charged on the same daily ledger.
- `tools/youtube-owner-authorize.mjs`: one-time PKCE grant, verifies the channel, writes the credentials 0600.
- Review: gpt-6.1-sol (high). Fixed one P1 (unavailable strikes were counted together with other backoff reasons) and three
  P2 (many copies of one video, marker from an incomplete listing, Ctrl-C leaving the credentials file).

## Grant (done with Codex, 2026-11-02)

- Desktop OAuth client "YouTube Board Playlist Worker" in Google Cloud project `skys-gemini-api` (453403068137), the project of
  the worker's `YOUTUBE_API_KEY` (verified by SHA-256), so owner calls draw on the same quota the ledger counts. Audience was
  already In production (the consent screen shows the project's brand name, chumei).
- Granted `youtube.force-ssl` by the 有影儀表板 channel (`UCexfBb1TxA35MHOGF8WgknQ`).
- Stored as Swarm secret `yb_ts_youtube_owner_v1` (mounted 0400, uid/gid 1000, only on worker-youtube-source). The source file
  on the host was shredded after the first run. To replace the grant: run the tool again, create `yb_ts_youtube_owner_v2`, swap
  the mount.

## Image

`youtube-board-ts:release-liveplaylist-owner-source-7a9ec1e-amd64` `sha256:d0950c78…3899`: on the 5ba0676c source overlay
(`sha256:c64c3ded…`), COPY of `ingestion/src/{index,live-playlist,quota,youtube-owner}.ts` and `jobs/src/youtube-cli.ts` from
7a9ec1e7 (the base's copies verified identical to 5ba0676c). Before the release the grant's token refresh was tested from the
image (200, scope includes youtube.force-ssl) without printing it. Build directory `/home/sky/yt-release-liveplaylist-owner-7a9ec1e`.

## Timeline (UTC, 2026-11-02)

| Time | Step |
| --- | --- |
| 08:38 | `docker secret create yb_ts_youtube_owner_v1` |
| 08:38:41 | `release-liveplaylist-owner.py --execute`: image, secret mount, env; update completed, 1/1. |
| 08:40:36 | First run: feed listed 3 (`dKGM2rzKRjs`, `RpAgo1-6DWI`, `wU4xKPmRy8E`), all already tracked, all removed; 151 owner units (1 list + 3 deletes), completed. The feed then had 0 entries. |

Other youtube-source and youtube-live jobs completed normally after the swap.

## Rollback

`python3 .local/dokploy/release-liveplaylist-owner.py --execute --rollback` (image back to `sha256:c64c3ded…`, mount and env
removed). Then `docker secret rm yb_ts_youtube_owner_v1` if the grant should go too, and revoke it at
https://myaccount.google.com/permissions on the account that manages the channel. Pre-change compose:
`.local/dokploy/release-liveplaylist-owner-source-before-*.private.json`.
