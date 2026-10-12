# Live keyword and group comparisons

`/keywords/:keyword/live/trends` and `/groups/:name/live` use separate source policies in `live-comparison.ts`. Other live-extra routes keep their existing readers; the unchanged cache-shape helpers remain re-exported for compatibility.

| Contract | Keyword | Group |
| --- | --- | --- |
| Category definitions | `LegacyLiveGroupDefinitions` | Exact embedded `LegacyKeywordGroupDefinitions` fallback |
| Category selector | `group` precedes `view` | `view` |
| Default window | Taipei today plus preceding 10 days (11 dates) | Latest cache date among exact selected categories, 30 dates |
| Video metric | `tags_video`, `videos`, `count_videos` | `tags_video` only; legacy `videos` / `count_videos` retain views |
| Unknown normalized category | media | position |
| File-based extra classification | Not used | Unavailable, explicitly disclosed for every group; `all=1` does not invent additional intersections |

Both preserve seven-day sums of each term's daily hourly maximum, exact category intersections and separate observed-day counts. A valid observed empty map or absent term is zero; missing/malformed/pending input is unknown. Unsafe integer sums are null and separately counted. A cache source is not a maintained current vocabulary match; historical coverage remains explicit.

Group term presets retain the reviewed `LegacyGroupViewConfig` term sets already shared by other rewritten group pages; coverage names this source. They do **not** claim to be the unavailable `GroupLiveReport` file-parsed term lists. Unknown `tags_*` presets remain missing instead of querying an unrelated table group. Dynamic `tag_group` names retain DB collation, while terms keep exact stored whitespace and byte-distinct identity; raw >200-term results are rejected before any deduplication. URL segments arrive already decoded at the web boundary and are never decoded again here.

Read limits: 200 terms, 20 categories, 50,000 category/term/date cells; latest PK for each category/day; max126 source days with six-day lookback; 1MiB per body and 16MiB total. Metadata reads measure bytes only. Newest approved dates receive the shared body budget before raw-byte checksums are computed. At most four categories read concurrently. Fetches require the same PK, mtime, byte length and checksum; publication lineage is checked again after bodies. Changed, malformed, oversized, budget-excluded and withheld days have separate coverage. This is a bounded observation, not an atomic transaction over MyISAM history.

Intentional corrected input behavior: invalid/reversed/excessive dates and malformed/duplicate scalars are rejected; explicit `to` anchors the relative start consistently. Missing observations are not changed to zero to match old PHP casting. Unsupported custom file-driven classifications remain a migration limitation, not claimed parity.

Verification uses isolated MariaDB with latest-PK duplicates, pending sidecars, observed empty maps, malformed term hours, actual oversized and 17MiB budget fixtures, same-size/same-mtime mutation, post-read publication changes, metric aliases, exact whitespace and integer-overflow cases. Native mobile390 verification confirmed canonical alias/form values, 11-date default and no document overflow. A discovered shared soft-navigation defaultValue issue was fixed in the shared web form by the UI owner and reverified: URL, heading and category selector now agree after tab navigation.
