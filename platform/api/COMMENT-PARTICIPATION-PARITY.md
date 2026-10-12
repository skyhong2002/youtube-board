# Comment participation reports

Channel and category reports use distinct source selection, following their respective Laravel services:

- Channel: recent videos meeting hours/min, sorted cumulative views. Select videos before evaluating comment completion; report missing and pending batches in diagnostics. Default source1000. Category filters on channel URLs are ignored, matching Laravel.
- Category: latest complete archived comment batches by ctime/PK, filtered by the batch channel’s taxonomy membership. As in Laravel TagCommentsReport, hours/min are compatibility parameters, not filters in this mode. Default source25. A retained archive without a current video remains visible without a fabricated video link.
- Explicit `sourceLimit`1–1000 controls source sampling; author pagination limit1–200/offset is independent. This deliberately separates the legacy overloaded limit parameter. Truncation is disclosed, not represented as full-database participation.
- Count distinct exact author/video pairs; duplicate aliases in one batch count once. Exact byte-case IDs remain separate; non-string IDs, anonymous list entries and explicit empty author IDs do not become numeric/key identities.
- Detail rows distinguish YouTube comment totals from archived comments, threads, replies, likes, recorded author count, decoded distinct authors, latest-comment timestamp and archive observation timestamp. Missing/pending values remain null. Malformed author metadata does not erase known archived counts.
- SELECT-only, metadata before JSON,16MiB total/2MiB per author map,100000entry budget. Capacity422. Publication/size/timestamp changes between phases withhold payloads and increment changedSources. A same-size replacement with unchanged timestamps can still be read; this is not a transaction snapshot across MyISAM tables.
- Pending comment payload never enters ranking. Pending/missing source freshness is not manufactured. Author/image URLs from stored metadata are not rendered; links use the local author report.

Validation: two offline semantic/capacity tests and six isolated MariaDB cases plus existing database suite35/35; API typecheck. Native browser390px verified complete/pending labels, source controls and independently horizontally scrolling detail table, no page overflow. Actual CLI Proxy Opus review/disposition recorded under `.local/reviews/comment-participation*`.

Category archive metadata joins the newest byte-exact video PK, preventing source-limit/byte-budget duplication even for imported legacy duplicate-video tables. The normal schema keeps UNIQUE(videoId); a connection-private compatibility table tests the duplicate case without altering that schema.
