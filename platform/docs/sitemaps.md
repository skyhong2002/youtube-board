# Public sitemap inventory

The gateway serves GET/HEAD `/sitemap.xml` and `/sitemaps/{kind}/{page}.xml`.
Only a completed, nonempty inventory is published. Static pages, channels, videos,
and channel taxonomy tags are included. Keyword/event detail inventories are
withheld until they can meet the same complete-inventory acceptance criteria.

Rows are read sequentially in keyset batches of at most 5,000, paced by 100 ms,
with an indexed initial upper endpoint. Numeric page names represent actual
emitted URL chunks, never primary-key ranges. No OFFSET is used. Deleted channel
and taxonomy rows and known private/deleted video titles are excluded; duplicate
video IDs use the newest byte-exact record. Invalid IDs/dates are omitted.

Each child has 1–50,000 URLs and at most 8 MiB uncompressed XML (below the sitemap
50 MB limit). Every URL has a valid source-derived lastmod; each index entry has
the maximum lastmod of its child. Static entries use an explicit content release
timestamp, never the request time. All URLs use the canonical production origin.

Generation is bounded by 1,000,000 rows, 120 seconds, 128 MiB total plaintext,
and 32 MiB retained gzip output. Pages are compressed serially; completed
plaintext is not retained. A failed refresh preserves the previous complete
inventory, with a 60-second retry cooldown. Publication is atomic. Orphan child
keys from the prior generation remain available for one index TTL. Runtime
readiness waits for initial preparation, including after a restart.

Children never run SQL. One decompression is active with at most 32 distinct
queued children; concurrent reads of the same child share work. Unknown children
return 404 before queue admission. Capacity or temporary source failure returns
503/no-store; schema/query defects are not silently treated as absent data.
Sanitized generation diagnostics record counts, bytes, timing and reason codes.

Successful anonymous XML returns `application/xml; charset=utf-8` and
`public, max-age=0, s-maxage=3600`. Credentialed/RSC/Set-Cookie responses and
failures are private/no-store; Vary preserves those request distinctions.

Tests cover sparse keys, complete/nonempty publication, counts/bytes/lastmod,
refresh failure, parallel reads, readiness, HEAD and caching. Guarded local
MariaDB tests use isolated tables based on actual legacy DDL. Production canary
and post-deploy acceptance must fetch **every** advertised child and record
status, count, size and lastmod. Sampling is insufficient.

Historical records cannot prove current YouTube visibility; generation makes
no YouTube network calls. Temporary detail report failures are not deletion.
