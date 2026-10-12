# Cloudflare public API cache handoff

The generated `cloudflare-api-cache-allowlist.json` is the conservative **exact-path** allowlist for this rollout. Its source is the same API catalog and TTL function as OpenAPI. Generate/check using `node --import tsx tools/gen-api-cache-allowlist.ts [--check]`.

Match only host `youtube.observe.tw`, method GET, empty query string, and an exact path from `exactPaths`. Exclude requests with **any presence**, even empty values, of Cookie, Authorization, X-Api-Key, X-Service-Token or RSC. In Cloudflare expressions use header-name presence checks (`not any(http.request.headers.names[*] eq "x-service-token")`, and equivalent checks for the other names), rather than checking only a nonempty header value. Compare `http.request.uri.path` using an exact set; do not use `/api/*` or `/api/v1/*` prefix wildcards.

Respect origin Cache-Control; do not force edge TTL. Anonymous successful JSON uses per-route s-maxage (30/60/300/3600 seconds); credentials, partial replies, Set-Cookie and Flight are private/no-store; errors are no-store. Keep `/api/status`, `/api/v1/status`, `/api/`, HTML, auth, reader, operators and private RSS outside this API rule. The website document `/api` has its separate public HTML policy.

`parameterizedExcluded` lists otherwise public parameterized templates, **not active cache permissions**. They remain outside the initial edge allowlist to avoid permissive wildcards; future parameter-aware rules need their own exact matching review. Query-dependent responses remain outside this initial rule. No Cloudflare rule is created by this document or generator.

Service tokens are not authenticated nor granted a higher quota by this YouTube release. Presence only tightens caching; anonymous60/IP/min still applies. Never send a real token during acceptance: a dummy nonsecret value suffices to test cache exclusion. Tests also cover empty values, HEAD, OPTIONS, and 400/404/429/500/503.

## Production verification — 2026-10-13 Taipei

Commit `f511f7a`, image `sha256:2a537598c86fbe3c351cab4b9b64e17eca911a0d401872e1becd36a5427c0c6c`. Only two backend files layered over the verified image release; frontend bytes, runtime env, schemas and writer ownership unchanged.

Actual curl GET to `https://youtube.observe.tw/api/v1/channels?limit=1`:

| Request | HTTP | Cache-Control |
| --- | --- | --- |
| Anonymous | 200 | public, max-age=0, s-maxage=60, stale-while-revalidate=120 |
| Cookie | 200 | private, no-store |
| Authorization | 200 | private, no-store |
| X-Api-Key | 200 | private, no-store |
| X-Service-Token | 200 | private, no-store |
| RSC | 200 | private, no-store |
| Empty X-Service-Token | 200 | private, no-store |

Vary includes X-Api-Key, X-Service-Token, Authorization, Cookie, Accept and RSC. All probes used dummy nonsecret values. Cloudflare returned DYNAMIC: this is origin-policy verification, not a claim that the future API edge rule is already deployed. Command shape: `curl -sS -D - -o /dev/null -H 'X-Service-Token: cache-probe-not-a-secret' 'https://youtube.observe.tw/api/v1/channels?limit=1'` (omit the header for anonymous; use `-H 'X-Service-Token;'` for empty presence).

Twelve focused tests and API typecheck passed; independent Codex review found no blockers. Read-only canary tested the same header matrix, preflight, a real400 and an actual429/no-store by exhausting **only the disposable canary** metadata quota. Unit tests also cover other4xx/5xx. All17 sitemap children and OpenAPI/status/media regression passed in the canary. No intentional outage or quota exhaustion was performed against production.

Rollback uses the preceding image `sha256:5160b4c7261afdf3ecdf31e02825d84dc8806dc5b643b320b95e28fe1fa763f9`; note that it restores the service-token caching gap, so keep the edge API rule disabled if rollback is necessary. Existing homepage rule is separate and unchanged.
