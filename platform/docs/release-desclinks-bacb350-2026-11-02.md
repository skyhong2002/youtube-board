# Release bacb350d — cited video ids in event descriptions as links (2026-11-02)

Web service only on sky-server. Workers, scheduler, grants, schedules, env and secrets unchanged (asserted by
`.local/dokploy/release-desclinks-web.py`). No migration, no AI rerun.

## Changes (bacb350d)

- `web/src/lib/description-videos.ts`: AI person/media descriptions name sources by raw YouTube id. An id after 影片 (or a bare
  id) is shown as「<channel> 影片N」, a parenthesised id list as「（影片1、影片2）」; every label links to `/videos/{id}`. Media cards
  use the card's own channel; person cards take the channel from the person's citations, else 「影片」. Numbers appear only when a
  description names more than one video. An 11-character token counts as an id only with a digit, `_`, `-` or an inner capital.
- Applied on the event page (人物觀點) and the people/media page. Older dates are covered because the change is at render time.
- On 2026-11-01's 66 people/media descriptions, 38 carried ids; none remains after rendering.
- Tests: web 422 pass, 2 skipped (+4); typecheck clean. No external review.

## Image

`youtube-board-ts:release-desclinks-web-bacb350-amd64` `sha256:9a1f5665f59281b114f93155eefa434c365bd740b1667f7861eb770e7e54c15a`
on the live 27a6045f web image (`sha256:3ee243b2…`): Next rebuilt from bacb350d with `NEXT_PUBLIC_GA_ID` (web-vitals 6.2.3
copied into the build context as before). 27a6045f..bacb350d touched only the five web files of this change. Build directory
`/home/sky/yt-release-desclinks-bacb350`.

Candidate (live env, dokploy-network, loopback 18192, no secret mounts): ready 200; event page, people page, `/`, `/live/current`,
`/channels`, `/observe`, `/videos/tx680gAY-ww` 200; people page shows「三立新聞LIVE 影片1」linked to `/videos/tx680gAY-ww`.

## Swap

`release-desclinks-web.py --execute` at 2026-11-02T08:36:55Z; update `completed`. After: `/`, `/api/v1/home`, event and people
pages, `/live/current`, `/channels`, `/observe` 200 on https://youtube.observe.tw, with the same links as the candidate.

## Rollback

`python3 .local/dokploy/release-desclinks-web.py --execute --rollback` (back to 27a6045f, `sha256:3ee243b2…`). Nothing persistent
was written. Pre-change compose: `.local/dokploy/release-desclinks-web-before-20261102T083655Z.private.json`.
