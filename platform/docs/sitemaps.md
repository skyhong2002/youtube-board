# Public sitemap inventory

The Fastify gateway serves `GET` and `HEAD` at `/sitemap.xml` and
`/sitemaps/{kind}/{page}.xml` through `api/src/seo/sitemaps.ts`. Register it before
the frontend wildcard proxy. The frontend's older static sitemap is superseded
at the public gateway.

```ts
registerSitemaps(app, reader, {
  staticLastModified: '2026-10-12T14:00:00.000Z', // Actual source-content release
  now: () => +clock(),
});
```

`staticLastModified` is an explicit release manifest value. Do not replace it
with startup/request/build time. Without a valid, nonfuture configured value,
static entries are omitted. Every URL entry has a truthful `lastmod`; sitemap
index pointers omit the optional modification date because no reliable child
inventory modification timestamp is stored.

## Selection and bounds

All locations use the fixed official `https://youtube.observe.tw` origin and
canonical paths, with no query strings or trailing slashes except `/`.

| Kind | Partition/read | Eligibility and modification source |
| --- | --- | --- |
| static | Fixed public route inventory, page `1` | Explicit content release timestamp; absent editorial/vocabulary schema removes those landing pages |
| channels | Positive decimal page, 50,000 integer `u_id` values | `flag_del IS NULL OR flag_del<1`; latest valid `mtime`/`ctime` in Taipei |
| videos | Positive decimal page, 50,000 integer `pk` values | Latest byte-exact `videoId`, valid 11-character YouTube ID, no known `Private video`/`Deleted video` tombstone (filtered in SQL without selecting title); valid `mtime`/`ctime` in Taipei, never scheduling `stime` |
| tags | Positive decimal page, 50,000 integer `tag_id` values | Existing, nondeleted channel taxonomy row; valid `mtime`/`ctime` in Taipei; canonical `/tags/{id}/channels` |
| keywords | Lowercase hexadecimal bucket `00` through `ff` | Current published upstream term identity and original label; publication timestamp from vocabulary run |
| events | Lowercase hexadecimal UUID bucket `00` through `ff` | Existing, unmerged canonical UUID; valid editorial update/creation time in UTC |

Index discovery uses three indexed `MAX(PK)` endpoint lookups. Numeric children
use primary-key ranges and `LIMIT 50001`, without OFFSET. Full separately stored
vocabulary uses the `(run_id,term_key)` index. Editorial buckets use the
`(merged_into,id)` index. A million uniformly distributed SHA-256 identities
average approximately 3,906 per bucket; every bucket still enforces the hard
50,000-row cap rather than assuming hash distribution.

The current published observation-window pool is also supported when terms are
embedded in the immutable snapshot. First, metadata reads only
`OCTET_LENGTH(snapshot)` and publication time. Snapshots above the existing
8,000,000-byte publication limit fail closed before JSON parsing. A second
bounded metadata query checks the shape and 50,000-term cap. Child reads use the
run primary key plus `JSON_TABLE` with a term-key prefix range and a row cap.
This is a bounded scan of one snapshot, not an indexed scan of embedded terms;
it never loads the full payload into the API. It does **not** turn a windowed
observation into a complete canonical vocabulary. Original labels and evidence
identities remain unchanged. Keyword `lastmod` describes publication of tag
metadata, not the freshness of associated YouTube video measurements.

Missing optional vocabulary/editorial tables omit their inventories. Only the
specific missing-table error is treated as absence. Temporary transport,
permission or deadline failures return 503; SQL defects/schema drift return
500. Oversized inventories return 503, with no silent truncation or partial XML.
The XML cap is 8 MiB and 50,000 entries. Labels are encoded lazily, stopping at
the byte cap. URL components and XML content are escaped. Invalid controls,
unpaired surrogates, dot-only terms, slash/backslash terms and double-encoded
percent sequences that the gateway rejects are omitted.

## Cache and transport

Successful anonymous responses use `application/xml; charset=utf-8` and
`public, max-age=0, s-maxage=3600`. Cookie, Authorization, X-Api-Key and RSC
requests, and responses with Set-Cookie, are private/no-store with appropriate
Vary. Unexpected query parameters, invalid pages and failures are not shared.
Host/request credentials never determine inventory contents or source access.

Each gateway instance retains at most 600 immutable XML documents / 32 MiB, with
one-hour expiry and LRU eviction; the key cap retains all 512 small/empty hash buckets, while the independent byte cap limits large pages; child expiry never extends beyond the metadata
snapshot's expiry. Four distinct cache misses may be in flight, with duplicate
requests coalesced. Metadata has one shared in-flight load. Errors are never
cached. There is no unbounded pending queue.

## Verification and limits

`api/test/sitemaps.test.ts` covers SQL bounds, dates, escaping, optional schemas,
embedded/full pool modes, count/byte limits, cache expiry/admission/eviction,
GET/HEAD and private/shared response policy with mock readers.

`api/test/sitemaps-database.test.ts` runs only under the existing guarded local
`TEST_DATABASE_URL`. It creates randomly named tables from the actual checked-in
legacy, vocabulary and editorial DDL, verifies all inventory SQL and usable
indexes, then drops those isolated tables. It neither seeds nor edits the shared
preview/production tables.

The legacy schema does not store YouTube `privacyStatus`: known tombstone titles
can be excluded, but historical records cannot prove a video's current upstream
visibility. Sitemap selection does not make network requests to YouTube and
does not render every detail report. Temporary report failures are not treated
as deletion. Editorial detail capacity checks remain the report's responsibility.
Empty ID ranges/hash buckets are valid empty XML urlsets. Per-page duplicate
labels are deduplicated; distinct upstream identities with the same label in
different buckets can legitimately repeat a public URL across sitemaps.
