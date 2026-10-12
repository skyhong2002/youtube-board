# Public HTML caching and CSP

The public render contract separates anonymous report HTML from account state.
Canonical home, event and report pages use Next ISR (60 seconds; live data lowers
the effective lifetime to 30 seconds). Successful public DTO reads are cached;
transient failures throw so they cannot replace a valid ISR entry with an outage.
Filtered requests use bounded data caching but their HTML remains private.
Login, reader state, follows and saved items load through private client requests.

The gateway buffers each complete HTML representation and binds it to an enforced
hash CSP. It hashes only approved theme/Next Flight/React streaming script forms;
unknown inline code fails closed. External scripts and script preloads receive
SRI derived from immutable release files. This is a validator for this pinned Next
renderer, not a sanitizer for arbitrary HTML. Next upgrades require repeating the
runtime and browser acceptance checks. Direct access to Next stays loopback-only.

The policy retains strict-dynamic, script-src-attr none, object-src none,
base-uri and frame-ancestors restrictions. HSTS remains at the ingress. The prior
style policy is unchanged; no script unsafe-inline or unsafe-eval is added.
HTML buffering has byte, time and concurrency limits, with bounded queuing and
503/Retry-After during saturation. Readiness verifies transformed HTML and CSP.

Only a canonical anonymous GET with a trusted matching renderer marker, status
200, explicit upstream shared TTL and no Set-Cookie may get public cache headers.
Query, Cookie, Authorization, RSC and Next navigation variants remain private,
as do /my, /manage, /auth and private feeds. Vary preserves representation axes.
An expired Next STALE response is not promoted into a fresh edge cache entry.
Conditional HTML requests receive a complete entity, keeping body and CSP atomic.

Public and private HTML carry no-transform. This preserves hash-bound bytes and
suppresses automatic Cloudflare Web Analytics injection; do not whitelist a
mutable analytics script hash. Gzip is performed at the origin. The existing
Cloudflare anonymous-homepage rule must respect these origin headers and exclude
queries, credentials and RSC. No additional rule or forced TTL is required.

## Validation before deployment (2026-10-12)

- Frontend implemented by Claude Opus 5.5; actual response model verified.
- Independent Codex boundary and relative-rewrite reviews completed; Opus security
  review completed without truncation. Marker mapping, upstream TTL/private
  handling, canonical paths, queue saturation and preload SRI findings fixed.
- New mandatory Trusted Types was deferred: compatibility with the pinned Next
  renderer is not established, and the existing nonce policy already used
  strict-dynamic. This release preserves that protection with verified hashes.
- Final suite, including the API rerun: 853 passed, 492 DB-dependent/skipped tests.
  The initial full run found one old image-path test expecting 400 for an encoded
  route-family alias; it now explicitly expects the gateway's earlier 404 rejection
  and still asserts zero optimizer forwarding. All 432 API tests passed on rerun.
  No DB behavior changed. Frontend: 140 passed; gateway/CSP/slot tests: 66 passed;
  all workspace typechecks and production Next build passed.
- Actual standalone build: home MISS then HIT; events/channels/live 200;
  channels?limit=5 returned exactly five rows and private/no-store; /my private;
  internal render targets and encoded route-family aliases 404.
- Chromium report-only then enforced CSP: home hydration, theme switching,
  client navigation to events and filtered channel results passed without CSP
  violations. Mobile 390px light/dark captures had no document overflow.
  Safari/Firefox were not independently tested. Historical console 404 entries
  from the superseded rewrite were retained in private evidence, not counted as
  final failures; final captures show no new script-policy errors.

## Deployment and rollback

Build the committed tree with the resource-limited production builder. Execute
the bounded read-only canary against the immutable image ID before requesting an
image-only Dokploy update. Preserve environment, routes, grants and all background
workflow owners. No database/schema changes or new backups are needed here.
Rollback is a Dokploy compose image-only restore to the recorded previous image;
no data restore is involved.

After deployment record actual CF MISS/HIT, Age, TTFB and matching inline/SRI
hashes. Verify no injected beacon, private variants not HIT, /auth/me and /my
private/no-store, HSTS, normal client navigation, sister sites 200 and unchanged
Laravel scheduler. Local ISR HIT alone is not evidence of Cloudflare HIT.

## Production acceptance (2026-10-12 11:02–11:07 UTC)

Runtime commit `ed562f7` is deployed as immutable image
`sha256:16e4919992cafd66706ed9cfee050cdb222fa9f6af8d132b2701cf763266316d`.
Commit `38c153e` only adjusts the regression test and this validation record;
the tested runtime code is identical. Dokploy reports the rollout completed and
the web container is healthy. Environment, routing, database grants/schema and
background ownership were unchanged. Laravel's existing scheduler stayed running.

- Read-only production canary: **29/29 passed**, 42 bounded requests, 13 actual
  script assets verified; temporary containers removed. The initial test's
  assumption that a synthetic `_rsc` value returns 200 was corrected to require
  Next's exact 307 canonicalization followed by uncached 200 Flight.
- Cloudflare: actual **BYPASS → MISS → HIT** captured without changing its rule.
  MISS TTFB 0.170s, subsequent HIT 0.131s; another sequence showed HIT with
  Age 22 → 25 → 28. Before deployment three samples were BYPASS, 0.437–0.673s.
  These are small operational samples, not a load benchmark. Expired Next ISR
  entries deliberately bypass edge caching while regeneration completes.
- Public HTML has `s-maxage=60, stale-while-revalidate=60, no-transform`, enforced
  strict hash CSP and HSTS `max-age=31536000`. All delivered inline hashes and
  13 actual external asset hashes matched; no analytics beacon was injected.
  Eight unchanged content-addressed JS files retained older immutable edge cache
  headers; their bytes still matched SRI/CSP. New origin assets add no-transform.
- Cookie, Authorization, query, RSC, `/my`, `/auth/me` and management variants
  returned private/no-store and Cloudflare DYNAMIC. `/manage`'s exact redirect
  to `/manage/editorial` and Next's RSC redirect also remained uncached.
- Google start: 302 to Google, PKCE S256, exact production callback, no-store.
  No human OAuth completion was attempted by the agent during this release.
- Production Chromium: homepage hydration and client navigation to channels
  succeeded; all external scripts had SRI, console/CSP violations were empty;
  390px dark capture had no document overflow. Tag and blog both returned 200.

Previous image for image-only rollback:
`sha256:7cbabf33b8c686714eab533c8ff2f87ef040d62095d73703a07ee0562e10f5e2`.
The guarded rollback helper and pre-update compose copy are retained privately
with deployment evidence. An edge may retain the new anonymous homepage during
its 60+60-second lifetime after rollback; preserve release assets or purge only
that URL when an immediate cache rollback is required. Future releases must
account for cached HTML referencing the previous release's immutable assets.
