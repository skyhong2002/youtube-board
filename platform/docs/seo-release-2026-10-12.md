# Public SEO release — 2026-10-12

This release adds absolute canonical URLs to the existing public frontend, including filtered variants pointing to their query-free page. Private/account/search/opt-out surfaces remain noindex. Public data stays server-rendered with the existing ISR/hash CSP contract.

Frontend implementation: Claude Opus 5.5. Codex integration and independent review. The release deliberately preserves the currently published vocabulary matching rules and original Laravel writer ownership; pending keyword quality, API keys and UTC API serialization are separate work.

The gateway now serves a sitemap index and bounded static/channel/video/tag/keyword/event children. Every URL entry has a source-derived `lastmod`; index entries do not invent modification times. See [sitemap details](sitemaps.md). Crawler diagnostics record canonical route shapes, response status/bytes, bounded UA product/version labels and validated Cloudflare ray IDs, never queries, cookies, auth headers or raw user-agent strings.

Structured data is escaped JSON-LD and never a script trust root. Hash CSP, SRI, HSTS and private response protections remain. GA4 code is present but **disabled in this build**; the measurement ID is absent from generated client JS. Enabling analytics requires a subsequent browser transport check proving safe automatic page-view fields. No manual `page_view` is sent. A verified one-time server callback receipt is still needed for the login event.

Local validation: 163 frontend tests; 122 focused backend tests including three real MariaDB sitemap tests; full production Next build and all-workspace typecheck. Production read-only EXPLAIN confirms the populated video PK range uses PRIMARY range access and the newest-video subquery uses `eq_ref` on `videoId` (one estimated row). No index or grant change was needed.

Opus review findings adopted: gate GA transport domains while analytics is disabled; move tombstone filtering into SQL and omit title payloads; retain tiny sitemap buckets within a 600-key/32 MiB cache; validate the actual isolated release tree. Default script trust remains unchanged. Production canary and deployment evidence follow.

Rollback is an image-only Dokploy deployment back to `sha256:0c09c91d201bf59e02c113ab237f94aa37dc817ef44c3dceca8df6dfdd0c5186` for web and account-maintenance. This release does not change environment, routing, database/schema/grants, Cloudflare rules or writer ownership, so rollback requires no database restoration.

## Production verification

Commit `27bba6f` was deployed through Dokploy on 2026-10-12 at approximately 14:42 UTC, pinned to image `sha256:82378eb881e3005ff7f361a0ce6b0a529aceab502bc03220a68f75e8d11edd17`. The running Swarm task confirmed that image; the original Laravel scheduler remained running (33 hours). Both tag.observe.tw and blog.observe.tw returned 200.

At 14:46 UTC, public HTTP checks verified one query-free absolute canonical and hash CSP on all 14 sampled pages: `/`, `/channels`, `/videos`, `/keywords`, `/events`, `/tags`, `/groups`, `/live/current`, `/ai/days`, `/about`, `/channels/3889`, `/videos/oeW65cNxtaA`, `/tags/108/channels`, and `/keywords/藥事法/videos` (percent-encoded on the wire). Filtering `/channels?column=view_week` retained the `/channels` canonical and noindex. `/my`, `/observe/opt-out`, and video search retained private/no-store and noindex. A deliberately absent video returned a real 404.

The index `https://youtube.observe.tw/sitemap.xml` returned 200 for GET and HEAD, `application/xml; charset=utf-8`, and `public, max-age=0, s-maxage=3600`. It advertised 1,745 bounded child buckets. Sample children (counts are this observation, not permanent totals):

| Child sitemap | URL entries |
| --- | ---: |
| `/sitemaps/static/1.xml` | 21 |
| `/sitemaps/channels/1.xml` | 3,474 |
| `/sitemaps/videos/1230.xml` | 14,359 |
| `/sitemaps/tags/1.xml` | 108 |
| `/sitemaps/keywords/00.xml` | 61 |
| `/sitemaps/events/00.xml` | 0 |

Every sampled URL entry had lastmod; empty historical PK/hash buckets are valid and contain no invented URLs. Sample channel/video/tag/keyword URLs returned 200. Sitemap responses were Cloudflare DYNAMIC, with origin shared-cache headers ready; no Cloudflare rules changed. Homepage requests returned HIT with Age 30/32/33 and total response times 219/214/216 ms. ISR STALE responses retained public one-second shared TTL and matching hash CSP. Browser inspection at 390px confirmed the canonical and no page-wide horizontal overflow. Crawler log entries for the synthetic Google-InspectionTool checks were observed on the running container, with bounded route shapes and no query strings.

Known separate issue: the first arbitrary keyword sample (`建議`) briefly returned a sanitized 503; retry was 200. Another uncached all-history keyword API reached its existing five-second query deadline. This is a pre-existing keyword selection/coverage cost issue, tracked for a focused backend fix; the passing canonical round does not prove every keyword query meets the latency target. No GA events are claimed as live: analytics remains disabled pending real gtag history privacy verification.
