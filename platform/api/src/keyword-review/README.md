# Keyword review and administrator ranking exclusions

Approved `youtube-ranking-display` decisions are applied to the 熱門標籤排行:
`api/src/reports/keyword-overlay.ts` reads them through the report principal and
`keywordDisplayMap` drops the excluded term keys (reason `admin-ranking-exclusion`),
as do `/vocabulary` and keyword video lists that use the ranking pool. For each term
key the latest approved decision wins (`exclude` or `keep`); `term_key` hashes source
and exact label, so a decision follows the same label into later vocabulary versions.
`youtube-text-matching` decisions remain records only. Stored records keep their
phase-1 `applied:false` fields; application is reported by `rankingOverlayEnabled`.
Raw vocabulary terms, video matching evidence, upstream tag pools, source DB rows
and vocabulary serving pointers are untouched. Rejected/approved records are
terminal; a later decision uses a new review UUID, preserving prior records.

The one-click endpoint `POST /api/ops/keyword-reviews/ranking-display`
`{requestId,terms[1–20 exact labels],decision:'exclude'|'keep',reason?}` submits and
approves one review per label in a single transaction (two audit rows each), using
the serving vocabulary (restores fall back to the version being reversed). Retries
with the same requestId replay; labels already in the requested state are
`unchanged`. A change drops the API process's keyword caches; pages follow within
about one to two minutes (ISR/HTTP caches). `GET` on the same path lists the labels
currently excluded. Without the tables or grants the overlay is empty and the static
display policy still applies.

## Registration and migration

Root registers `registerKeywordReviewOps(app,{auth,env,keywordReviewRepository,onRankingDisplayChanged})`.
All routes, including status/list, require the existing Google administrator
session. POST preview/execute both require existing same-origin Origin,
Sec-Fetch-Site and X-CSRF checks. No account or service-token authority is added.
API responses inherit private/no-store/noindex from the auth guard.

Both `TS_KEYWORD_REVIEW_ENABLED` and `TS_KEYWORD_REVIEW_WRITE_ENABLED` default false.
Disabled registration does not connect to a DB. Missing repository/schema fails
closed. `015_keyword_reviews.sql` adds three InnoDB tables only to the TS state
schema; it is a separately reviewed, privileged migration and must not be run by
HTTP. `tools/keyword-review-upgrade.mjs` provisions an existing TS schema with a
fresh verified backup: the tables, four append-only triggers, the state writer's
SELECT/INSERT/UPDATE on reviews and SELECT/INSERT on audit and requests, and the
report reader's SELECT on reviews (the ranking overlay). Do not provision
source-write privileges. Repository construction
requires an explicit TS schema, verifies DATABASE(), and rejects `youtube_board`.
Runtime grants must exclude DDL/TRUNCATE and audit/request UPDATE/DELETE. No
automatic CREATE or schema repair exists.

## API contract

- GET `/api/ops/keyword-reviews/status`: `{enabled,writeEnabled,schemaReady,status,
  phase:'ranking-display-applied',applied:false,applicationStatus:'not-applied',rankingOverlayEnabled:true}`.
  `status` is disabled/schema-unavailable/ready. Authentication still applies.
- GET `/api/ops/keyword-reviews?page=1&version=...`: 50 records plus hasMore;
  version is optional. No filters claim current serving applicability.
- GET `/api/ops/keyword-reviews/:uuid`: `{review,audit}` (first100 audit rows).
- POST `/api/ops/keyword-reviews/preview`: `{command}`; response includes command,
  before/after, server actor, previewHash, warnings, writes0 and appliedfalse.
- POST `/api/ops/keyword-reviews/execute`: `{command,previewHash,execute:true}`;
  response `{mode:'execute',review,requestId,replayed,applied:false,applicationStatus:'not-applied'}`.

Submit command: `{requestId,id,action:'submit',reason,vocabularyVersion,termKey,
ruleVersion,context,decision:'keep'|'exclude'}`. `ruleVersion` is exact-text-v1 or
youtube-quality-v2. Approve/reject: `{requestId,id,action:'approve'|'reject',reason,
expectedRevision}`. UUIDs are lowercase. Reason is required, <=2000 UTF-16 units,
no unsafe controls. Client cannot supply actor/raw evidence/status/applied.

Server resolves a published vocabulary run and exact term, preserves its payload
including original labels/provenance, and hashes a version/rule-bound immutable
snapshot into the review. Display policy does not delete that term. Existing article
staging also preserves rejected/raw tag arrays; this UI must not claim every
upstream article audit is embedded into a term snapshot. Matching source references
are retained elsewhere; no evidence regeneration or source-table write occurs.

Preview identity binds command, before/after state, evidence and server actor.
Execution serializes writers, checks request replay identity, re-resolves evidence,
compares preview hash and revision CAS, and commits decision+audit+request receipt
atomically. Audit failure rolls back state. Replays return the original result;
reusing UUID under another actor/content returns409. This phase permits the same
admin to submit and decide; no two-person review authority is assumed.

Minimal future UI `/manage/keywords`: list pending/completed reviews, original term,
version/rule/context/provenance, current static exclusion reason, keep/exclude
proposal and mandatory reason; explicit preview then submit/approve/reject;
persistent '尚未套用排行或文字比對' badge. Reuse account-session loading/client error
style, but existing accountFetch has a strict /auth route allowlist, so new scoped
fetch helper is required. Do not route this through token-only ingestion/workflows.

## Verification limits

Focused domain/service/routes mocks are offline. They do not prove actual MariaDB
locking/grants/triggers, production schema readiness, deployed UI or serving impact.
A separate instance must review code before any integration/activation. Full DB
integration and controlled application remain future work.
