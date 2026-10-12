# Cloudflare public API cache handoff

The generated `cloudflare-api-cache-allowlist.json` is the conservative **exact-path** allowlist for this rollout. Its source is the same API catalog and TTL function as OpenAPI. Generate/check using `node --import tsx tools/gen-api-cache-allowlist.ts [--check]`.

Match only host `youtube.observe.tw`, method GET, empty query string, and an exact path from `exactPaths`. Exclude requests with **any presence**, even empty values, of Cookie, Authorization, X-Api-Key, X-Service-Token or RSC. In Cloudflare expressions use header-name presence checks (`not any(http.request.headers.names[*] eq "x-service-token")`, and equivalent checks for the other names), rather than checking only a nonempty header value. Compare `http.request.uri.path` using an exact set; do not use `/api/*` or `/api/v1/*` prefix wildcards.

Respect origin Cache-Control; do not force edge TTL. Anonymous successful JSON uses per-route s-maxage (30/60/300/3600 seconds); credentials, partial replies, Set-Cookie and Flight are private/no-store; errors are no-store. Keep `/api/status`, `/api/v1/status`, `/api/`, HTML, auth, reader, operators and private RSS outside this API rule. The website document `/api` has its separate public HTML policy.

`parameterizedExcluded` lists otherwise public parameterized templates, **not active cache permissions**. They remain outside the initial edge allowlist to avoid permissive wildcards; future parameter-aware rules need their own exact matching review. Query-dependent responses remain outside this initial rule. No Cloudflare rule is created by this document or generator.

Service tokens are not authenticated nor granted a higher quota by this YouTube release. Presence only tightens caching; anonymous60/IP/min still applies. Never send a real token during acceptance: a dummy nonsecret value suffices to test cache exclusion. Tests also cover empty values, HEAD, OPTIONS, and 400/404/429/500/503.
