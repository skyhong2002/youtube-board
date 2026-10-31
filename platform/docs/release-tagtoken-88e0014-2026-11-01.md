# Release 88e0014 — tag.observe.tw service token for the web service (2026-11-01)

Web service only on sky-server; workers, scheduler, grants and schedules unchanged (asserted).

## Why

After the dc3ccf8 incident: the web service read tag.observe.tw anonymously (`TS_TAG_RELATIONS_AUTH_MODE=anonymous`),
so the ranking pool, picture list, relations and every picture shared tag's 60/min per-IP limit. Since the move to
sky-server that IP is the school NAT address (140.113.240.6), shared with everything else there. tag already gives
its own services 6000/min each (9000/min together) with `x-service-token` (`tag.analysis.tw/docs/service-clients.md`);
the youtube hash was registered but its plaintext was not carried over from skyhong-blog.

Other observe.tw callers checked: blog.observe.tw is recognized by IP (`via="ip"`), live.observe.tw reads tag
directly on `127.0.0.1:18130` (`TAG_API_ORIGIN`, not rate limited). Neither needed a change.

## Changes

- a7368d2: the ranking pool client sends `X-Service-Token` in service mode (it never did).
- 88e0014: revisioned tag pictures are cached for one day whatever their cache-control. tag marks every credentialed
  response `private, no-store`, which would otherwise have disabled the picture cache in service mode.
- New token: plaintext `~/.config/observe-tag/youtube-token` (0600) and Swarm secret `yb_ts_web_tag_token_v1`; its
  SHA-256 replaced the `youtube:` entry of `TAG_SERVICE_TOKENS` in `/home/deck/Projects/tag.analysis.tw/.env`
  (backup `.env.before-youtube-token-20261031T171557Z`, blog entry unchanged); `systemctl --user restart tag-analysis`
  at 17:16Z (back in 3 s, response `x-ratelimit-limit: 6000`).

## Build

One-file-each overlay of `api/src/app.ts`, `api/src/reports/tag-ranked-pool.ts`, `api/src/reports/tag-illustration.ts`
on the live web image `youtube-board-ts:release-ga-web-f449b25-amd64` (`sha256:591e2436…`; its copies equalled the
parents). Build directory `/home/sky/yt-release-tagtoken-88e0014`.

- Image `youtube-board-ts:release-tagtoken-web-88e0014-amd64`, `sha256:10c068dd34e7eb08475960daf6aba9fd11ec3b92b88931174413707f019ed254`;
  file hashes equal git. Candidate check with the token mounted: picture 200 WebP, picture list `available` (728),
  ranking pool 479 entries with `x-ratelimit-limit: 6000`.

## Swap

`.local/dokploy/release-tagtoken.py --execute` at 2026-10-31T17:17:45Z: web image, secret
`yb_ts_web_tag_token_v1` (uid/gid 1000, 0400), `TS_TAG_RELATIONS_AUTH_MODE=service`,
`TAG_SERVICE_TOKEN_FILE=/run/secrets/yb_ts_web_tag_token_v1`; everything else asserted identical. Update completed in
~10 s. Backup `.local/dokploy/release-tagtoken-before-20261031T171745Z.private.json`.
Rollback: `python3 .local/dokploy/release-tagtoken.py --execute --rollback` (back to f449b25, anonymous mode).

## After the swap

`/`, `/keywords`, `/channels`, `/live/current` 200; `/api/v1/keywords/illustrations` `available`; 23/23 home pictures
200; tag metrics `tag_service_requests_total{service="youtube",via="token",outcome="ok"}` counting, no
`unknown service token` log; five repeated reads of one picture made no tag request (cache).

## Rotating the token

New plaintext → new secret `yb_ts_web_tag_token_v2` → swap the web service to it → replace the `youtube:` hash in tag's
`.env` → restart `tag-analysis`. Until both sides match, tag treats youtube as anonymous (60/min), not as an error.
