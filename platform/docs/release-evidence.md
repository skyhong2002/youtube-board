# Release evidence — 2026-10-12 local candidate

**Status: locally validated candidate; production adoption remains pending.** No
production routing, writer ownership, provider credentials or deployed services
were changed. This sheet indexes evidence; it does not authorize a handoff.

## Frozen candidate

| Item | Recorded value |
| --- | --- |
| Local image | `youtube-board-ts:historical-local` |
| Image digest | `sha256:daeb41ae1910db82558c3ed1c422210308da160cdd6079005f4cfd824cb39b8a` |
| Previous local image | `youtube-board-ts:closure-local`, `sha256:268faf528d40346a3317c3e4ed8a7901b31e7d1fef98e2d7fada3c3d1f0538ae` |
| Source identity | 630 frozen file hashes; 477 packaged source/asset hashes verified; web source compiled by Next |
| Full isolated lane | 1,029 passed, zero skipped: tools66 / API611 / web71 / jobs103 / ingestion62 / AI61 / notifications55 |
| Production build | All workspace/runtime typechecks and Next build passed inside Docker |
| Packaged HTTP evidence | 49 baseline checks, 22 board/RSS/count followups; 30 requests at concurrency6, median66ms / P95 113ms / max126ms |
| Restore rehearsal | Local synthetic source: 93 tables, 10 triggers, 634 rows; source before/after unchanged; temporary restore database removed |
| Historical migration | 50 original tables / 298,991 original rows preserved across 14 TS migrations, local supplements and identifier collations |
| Historical API replay | 36 routes, all200; 4 exact / 32 different; 43 reviewed header/metadata differences retained in the raw diff |
| Review allocation | 18 Codex / 6 completed Opus; actual Opus model verified, truncated attempts excluded |

These are local measurements. The previous local image is **not** the production
Laravel rollback image. The working tree has not been committed or published, so
the candidate has file/digest evidence but no new release commit. Local fixture
load and a May historical slice do not prove current production capacity or all
query variants. See [historical coverage](historical-parity.md),
[report contracts](../api/PARITY.md), and [runtime checkpoints](../runtime/REVIEW.md).

Private evidence lives under ignored `platform/.local/`:

- `historical-{integration-final,typecheck,runtime-build}.log`,
  `historical-{frozen-hashes,image-verified}.json`.
- `runtime-historical-{smoke,followup}.json`.
- `historical-parity/yt-parity-a1eceee8/`: paired manifests/bodies, source
  fingerprints, comparison/disposition and cleanup record. The disposable lab
  and copied dumps are removed; original approved intake is unchanged.
- `restore-drill/bc45ad96f12042feaba3a6da025428c0/manifest.json` and protected SQL.
- `reviews/historical-integration-resolution.md` and `review-allocation.json`.

## Evidence required before a production decision

| Gate | Current boundary | Required evidence |
| --- | --- | --- |
| Current data and schema | Only approved local historical slices and synthetic fixtures compared | Approved representative current export; actual schema/grants; nonempty coverage for missing sources; reviewed differences and production-size query/SSR measurements |
| Backup and rollback | Local restore procedure verified | Consistent production backup including MyISAM handling; isolated restore result/time; protected prior Laravel web/scheduler image digests and runtime configuration references |
| Google accounts | HTTPS preview configured; user confirmed real Google login on mobile Brave/Tailscale on2026-10-12, avatar and `/my` navigation/empty states work; independent account DB/session secret, authorized reused Google client | Remaining reader mutations/logout/admin acceptance; Console redirect URI `https://youtube.observe.tw/auth/google/callback`; production ingress/grants checks and post-switch human acceptance. See [dated login result](accounts-handoff.md) |
| Maintained vocabulary | Producer/importer and provenance contract implemented locally | Upstream exporter publication and approved snapshot identity/coverage; see [vocabulary handoff](vocabulary-export-handoff.md) |
| External legacy definitions | Approved artifacts lack external PHP group/stopword files | Narrow approved export or explicit acceptance of the documented fixed-definition/local-exclusion fallback |
| Public web | Local immutable image verified | Reviewed staging origin, actual ingress and resource limits, source-data acceptance, exact routing approval and rollback trigger |
| Every writer | TS execution disabled in local preview; Laravel remains production owner | Exact workflow, dependencies, owner/allowlist, quotas, stop/drain evidence, backup reference, first bounded execution, outcome verification and rollback approval |
| Notifications | Local claim/dedup logic tested | Existing history/dedup migration; Laravel stop/drain; first delivery scope and approval; ambiguous-send reconciliation procedure |

Follow the ordered [runtime handoff](../runtime/README.md#required-production-handoff)
and [account acceptance](accounts-handoff.md). Record actual deployment evidence
in protected operator records, without secrets or raw user/source payloads here.
No gate becomes satisfied merely because time passes or local tests pass.

## Per-workflow handoff record

Before enabling any workflow, prepare one concrete record containing:

1. Exact workflow/dependency set, approved owner and allowlists, bounded input and
   quota/delivery budget, and immutable candidate digest.
2. Production backup/restore evidence and protected previous configuration/image
   references; actual source schema/migration and grants verification.
3. Laravel stop/drain proof from the separate scheduler and any manual jobs;
   notification/lease migration evidence where applicable.
4. Approved first execution and independent source/run/provider outcome checks.
5. Rollback triggers, responsible operator, and verification: stop/drain TS,
   disable its execution, restore previous route/image/config, verify exclusive
   ownership, then re-enable Laravel. Keep schema during immediate rollback;
   do not attempt blind column narrowing or automatic data restoration.

These fields remain unfilled until the corresponding authorized deployment task.


## UI followup and human OAuth checkpoint (2026-10-12)

The user confirmed Google sign-in on mobile Brave over Tailscale at `https://skyhong-sm.tailf76d1d.ts.net:12443`: navigation avatar, `/my` sections and empty states, and selected family logo worked. This accepts basic human preview sign-in only. Production still requires the Console redirect `https://youtube.observe.tw/auth/google/callback` and an explicitly approved switch; no human logout, reader mutation or administration acceptance is inferred.

Image `youtube-board-ts:ui-followup-local` is `sha256:11265be8f6f29c6794e299798e3334a9c1788353eb4658d3f80512ccc2370a74`. All632 frozen files matched;477 packaged source/assets matched, without `.env` or `.local`. The full isolated integration lane passed1,035 tests with zero skips; subsequent accepted UI fixes passed78 web tests. Docker reran all typechecks and the Next build. These are distinct runs, not a claimed frozen1,036-test lane.

Seven packaged guest pages were checked at390px: keyword videos,240-character exact-keyword board, channel directory, tag channel ranking, video analytics, daily topics and grouped live hours. None overflowed the document; analytics history kept its480px table inside its scroll container. Classification controls and one active grouped-live tab were visible. Shared keyword evidence accurately shows counts/version, and footer terminology describes YouTube metrics. Private human sessions were not inspected. Evidence: `.local/ui-followup-{image-verified,browser-smoke}.json`, integration/web-final logs and frozen hashes.

Codex cross-review and actual `claude-opus-5-5` integration review (complete `stop`) were addressed: positive incomplete evidence no longer says empty list; scope wording and duplicate tab keys were corrected; exact keyword whitespace and query/path scope were verified. Completed tracked allocation21Codex:7Opus (3:1). Round4 code findings were independently verified closed; stale fallback-status documentation was corrected. See ignored review resolutions. Only the local web was replaced using the HTTPS OAuth overlay; credentials/session secret, DB/Redis and disabled job gates were preserved. Laravel production remains unchanged.


## Channel media checkpoint (2026-10-12)

Image `youtube-board-ts:media-local` is `sha256:826c162a9855d954d2f394f33d40723f183a44b876755072232413850bdf2cc1`. All653 frozen source files matched;494 packaged source/assets matched, and no `.env`/`.local` files were present. Docker completed every workspace/runtime typecheck and the Next production build. The isolated full lane passed **1,084 tests, zero skipped** (tools66/API627/web82/jobs131/ingestion62/AI61/notifications55). Subsequent shared-import compatibility changes passed16 focused API and11 web tests; the final thumbnail sizing adjustment was verified in the packaged browser and Docker types/build. These followups are distinct from the full lane, not a claim that the entire frozen candidate was retested end-to-end.

Channel avatars now reach directories/rankings, channel headers, videos/live, event source comparison, channel filter suggestions/selections and followed-channel records. Video thumbnails reach lists, event evidence, saved/feed records and details. Public avatars are local192px revisioned PNGs tied to exact current channel identity; no arbitrary legacy image URL is hotlinked. Missing cache performs no additional identity query, and available branding is batched. See [media storage/refresh handoff](../docs/media-assets.md).

A disposable same-image web container used the isolated test database and a synthetic media volume. GET/HEAD/ETag/404 and invalid optimizer-query checks passed; web writes failed with EROFS, a same-image unprivileged RW worker probe succeeded, and identical revision bytes survived container replacement. Native collaborative-browser checks at390px and1280px covered channel directory/profile, video list/detail, live and event sources with no document overflow. The actual channel picker displayed avatars in candidates and selected chips. A forced thumbnail404 rendered the local placeholder; a dispatched avatar error rendered the first-character fallback at the unchanged56px size while retaining the source label/link. Light/dark mobile screenshots are recorded below. A square synthetic thumbnail exposed CSS natural-height behavior; fixed explicit image box sizing now remains96×54. All video image requests in this smoke were intercepted by a temporary synthetic proxy; this does not establish a live CDN transfer. Reader surfaces have DTO/render tests, without inspecting or mutating the human's session. Same-component A→B→A recovery is supported by keyed component code but was not separately driven in the packaged browser.

The scratch container, scratch named volume and both temporary proxy listeners were removed; test-database fixture identities were restored. The persistent HTTPS preview alone was replaced with the same final image and existing OAuth overlay. Guest `/auth/me` still reports enabled, `/login` and readiness pass, the exact HTTPS callback is unchanged, the real user's session secret was preserved, and ingestion/scheduler gates remain false. The new main preview media volume is read-only to web; no production/provider refresh was activated.

Codex task-boundary/UI/DTO/runtime/downloader reviews were consolidated with one complete exact-model Opus5.5 security review. Adopted findings: APNG rejection, parent-directory fsync, invalid-ID progress, and preserving the completed cursor prefix on batch interruption. Deliberately retained fail-closed stale locks and the16-revision ceiling with documented operator recovery/cleanup; no unsafe automatic lock theft or silent deletion of immutable URLs. A truncated Opus attempt was rejected and not counted; one bounded retry completed. Tracked review/design allocation is25Codex:8Opus (~3.1:1), with the backend implementation/test report not counted as another independent review.

Evidence remains ignored: `media-integration-verified.log`, `media-import-followup-{api,web}.log`, `media-runtime-build-final-verified.log`, `media-{frozen-hashes,image-verified,runtime-smoke,browser-smoke,browser-desktop,preview-verification}.json`, and `reviews/media-*-codex.md`, `reviews/media-security-{opus.json,resolution.md}`. Screenshot artifacts: `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv4q2j6v-d59b601b.png` (light), `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-100-85-214-25-mv4q2mae-105fc58d.png` (dark). They show synthetic colors and forced missing imagery, not real source logos.

Remaining rollout gates are unchanged: current representative production-size data/grants/load/backup acceptance, upstream vocabulary publication, external legacy definitions or fallback acceptance, and explicit per-workflow handoff/rollback approval. Human basic OAuth preview login is already accepted; production Console still needs `https://youtube.observe.tw/auth/google/callback`. No production switch, commit or push occurred.
