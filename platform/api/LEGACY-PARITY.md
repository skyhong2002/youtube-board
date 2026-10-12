# Legacy API compatibility ledger

Implemented 2026-10-12 in `src/legacy/`. All 36 original GET paths read MariaDB in TypeScript. They retain their legacy envelopes (including bare maps, plain text, HTML and CSV); they are **not** v1 response aliases or Laravel proxies. No handler invokes ingestion, AI providers or writeback. Unit/isolated MariaDB tests establish local contract behavior, not production-data parity.

| Original `/api/` path | Implemented contract |
| --- | --- |
| `api_live_day.php` | Exact video ID, inclusive single/range date selection, date → raw log map. |
| `api_live_date.php` | Source-log-first per-video period maxima, channel category max/count totals and hourly peaks; imported single-date cache fallback on empty logs; force/range bypasses fallback. |
| `api_live_hour.php` | Date/hour → video peak maps, rejects malformed times/nonfinite values. |
| `api_live_tag_date.php` | Sorted category filter cache selection; views/videos/all/hour/data wrapper decoding and legacy counters. |
| `live_date.php` | Count-table membership and category filters, highest measured log per video, display-cache merge, optional sorting and row limit. |
| `live_tvbs.php` | Latest-date default, raw log rows keyed by exact video ID. |
| `video_live.php` | Original refresh HTML, formatted concurrent/max counts and numeric 24-point sparkline. |
| `csv_live_line.php` | Quoted timestamp CSV, hourly maxima, missing cells empty, original `limit+1` rows, sanitized attachment filename. |
| `tags_list.php` | Channel taxonomy map inside result/meta envelope. |
| `api_tag.php` | Bare channel taxonomy map. |
| `tags_index.php` | Legacy local keyword popularity weight, sort aliases and bounded result count. |
| `tags_all.php` | Stored global keyword metric map, wrapped/list cache decoding, explicit missing-cache guidance. |
| `video_tags.php` | Stored per-video keyword count map, fallback literal title twice plus description counts, overlapping shorter-term subtraction. |
| `video_tags_title.php` | Title-only counterpart, one title occurrence. |
| `channels_list.php` | Channel category AND/OR/NOT membership, original raw rows ordered by views. |
| `channel_videos.php` | Single channel recent videos, view threshold/order/limit, optional completed comments only. |
| `channels_videos.php` | Same raw-video contract within category membership, default 72-hour interval. |
| `api_channel_log.php` | Signed daily deltas, missing observations represented by original zero convention, weekday prediction/interpolation and seven-day moving average; data-quality counters. |
| `channel_pred.php` | Latest four log rows, same prediction algorithm, original 7/29-day summary; no writeback. |
| `api_tag_log.php` | Category-filtered channel-log aggregation, original signed values and per-date counts. No filters selects no channels. Logs are loaded in one batch. |
| `tags_day.php`, `tags_video.php` | Exact category/day-window cloud cache, wrapper/list weights and original counter metadata. |
| `tags_relation_date.php` | Keyword/day co-occurrence and video maps with source counts. |
| `tag_month.php` | Exact keyword/month/filter cache, date metric map decoding. |
| `tag_period.php` | Bounded month interval, source date-map replacement order. |
| `tag_tags_days.php` | Keyword/filter/window cache, original result/videos/time/count fields. |
| `cloud.php` | Channel/window cloud cache and legacy aliases (`uid`, `u_id`). |
| `cloud_tag_date.php` | Category/date cache selector, result/video/view/all variants and original counters. |
| `cloud_tag_date_noapi.php` | Same cache with positive `tags_count` requirement and result metric. |
| `group_view.php` | Original cached envelope; otherwise reviewed static group configurations, DB/explicit term sets, daily group totals and sparse per-term date matrix. Unavailable source retains original membership shell and blocked reason. |
| `ai_day.php` | Daily selection/condition/PK/date semantics, channel map and corresponding source analyses. TS-generated daily rows resolve immutable source snapshots. |
| `api_topic.php` | Cached video/topic payload or force-selected source topic statistics, no cache writes. |
| `api_event.php` | Selected/first daily event, up to 60 previous-day stored event associations and PK chain; original prefetch shells. |
| `api_comment.php` | Exact video ID, completed comment batch only, original result/authors/latest/updated fields. |
| `api_duration.php` | Nonnegative cached duration as plain text, original defaults and source/CORS headers. |
| `api_get_photo.php` | Latest cached LIKE-matched photo URL or literal `null`, plain text. |

## Explicit safety and runtime differences

- SQL schema/programming faults return sanitized **500**; connection/permission/deadline failures return **503**, rather than silently turning every SQL error into a successful empty result. Therefore the legacy missing-table fallback behavior is not claimed: a missing source table does not become a historical cache hit. An existing but empty source still uses the documented cache fallback.
- Public endpoints are GET/HEAD only. Historical CORS response headers are retained; they do not enable mutation methods.
- Responses use `Cache-Control: no-store`; `X-Youtube-Board-Dataset` identifies fixture/live/unknown without changing legacy body envelopes.
- Classification query arrays are accepted consistently, including non-cache lists. Original PHP ignored arrays on those lists; this change prevents unintended widening of a filter.
- `api_tag_log.php` rejects scopes above 500 channels with 400 instead of unbounded CPU/query work. Matching channel logs are fetched in one batch rather than N+1 queries.
- Channel keyword ranking orders its 10,000-row source cap by PK for deterministic selection, deduplicates before ranking, and returns zero weight for unparseable `max_hours` instead of NaN/null.
- Daily tag-cache readers consult the TS publication sidecar. Pending publication or unknown-view buckets are withheld completely, including older cache rows from the same bucket. This is a conservative guard over legacy MyISAM tables, not cross-table snapshot isolation.
- `group_view.php` preserves the original `available` meaning for its membership shell; `projection_complete:false` plus `blocked_reason` explicitly marks unavailable metrics. LIKE wildcard behavior for group/photo lookups is preserved with parameterized SQL.
- TS daily AI source snapshots take precedence over mutable `urt_channel_ai`. A malformed/missing snapshot returns no channel analyses and explicit `snapshot-unavailable`, never silently substitutes current source rows.
- Compatibility keyword endpoints deliberately describe **legacy** `tags`/cache metrics. The maintained tag.observe.tw vocabulary and matching evidence remain `/api/v1/vocabulary`, `/api/v1/videos/:id/tags` and `/api/v1/keywords/:keyword/videos`. News article counts are never substituted for YouTube counts.
- Raw channel/video list count columns and the raw TVBS live-log `max_current` preserve Laravel's JSON number type when their SQL integer value lies in JavaScript's exact range (`-9007199254740991` through `9007199254740991`). Larger integer values remain their original lossless decimal strings; this is an explicit wire-type difference from PHP integer JSON. The conversion is per-table and limited to count columns: nulls, IDs, numeric-looking titles, raw log JSON and other text remain unchanged. Derived aggregates outside the exact integer range remain outside the parity claim.

## Verification

`test/legacy-api.test.ts` covers every route against the isolated MariaDB schema and focused behaviors: byte-exact IDs, HTML/CSV shape, cache/force fallback, category filtering, comment publication, wrapped/list payloads, group date ordering, signed deltas, the original PHP prediction precision fixture (1003/2006/518), immutable AI sources, event chains, PHP scalar/numeric conversion and numeric-key source ordering. Fixtures use their own IDs and are cleaned after the suite.

`test/legacy-count-wire-types.test.ts` adds database-free HTTP serialization regressions for the count-type mismatch found during the approved local historical-slice comparison. It exercises both video lists, channel lists and raw TVBS logs, including zero/null/signed values, exact safe-integer boundaries, lossless out-of-range strings and unchanged numeric-looking IDs/text.

Four CLI Proxy review packets returned actual `claude-opus-5-5` text (three focused/final rounds finish `stop`; the initial broad round was truncated and not treated as complete). Confirmed findings were fixed and tested; assertions contradicted by the supplied Laravel code were documented rather than applied. Review files remain outside version control under `/tmp/youtube-board-legacy-*-opus.json`.

Remaining acceptance work includes production-sized performance testing, narrowly approved production read-only data comparison, malformed/historical source variants beyond the fixtures and browser consumers of legacy APIs. Numeric-key map output ordering can differ from PHP insertion order (first-topic and event-PK selection preserve original input order). Counts that exceed JavaScript's exact integer range are not covered by the parity claim. These APIs preserve the original historical formulas, including predicted values; v1 reports distinguish measured and derived values separately.
