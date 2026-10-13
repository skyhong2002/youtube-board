# Effective keyword review: phase 1

No serving overlay is implemented. A keep/exclude proposal and even an approved
proposal return `applied:false`, `applicationStatus:'not-applied'`. Raw vocabulary
terms, video matching evidence, upstream tag pools, source DB rows and vocabulary
serving pointers are untouched. The context is `youtube-ranking-display` or
`youtube-text-matching`; a future controlled apply must bind the same vocabulary,
term key, matching rule and context. Decisions do not silently carry into new
vocabulary versions. Rejected/approved records are terminal; replacement proposals
use a new review UUID, preserving prior records.

## Registration and migration (not executed)

Root registers `registerKeywordReviewOps(app,{auth,env,keywordReviewRepository})`.
All routes, including status/list, require the existing Google administrator
session. POST preview/execute both require existing same-origin Origin,
Sec-Fetch-Site and X-CSRF checks. No account or service-token authority is added.
API responses inherit private/no-store/noindex from the auth guard.

Both `TS_KEYWORD_REVIEW_ENABLED` and `TS_KEYWORD_REVIEW_WRITE_ENABLED` default false.
Disabled registration does not connect to a DB. Missing repository/schema fails
closed. `015_keyword_reviews.sql` adds three InnoDB tables only to the TS state
schema; it is a separately reviewed, privileged migration and must not be run by
HTTP. No migration, grants, production gate, scheduling or deployment is authorized
by these files. Do not provision source-write privileges. Repository construction
requires an explicit TS schema, verifies DATABASE(), and rejects `youtube_board`.
Runtime grants must exclude DDL/TRUNCATE and audit/request UPDATE/DELETE. New table
grants/facade integration need a separate reviewed change; current frontend grants
are not assumed to include them. No automatic CREATE or schema repair exists.

## API contract

- GET `/api/ops/keyword-reviews/status`: `{enabled,writeEnabled,schemaReady,status,
  phase:'review-record-only',applied:false,applicationStatus:'not-applied',rankingOverlayEnabled:false}`.
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
