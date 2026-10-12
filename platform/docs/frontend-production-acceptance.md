# Frontend production acceptance

This is the frontend execution checklist for the already-authorized phased
[cutover](cutover-review-plan.md). It does not transfer background workflows.
No production access or change was performed by the author of this source review.
Root owns the current backup/restore evidence and actual execution record.

## Freeze and deploy prerequisites

- Record the frozen source SHA/manifest, immutable TS image digest, actual Laravel
  web and separate scheduler image/configuration, and protected prior route/env
  references. Build from repository root with `platform/Dockerfile`; the repository
  root Dockerfile is Laravel. Do not change the Laravel autodeploy target.
- Verify the consistent off-host backup and isolated exact-version restore before
  bootstrap or service edits. Root reports 66 restored tables and 11 matching
  manifests; attach the completed off-host retrieval/hash proof in the execution
  record instead of treating this source document as evidence of completion.
- Complete the dedicated [frontend schema bootstrap](frontend-schema.md), then
  verify effective grants and live source-view metadata. There are 36 source
  views with a SELECT-only report definer, 36 own-state base tables, and 14 public
  TS tables readable by the report principal. The own-state account can read only
  the `urt_channel` and `urt_video` source views for private feeds. Do not widen
  those grants to make a missing report pass.
- The final runtime image intentionally does not copy `tools/` or `migrations/`.
  Bootstrap is an operator-only task using frozen audited tooling, separate from
  web: use the frozen build-stage artifact, or mount the reviewed
  `tools/frontend-schema.mjs` and `migrations/002-frontend-state.sql`
  read-only at their expected relative paths in a one-shot dependency-equipped
  container. Record hashes and override the command explicitly. Do not put the
  bootstrap identity in the web service or assume the runtime image contains the
  bootstrap CLI. Never run general legacy ALTER migrations for frontend-first.
- Set `APP_ENV=production`, `TS_FRONTEND_SCHEMA_MODE=isolated`, report
  `DATABASE_URL` and distinct own-state `TS_DATABASE_URL` on the new schema.
  `AUTH_DATABASE_URL` may be omitted; if supplied it must match the state identity
  and credential. Do not set legacy `DB_*` writer credentials. The corrected
  [runtime template](../runtime/env.example) deliberately leaves secrets blank.
- Use `AUTH_PUBLIC_ORIGIN=https://youtube.observe.tw`, independent production
  Google credentials/session secret, and the reviewed admin bindings. User has
  already confirmed callback registration. An anonymous `/auth/me` verifies
  config/schema availability without initiating an OAuth flow.
- The inspected Traefik peer was `10.0.1.17`, on overlay `10.0.1.0/24`. Reverify
  that exact peer from the new service's network before setting
  `AUTH_TRUSTED_PROXY_CIDRS=10.0.1.17`. Do not trust the entire overlay merely
  because it is the DB connection subnet. A restricted MariaDB account host such
  as `10.0.1.0/255.255.255.0` is a separate decision based on actual DB peer paths.
- Keep all TS ingestion, production, scheduler, ops and deploy-relay gates off,
  owners/allowlists empty, provider credentials absent, and no TS worker/producer
  service started. Redis is not required for this disabled frontend path. Keep
  `TS_OPS_TOKEN` empty and `TS_OPS_SERVICE_AUTH_ENABLED=false`.
- Fastify serves port 8000; Next binds internal loopback 3100. Use at least a
  35-second web stop grace, a 1 GiB memory limit and the reviewed CPU limit. Verify
  the real Swarm healthcheck calls `/runtime/ready`, not only `/up` or `/healthz`.
  Mount media read-only; missing media falls back and does not require a writer.
- Prepare and validate the rollback maintenance responder and exact private-path
  routers before the public switch. A written rollback intention is insufficient.

## What green health does and does not establish

`/up` and `/healthz` prove process liveness. `/ready` executes `SELECT 1` using the
report pool. `/runtime/ready` combines that probe with a Next `/about` fetch; it
does not query source views, validate every report column, or verify account and
reader grants. `/auth/me` reports auth readiness fixed at startup; it does not
exercise private feed joins. Treat all of these as separate checks below.

Fresh own-state vocabulary/evidence/editorial tables are empty. Keyword coverage
must say unavailable/not synchronized; it must not silently fall back to channel
taxonomy or claim a complete maintained vocabulary. This is a recorded frontend
limitation until the separately sequenced vocabulary stage is accepted. The
frontend account grant plan deliberately excludes `ts_editorial_candidates`, so
the editorial administration listing is not accepted as enabled in this stage.
Reader account administration and editorial workflow administration are distinct.

## Read-only canary

First execute on the restored clone, then once on the candidate staging route,
then once immediately after the public route switch. Use no cookies or bearer
headers, do not follow redirects, and do not print complete response headers
containing cookies or private locations. Use concurrency 1, at most 30 GETs per
pass, a 10-second per-request deadline, 2 MiB body cap and no automatic retry.
Record status, selected safe headers, duration, bounded body hash and assertions.
Stop the pass on unexpected 500/503 or schema/grant errors. A requested page that
returns an error is not passing parity merely because the other reader errors.

Select one actual channel `C`, byte-exact video `V`, nonempty taxonomy `T`, source
date `D` and stored AI identity from the approved clone. Keep them in the private
case manifest; do not substitute synthetic 990001/Fixture IDs on production.
Do not mutate the data to make a case nonempty.

| GET request | Required assertion |
| --- | --- |
| `/up`, `/runtime/ready` | 200 and expected liveness/readiness payloads. |
| `/`, `/about` | 200 HTML, fresh nonce CSP and `private, no-store`; HSTS `max-age=31536000` without unreviewed preload/subdomain scope. |
| `/api/v1/status` | 200, `readOnly:true`; expected frozen route registry. |
| `/api/v1/home` | 200; actual source counts/freshness; unavailable panels explicitly identified. |
| `/api/v1/channels?limit=1` | 200 and actual source identity/count types. |
| `/api/v1/channels/C` | Same channel identity as the list, including `flag_del=0` cases when present. |
| `/api/v1/videos?limit=1` | 200 and nonempty actual rows; unknown counts remain null. |
| `/api/v1/videos/V`, `/api/v1/videos/V/tags` | Exact original video ID; no future scheduling timestamp as freshness; honest matching state. |
| `/api/v1/tags/T/channels?limit=1` | 200, source-backed taxonomy and stable ordering. |
| `/api/v1/tags/T/days?from=D&to=D` | 200 or the specifically reviewed source-data availability result; daily metrics cover exactly the selected Taipei date. |
| `/api/v1/live/current?limit=1` | 200; current versus expired observations follow the recorded window, not a fabricated nonzero expectation. |
| `/api/v1/ai/days?date=D` | 200 with date/source scope; choose the actual returned event link for one further GET. A daily summary ID is not necessarily an `/ai/events/:id` ID. |
| `/api/v1/vocabulary?limit=1` | Version/scope/provenance match staged state; initial empty version is recorded as a limitation. |
| `/channels/C`, `/videos/V/analytics` | 200 HTML using existing source identity; no disguised generic video page. |
| `/feeds/videos.xml` | 200 RSS with production-origin links and truthful `lastBuildDate`; no preview host or synthetic data. |
| `/channel_date.php?u_id=C&date=D` | 308 to the reviewed current AI date route preserving both parameters; do not follow automatically. |
| `/auth/me` | 200, `enabled:true`, `user:null`, `csrfToken:null`; private/no-store, Vary Cookie, noindex, no-referrer. |
| `/auth/me/feed`, `/auth/users` | 401 `SIGN_IN_REQUIRED` without cookies; private/no-store. |
| `/feeds/u/invalid.xml` | 404 and private/no-store; no real private token used. |
| `/api/ops/workflows` | 404 `OPS_DISABLED` with empty service token. |
| `/api/ops/editorial` | Anonymous 401 when accounts enabled; no data exposure. |

Repeat only `/` once within the request cap to verify the nonce changes and CDN
does not return cached HTML. Inspect cache rules directly: public API/RSS caching
does not authorize caching `/auth`, `/feeds/u`, or any nonce-bearing HTML. Check
actual browser hydration, Chinese fonts, YouTube image/iframe policy and a theme
toggle on the staging route using a guest tab. Reuse existing desktop/mobile/dark
fixture screenshots only as visual evidence, not current-data acceptance.

Do **not** use GET/HEAD `/auth/google` as a read-only canary: its handler inserts an
OAuth flow. Google callback and logout also belong to the explicitly staged
account acceptance, not this pass. No production write-denial probes, job POSTs,
webhook redelivery or provider inference are part of the read-only canary.

## Parity and capacity on the restored clone

Run Laravel and TS readers against the same immutable restored source rows, fixed
clock and origin. Preserve the source artifact fingerprint, reader fingerprints,
case bodies and SHA-256 values in the private evidence directory. The existing
`tools/parity-compare.mjs` accepts the exact 36 compatibility API routes; it is an
offline comparator, not authorization for an HTTP crawl. Reuse all 36 historical
case identities with current representative nonempty inputs where available.
Keep the comparator's status, content type, array order, numeric tokens and exact
string comparisons. Document individual approved differences; do not normalize
away freshness, counts, IDs, nulls or entire metadata objects.

Add explicit modern DTO checks for channel flag consistency, a future `stime`
fixture, video-text evidence after statistics-only refresh, Taipei day endpoints,
large tag 102 date paging, byte-exact YouTube IDs, comments, source AI daily/hourly
identity, group fallbacks, keyword stale/unmatched coverage, and board/RSS scope.
Write-bearing fixtures for those invariants run only in the isolated test lane.
Empty data cannot establish nonempty report parity; record a missing case as such.

Proposed clone capacity gate for the frontend decision record: 60 report/HTML/RSS
requests, concurrency 4, 10-second request deadline, 1 GiB web memory cap, no OOM,
zero unexpected 5xx/timeouts, p95 at most 3 seconds, max at most 8 seconds, and
container memory peak below 900 MiB. Include the largest approved tag/date query
and SSR fanout rather than repeating `/up`. Declare these thresholds before the
run and record actual results. This is clone load testing; production receives
only the bounded sequential canary above. Do not widen DB grants, SQL deadlines,
or host resources silently to force a pass.

## Exact routing and rollback requirements

Keep the Laravel web service alive, its image/configuration recoverable, and its
separate scheduler unchanged throughout frontend acceptance. Capture the actual
Traefik router names, priorities and service targets before editing. Use explicit
priorities; record the chosen numeric values rather than relying on rule length.
The same hostname continues to use existing DNS/TLS; no DNS change is needed.

| Match on `youtube.observe.tw` | Frontend accepted route | Frontend rollback route |
| --- | --- | --- |
| Exact `/ops/deploy/dokploy` | Retained Laravel service, higher priority than TS catch-all; existing HMAC configuration unchanged. | Same retained Laravel service. |
| Other actually verified Laravel operational paths | Individually preserved only if present in the captured configuration. | Original individually captured targets. |
| `/auth` or `/auth/…` | Candidate Fastify. | Prepared maintenance responder returning 503 + private/no-store. |
| `/feeds/u` or `/feeds/u/…` | Candidate Fastify. | Same maintenance responder. |
| `/api/ops/editorial` or `/api/ops/editorial/…` | Candidate Fastify, protected by auth and disabled execution gates. | Same maintenance responder. |
| All other public paths | Candidate Fastify port 8000. | Retained Laravel web service port 8000. |

Match exact roots plus slash-delimited prefixes; do not accidentally match
`/authentication` or `/feeds/unknown`. Maintenance must accept every HTTP method
for these sensitive paths without redirecting, logging full token/query paths,
forwarding to Laravel, or accepting state changes. Return a generic body and
`Retry-After: 300`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, and
private/no-store. The dedicated responder is
[`runtime/account-maintenance.mjs`](../runtime/account-maintenance.mjs), included
by the existing runtime-directory Docker COPY. Create a separate service using
the same frozen TS image, command
`["node","runtime/account-maintenance.mjs"]`, `PORT=8000`, and
`RUNTIME_ROLE=web`; retain the image's tini entrypoint. It requires no DB, Redis,
OAuth, session or provider secrets, mounts, or application imports. Use at least
a ten-second stop grace. It serves exact GET/HEAD `/up`, `/healthz` and
`/runtime/ready` for the inherited Docker healthcheck and returns generic 503 for
all other requests, including CONNECT/upgrade attempts. It never logs request
URLs or forwards requests. Keep it healthy on the private network before cutover;
activate only the private rollback router when needed.

The private router's explicit Traefik rule is:

```text
Host(`youtube.observe.tw`) && (Path(`/auth`) || PathPrefix(`/auth/`) || Path(`/feeds/u`) || PathPrefix(`/feeds/u/`) || Path(`/api/ops/editorial`) || PathPrefix(`/api/ops/editorial/`))
```

Give that router an explicitly recorded priority above the Laravel public
catch-all, with the existing exact deployment webhook router still retained.
Use the same TLS entrypoint/certificate path. Before acceptance, rehearse the rule
on the isolated candidate topology and confirm every sensitive namespace returns
503 while ordinary Laravel public pages remain reachable. Three focused native
Node HTTP tests cover private root/subpaths across eight methods, headers/no URL
echo, exact health probes and CONNECT/WebSocket rejection; production service and
route rehearsal remain execution evidence to collect.

Start the ten-minute production account acceptance clock only after route
verification. The human then verifies the exact production Google 302/callback,
login identity, follow/save/private-feed lifecycle, intended admin identity and
logout/reload. Basic mobile preview login was already accepted and need not be
repeated. Keep token URLs, cookies and credentials out of screenshots/logs/reviews.

Immediately restore public Laravel routing for wrong callback origin, privilege
exposure, private caching, unexpected source mutations or repeated report 5xx.
If account acceptance does not complete within the recorded window, restore the
public route and activate private maintenance guards; preserve TS account/reader
state and all audit records. Confirm Laravel public GETs and the retained webhook
router without sending a webhook POST. Do not restore the database, drop accounts,
down-migrate columns or alter background ownership as a frontend routing rollback.

## Review outcome

Fixed here: production env template omitted the mandatory isolated-schema mode
and own-state URLs. Remaining execution evidence: production schema/source/grants,
new image/network/resources, canary/current-data parity/capacity, exact ingress
cache/redaction and rollback guards, and the ten-minute human account acceptance.
These are technical acceptance steps under existing authorization, not new
permission requests or worker-handoff requirements.
