# Release dc3ccf8 — bounded tag picture 429 cooldown (2026-11-01)

Web service only on sky-server; workers, scheduler, grants, schedules and env unchanged (asserted).

## Incident

The home word cloud showed broken-image icons: every `/media/tag-illustrations/…` request returned 404 while
tag.observe.tw served the same pictures (200, valid WebP) to the container. A 429 from tag.observe.tw whose
`Retry-After` was not a number of seconds or a parseable date had set the in-process cooldown to `Infinity`, so
`createTagIllustration` failed fast (about 20 ms, no upstream call) until the process restarted. The JSON endpoints
(`/api/v1/keywords/illustrations`, per-keyword illustration) were stuck at `unavailable` for the same reason; the
home ISR page still carried picture paths rendered before the 429.

## Fix

`api/src/reports/tag-illustration.ts`: `cooldownSeconds()` clamps the 429 hold to 60–600 s; a missing or unparseable
header means 60 s. Tests in `api/test/tag-illustration.test.ts` (bounds, and recovery after an unparseable header,
which fails on the old code).

## Build

The web container runs the API through tsx, so the release image is a one-file overlay on the live web image
`youtube-board-ts:release-livedaily-web-c01131a-amd64` (`sha256:a0b29dbb…`; its copy of the file was byte-identical to
dc3ccf8^). Build directory `/home/sky/yt-release-tagcooldown-dc3ccf8`.

- Image `youtube-board-ts:release-tagcooldown-web-dc3ccf8-amd64`, `sha256:d0b529f9d21181cb30e3949b0f18155a487a5d60293681bc28b40e9fcc3c0a49`;
  file sha256 in the image equals git. Candidate check in the image: a fresh `createTagIllustration().image()` returned
  a 15,034-byte WebP.

## Swap

`.local/dokploy/release-tagcooldown.py --execute` at 2026-10-31T17:08:40Z (load 9.1); update `completed` within ~30 s.
Backup `.local/dokploy/release-tagcooldown-before-20261031T170840Z.private.json`.
Rollback: `python3 .local/dokploy/release-tagcooldown.py --execute --rollback`.

## After the swap

`https://youtube.observe.tw/` 200; `/api/v1/keywords/illustrations` `available`; all 23 tag picture paths on the home
page returned 200.
