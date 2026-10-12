# Public API documentation release — 2026-10-13 Taipei

Released application commit `a53bdd213d1dbf4d51fba6c44e87d13d7e3a911e` via Dokploy; image `sha256:4df04a07b8207c64f206431257f0841db168ba2af334c9a43051d46f7bf97dee`.

- https://youtube.observe.tw/api/ redirects to canonical `/api`: generated documentation, mobile TableScroller, light/dark.
- https://youtube.observe.tw/api/v1/openapi.json: OpenAPI 3.1, 115 public GET endpoints, public s-maxage=3600.
- https://youtube.observe.tw/api/status: HTML for browsers; `Accept: application/json` returns availability only, no-store; HEAD works; content negotiation respects q=0.
- Anonymous origin quota60/IP/min, visible rate headers, credentialed responses private/no-store. Personal key issuance and cursor pagination remain pending; this release documents current offset pagination and timezone offsets honestly.

Validation: API549 passed/336 database-dependent skipped; web181 passed; typechecks and production build passed. Read-only production canary passed (47s readiness); all17 sitemap children GET/HEAD200, nonempty with lastmod. Public regression17 children: static21, channels3474, videos1–13 each50000, videos14 23843, tags108: 677446 URLs at the observation time. Counts can grow with Laravel ingestion.

Public GET examples returned200: `/api/v1/channels?limit=2`, `/api/v1/videos?limit=2`, `/api/v1/live/current?limit=2`. OpenAPI external quota60 verified; invalid-key response private/no-store; `/my` and opt-out remain private.

2026-10-12 17:12 UTC headless390px browser acceptance (T3 preview_open explicitly unavailable): `/api` and `/api/status`, both themes, document width390, canonical correct, no app JavaScript errors. Cloudflare's externally injected Insights beacon was blocked by existing strict CSP; this release does not weaken CSP to allow it or change Cloudflare settings. Earlier isolated interactive tests verified sticky header/lead column, 88px collapsed lead maximum and single-line cells. Frontend implementation by confirmed Claude Opus5.5; independent Codex review adopted Accept quality negotiation and correct UUID event documentation.

Image-only deployment; runtime env, routes, database schemas and writer ownership unchanged. Laravel scheduler remained running. Rollback: change both TS compose service image fields back to `sha256:08292fb0cd1a898b2a65f7db8826a6c0c0d52d402a4a08a4e13d7f7fb188437b` via Dokploy and deploy, preserving all other fields.

Review/runtime receipts reside in ignored `platform/.local/`. No secrets included. Sitemap HTTP validation does not establish Search Console acceptance. GA Realtime receipt remains a separate Google-console check.
