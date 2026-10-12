# Public SEO release — 2026-10-12

This release adds absolute canonical URLs to the existing public frontend, including filtered variants pointing to their query-free page. Private/account/search/opt-out surfaces remain noindex. Public data stays server-rendered with the existing ISR/hash CSP contract.

Frontend implementation: Claude Opus 5.5. Codex integration and independent review. The release deliberately preserves the currently published vocabulary matching rules and original Laravel writer ownership; pending keyword quality, API keys and UTC API serialization are separate work.

The gateway now serves a sitemap index and bounded static/channel/video/tag/keyword/event children. Every URL entry has a source-derived `lastmod`; index entries do not invent modification times. See [sitemap details](sitemaps.md). Crawler diagnostics record canonical route shapes, response status/bytes, bounded UA product/version labels and validated Cloudflare ray IDs, never queries, cookies, auth headers or raw user-agent strings.

Structured data is escaped JSON-LD and never a script trust root. Hash CSP, SRI, HSTS and private response protections remain. GA4 code is present but **disabled in this build**; the measurement ID is absent from generated client JS. Enabling analytics requires a subsequent browser transport check proving safe automatic page-view fields. No manual `page_view` is sent. A verified one-time server callback receipt is still needed for the login event.

Local validation: 163 frontend tests; 122 focused backend tests including three real MariaDB sitemap tests; full production Next build and all-workspace typecheck. Production read-only EXPLAIN confirms the populated video PK range uses PRIMARY range access and the newest-video subquery uses `eq_ref` on `videoId` (one estimated row). No index or grant change was needed.

Opus review findings adopted: gate GA transport domains while analytics is disabled; move tombstone filtering into SQL and omit title payloads; retain tiny sitemap buckets within a 600-key/32 MiB cache; validate the actual isolated release tree. Default script trust remains unchanged. Production canary and deployment evidence are recorded after completion.

Rollback is an image-only Dokploy deployment back to `sha256:0c09c91d201bf59e02c113ab237f94aa37dc817ef44c3dceca8df6dfdd0c5186` for web and account-maintenance. This release does not change environment, routing, database/schema/grants, Cloudflare rules or writer ownership, so rollback requires no database restoration.
