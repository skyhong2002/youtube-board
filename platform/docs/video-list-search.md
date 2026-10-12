# Full-history video pages and optional totals

Video collections (`/videos`, channel videos, taxonomy videos and keyword videos)
now return `total: number | null`, `totalStatus: 'exact' | 'not-computed' |
'unavailable'`, and `hasNext: boolean`. Other report collections retain their
existing exact-total contract. `meta.coverage.totalStatus` mirrors the video
collection's status.

A nonempty text search deliberately returns `total:null` and
`totalStatus:'not-computed'`. Exact title-or-description substring counts require
reading the entire source text table; the production scan exceeded the existing
five-second SQL limit. Pages still search the full source history with the exact
same escaped LIKE predicates, collation, filters and ordering. There is no
implicit date restriction and no invented total or lower bound. The UI displays
an uncounted total and uses `hasNext` plus the existing offset for previous/next
navigation. This is an intentional modern video-list parity difference; the
legacy compatibility API contracts are unchanged.

Without text search the API continues computing exact totals. Only a temporary
`DataSourceUnavailable` from that separate count may return a usable page with
`total:null,totalStatus:'unavailable'`. Invalid SQL/schema/programmer errors
propagate normally. A failed page query is always an error, never successful
empty data. Keyword evidence counts remain separately reported; they must not
be presented as a measured keyword total when `keywordMatchedVideos` is null.

## Exact page selection

The first query selects up to `offset + limit + 1` matching scalar sort values
using the existing single-column index and descending metric order. It records
the minimum selected metric and whether NULL values occur. The payload query
retains all matching rows at or above that metric boundary, including every
boundary tie, and then applies the original metric DESC / primary-key DESC
ordering with offset and limit+1. Selecting only the first arbitrary tied keys
would be incorrect; expanding the tie boundary preserves the original page.
NULL metrics sort last and are included explicitly when the boundary reaches
that tail. The extra row determines `hasNext`; it is not displayed. No matching
rows, or a boundary count at/below offset, avoids a second payload query.

Both queries use all original filters. Source writers can update between
statements, so the payload query rechecks text, taxonomy and vocabulary evidence;
a short page can result. This is not a cross-statement snapshot guarantee.

Existing indexes are used without schema or index changes. The SQL deadline
remains five seconds. Rare/no-match terms, deep offsets, or large equal/NULL
metric groups may still need a broad scan and hit that deadline. Such failures
remain visible; narrowing the explicit channel/date selection can reduce work.
The API does not silently narrow the requested search.

## Verification

Real MariaDB tests compare the original ordering against 1,010 fixtures, all four
sort metrics, NULL tails and large tie groups, 1,000-row pages, default limit50,
zero matches, offset100000, title/description matches, literal wildcard escaping,
case-distinct video IDs, taxonomy/channel/date/minimum filters, and source changes
between selection and payload reads. Separate tests distinguish count-only
availability failure from page and schema failure.

On the immutable 670,997-video MariaDB11.4.13 restore, complete DTO rows and
`hasNext` matched the original SQL for text search, taxonomy102 and unfiltered
lists at limits25/50/1000. Text `台灣` took7–55ms in the recorded sequential pass
and5–10ms for four concurrent default-page requests; taxonomy retained its exact
377,535total and generic lists their670,997total. These clone measurements do not
replace production acceptance. The recorded rare-term probe still reached the
five-second deadline and correctly returned an availability error.
