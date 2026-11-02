# Release 27a6045f — focus topic related videos and thumbnail fallback (2026-11-02)

Web service only on sky-server. Workers, scheduler, grants, schedules, env and secrets unchanged (asserted by
`.local/dokploy/release-related-web.py`). No migration: related videos are computed at read time.

## Changes (27a6045f)

- `topic-related-v1` (`api/src/reports/topic-related.ts`): every channel's videos of the topic's Taipei day, matched on a named
  person and an event keyword in the title (description first 300 characters only add weight). Show names (≥80% of one
  channel's titles that day, ≥5 videos), generic words (>3% of the day), anonymous people and digits are ignored. A video shared
  by topics counts only when the best beats the runner-up by 1.25×; otherwise it is listed as「也可能相關」. AI-cited videos are
  never counted as related. Per-process cache: past days 6 h, today 10 min. Design and calibration:
  `topic-related-videos-design-2026-11-01.md`.
- `/api/v1/home` topics carry `coverage`; new `/api/v1/ai/days/:id/events/related?event=&page=` (30 per page).
- Home focus card: 「N 個頻道在談 · 另有 N 支相關影片 · AI 引用 N 筆」. Event page: section「其他頻道相關影片」with matched terms
  per video and a collapsed「也可能相關」list.
- Focus pictures try up to six candidate videos (three AI, two related, then the rest) and move to the next one when a thumbnail
  fails. On 2026-11-01 the 10/31 focus 01 and 05 representatives (`8AYnM3ZAWwk`, `f9wiZSDKVnU`) had been made private and
  their thumbnails returned 404.
- Tests: api 935 (+9 topic-related), web 420 (+5); typecheck clean. No external review.

## Image

`youtube-board-ts:release-related-web-27a6045-amd64` `sha256:3ee243b2eb24bcd7fcf53de3e5d15a328076e03e2e2fe8fe7d139f1bf099876d`
on the live 4bc41449 web image (`sha256:d1c502a8…`): Next rebuilt from 27a6045f with `NEXT_PUBLIC_GA_ID` (web-vitals 6.2.3
copied into the build context as before), plus `api/src/{app,contracts}.ts`, `api/src/public-api/catalog.ts`,
`api/src/reports/{service,topic-related}.ts`. The live image's copies of the four changed API files equalled 4bc41449 and HEAD
before the build. Build directory `/home/sky/yt-release-related-27a6045`.

Candidate (live env, dokploy-network, loopback 18191, no secret mounts): ready 200; `/api/v1/home` every topic `coverage`
ready; related route 200; `/`, event page (page 1 and 2), `/live/current`, `/channels`, `/videos`, `/observe` 200.

## Swap

`release-related-web.py --execute` at 2026-11-02T06:46:19Z; update `completed`. After: `/`, `/api/v1/home`, `/live/current`,
`/channels`, `/observe` 200 on https://youtube.observe.tw; home shows「個頻道在談」; the public home API carries `coverage` once the
60 s edge cache expired; event pages show「其他頻道相關影片」.

Known limit: campaign series words (台北大洋流) recur daily, so a previous day's rally video published on the topic day can be
matched to the current rally topic.

## Rollback

`python3 .local/dokploy/release-related-web.py --execute --rollback` (back to 4bc41449, `sha256:d1c502a8…`). Nothing persistent
was written. Pre-change compose: `.local/dokploy/release-related-web-before-20261102T064619Z.private.json`.
