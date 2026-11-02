# Release c18ac017 — event person/media descriptions without method caveats (2026-11-02)

worker-ai-daily only on sky-server; every other service, the env and other top-level keys asserted identical by
`.local/dokploy/release-eventdesc.py`. No grant, schedule or secret change.

## Why

People and media cards repeated the prompt's own caveats (「僅依提供的影片標題與上游摘要整理，未觀看影片或進行事實查核」, why the
stance is 其他, unconfirmed numbers) instead of saying what the person or outlet said or did.

## Changes (c18ac017)

- `ai/src/event.ts`: people and media prompts add a description rule (one or two sentences on what was said, done or argued; no
  method, classification or evidence remarks). The summary prompt is byte-identical, so its analyses stay `unchanged`.
- Sentences matching method phrases (未觀看, 事實查核, 上游摘要, 證據不足, 故列為, 不視為已確認, …) are dropped before publication;
  a description left empty is published empty and not shown.
- Tests: ai 36 pass (+2), typecheck clean.

## Image

`youtube-board-ts:release-eventdesc-aidaily-c18ac01-amd64` `sha256:dd29e43f7b090cfdc3b02bab0d50b3035b53c98f8564532bea98a5cd32ded0b8`:
COPY of `ai/src/event.ts` from c18ac017 onto `release-people-172f6eb` (`sha256:c53d2ed4…`), whose copy equalled c18ac017^.
Build directory `/home/sky/yt-release-eventdesc-c18ac01`.

## Timeline (UTC, 2026-11-02)

| Time | Step |
| --- | --- |
| 06:55:39 | `release-eventdesc.py --execute`; update completed (worker idle, last job 05:43). |
| ~07:00 | Manual `ai:days-refresh --from=2026-11-01 --to=2026-11-01 --skip-daily --skip-cache --skip-period --call-limit=100 --topic-limit=100 --execute` in the worker (its env secret sourced in the exec shell): summary 14 unchanged, people 14 published, media 14 published. |

After: daily 5652's latest people/media outputs contain no method phrase (0/28). Older dates keep their stored text; the
scheduled `ai-daily-events-v1` (07:40/13:40 Taipei, previous two dates) applies the rule from now on.

## Rollback

`python3 .local/dokploy/release-eventdesc.py --execute --rollback` (back to `sha256:c53d2ed4…`). Published analyses stay valid
(each run keeps its own prompt in `ts_ai_runs.input_json`). Pre-change compose:
`.local/dokploy/release-eventdesc-before-20261102T065539Z.private.json`.
