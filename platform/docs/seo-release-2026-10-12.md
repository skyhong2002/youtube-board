# Public SEO release — 2026-10-12

This release adds absolute canonical URLs to the existing public frontend, including filtered variants pointing to their query-free page. Private/account/search/opt-out surfaces remain noindex. Public data stays server-rendered with the existing ISR/hash CSP contract.

Frontend implementation: Claude Opus 5.5. Codex integration and independent review. The release deliberately preserves the currently published vocabulary matching rules and original Laravel writer ownership; pending keyword quality, API keys and UTC API serialization are separate work.

The initial gateway sitemap implementation served static/channel/video/tag/keyword/event buckets; the corrective release below replaces this inventory. Every URL entry has a source-derived `lastmod`; index entries do not invent modification times. See [sitemap details](sitemaps.md). Crawler diagnostics record canonical route shapes, response status/bytes, bounded UA product/version labels and validated Cloudflare ray IDs, never queries, cookies, auth headers or raw user-agent strings.

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

**Rejected acceptance:** this sampled check missed empty historical PK/hash buckets and absent child inventories. The 1,745-child index did not meet acceptance and must not be treated as a successful sitemap release. GSC still reported Couldn’t fetch; URL Inspection success is separate. Sample channel/video/tag/keyword URLs returned 200. Sitemap responses were Cloudflare DYNAMIC, with origin shared-cache headers ready; no Cloudflare rules changed. Homepage requests returned HIT with Age 30/32/33 and total response times 219/214/216 ms. ISR STALE responses retained public one-second shared TTL and matching hash CSP. Browser inspection at 390px confirmed the canonical and no page-wide horizontal overflow. Crawler log entries for the synthetic Google-InspectionTool checks were observed on the running container, with bounded route shapes and no query strings.

Known separate issue: the first arbitrary keyword sample (`建議`) briefly returned a sanitized 503; retry was 200. Another uncached all-history keyword API reached its existing five-second query deadline. This is a pre-existing keyword selection/coverage cost issue, tracked for a focused backend fix; the passing canonical round does not prove every keyword query meets the latency target. No GA events are claimed as live: analytics remains disabled pending real gtag history privacy verification.

## Corrective release

Replace ID-range/hash buckets with paced keyset reads and chunks of actual URL entries.
Only complete nonempty static/channel/video/tag children are advertised, each with
lastmod and explicit count/byte bounds. Keyword/event detail inventories are omitted
until ready. Startup preparation gates readiness; compressed storage and bounded
reads avoid retaining full plaintext generations. Failure retains the last good
inventory. See [sitemap details](sitemaps.md).

The same backend-only release avoids all-history keyword queries scanning the
video archive: evidence candidates use the indexed term lookup and video primary
identity, while unbounded coverage is explicitly not calculated. Bounded coverage
failures return clear partial metadata without caching a misleading zero.

Independent Codex review accepted the corrected memory/startup/diagnostic controls.
Image-only rollback targets the previous 27bba6f image
`sha256:82378eb881e3005ff7f361a0ce6b0a529aceab502bc03220a68f75e8d11edd17`.
No schema, grants, routes, secrets or workflow ownership change. Full canary and
post-deployment inventory evidence must be recorded before claiming completion.

### Complete production re-verification

Corrective commit `19e97c0` deployed on 2026-10-12 at approximately 15:30 UTC,
image `sha256:ebe572f15104072aaf51f61278012e25a9abec4c1cdcbffdd559b0604785335b`.
At 15:31:45 UTC the public index advertised **17 children**. Every child GET
and HEAD returned 200, was nonempty, had valid URL lastmod, and its index lastmod
matched the maximum child lastmod. GET/HEAD index returned XML with
`public, max-age=0, s-maxage=3600`. Results at that time:

| Child | URLs | Uncompressed bytes | GET / HEAD |
| --- | ---: | ---: | --- |
| `/sitemaps/static/1.xml` | 20 | 2,118 | 200 / 200 |
| `/sitemaps/channels/1.xml` | 3,474 | 363,867 | 200 / 200 |
| `/sitemaps/videos/1.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/2.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/3.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/4.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/5.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/6.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/7.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/8.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/9.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/10.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/11.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/12.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/13.xml` | 50,000 | 5,500,108 | 200 / 200 |
| `/sitemaps/videos/14.xml` | 23,737 | 2,611,178 | 200 / 200 |
| `/sitemaps/tags/1.xml` | 108 | 11,772 | 200 / 200 |

Total: 677,339 URL entries; largest file 5,500,108 bytes, below both
50,000 URLs and 50 MB. Events/keywords detail children are intentionally omitted.
Ten public canonical/hash-CSP pages and private/noindex account/opt-out pages
passed again. GSC processing remains external and unconfirmed; successful
HTTP verification is not a claim that Google has accepted the sitemap.

Read-only canary generated all 17 children in 41.3 seconds, became ready in
53.5 seconds at 0.5 CPU, and peaked at 317,689,856 bytes including bounded
parallel child reads and detail reports. Retained XML was 9,171,579 compressed
bytes. Canary was removed after verified ownership checks. Focused integrated
29 tests plus separately verified 9 real-MariaDB keyword/sitemap tests and
API/runtime typechecks passed. No database writes or writer handoff occurred.
