# AI hourly, period and cross-day report readers

The rewritten public reports are read-only. They consume stored AI source results and topic-cache statistics; they do not generate, merge, rename or repair events.

## Hourly and period summaries

`/ai/hours` retains each latest valid interval/data-type analysis and now displays stored category, angle, AI camp label, keywords, people, places, interval endpoints and source IDs. Exact-case video references are linked separately for the visible page. Identical topic labels remain separated by their source index. At most 48 intervals and 200 topics per interval are interpreted; source links are limited to 10,000 per page after pagination, with omissions disclosed. Condition, date and data-type filters are available, including when selecting the latest available date.

Historical hourly text decoding first passes the existing publication guard.
Only `legacy-unrecorded` visible rows may extract JSON from prose or Markdown
fences; immutable published outputs require whole-string JSON. Pending, diverged
and unavailable publications remain excluded before decoding. The new generation
validator is unchanged and does not use this historical reader.

The legacy decoder tries whole JSON, fenced candidates, then balanced embedded
object/array candidates. Quotes, escaped quotes, backslashes and brackets inside
JSON strings are handled explicitly. Each source is limited to 128 KiB UTF-8,
64 nesting levels, 16 parse candidates and 524,288 character-scan steps. A limit
hit is visibly classified rather than retried without bounds. Existing wrapper
aliases and object-valued topic maps remain supported; original list positions
are retained for citations even when an individual item has no displayable title.
`evidenceCoverage.decoding` separates decoded, explicitly empty, malformed,
unsupported, oversized and bounded sources, counts extracted legacy sources and
invalid items. Human-readable report notes also distinguish these cases, so a
failed parse is not reported as a real empty topic list. Oversized output withheld
by the earlier publication check remains in publication coverage instead of
being decoded.

`/ai/periods` follows the Laravel report's daily-summary model, not the cross-day pair table. It reads each day's latest eligible `urt_ai_date` ordered by `date_from`, then primary key. Stored `data_json` provides channel/video counts, keyword counts and most-mentioned people/keywords. Equal counts retain original source order. When only raw topics exist, absent metrics stay null; source-event reference counts are not presented as unique video counts. Month, explicit dates, condition and type are supported. Default end date is yesterday; invalid or reversed ranges return 400 instead of Laravel's silent fallback/swap. A maximum of 62 days and 200 topics per day applies.

Daily source titles use shared `dailyTopicTitle`, preferring the generator's canonical `標題`, then the documented legacy aliases. Public daily topics and their source links use the same interpretation. Generation remains strict about its own schema.

## Cross-day source history

- `/ai/events/:eventId/history` accepts an actual `urt_ai_event.pk` and rejects an event-name query.
- `/ai/days/:dailyId/events/history?event=...` explicitly identifies a daily source plus an exact title.

The separate routes avoid interpreting an event PK as a daily PK when queries are copied. Existing compatibility APIs are unchanged.

For at most 60 previous days, the reader selects the latest stored adjacent-day period that explicitly references the current daily PK in `data_json`. Both numeric and string JSON identifiers are accepted. Re-generated daily rows do not hide the old period version that references an older snapshot. Each hop validates the two distinct source IDs, previous source date, condition, user token and unique exact titles. Missing, changed or ambiguous source references stop the chain visibly. The query/parse path is bounded to one selected period and at most one source row per hop; stored TEXT payloads remain bounded by their schema.

This is a **stored AI association**, not editorial event identity. Same names, people or keywords never create new links. Separate editorial UUID links appear only when an active audited editorial association points to the exact analysis source ID. News and YouTube measures are not combined.

## Validation

The B1/B2 follow-up adds 9 focused pure prompt/parser tests and 3 isolated MariaDB
tests; together with the existing prompt/history suites, 20 pure and 12 MariaDB
tests passed. These verify embedded/fenced prose, escaped strings, malformed and
unsupported payloads, genuine empty arrays, parser bounds, source-index retention
and unchanged pending/diverged exclusion. The new prompt contract is documented
in [PROMPT-PARITY.md](../api/PROMPT-PARITY.md). Root coordinates the combined
follow-up review; this stage did not contact an external model independently.

API/web typechecks, 10 focused parser/API tests, 9 dedicated MariaDB fixture tests and 23 web tests passed. Cases include stable tied counts, missing raw metrics, canonical daily title precedence, latest hourly type selection, exact-case references, duplicate-title pagination, later-page source links, month filters and Taipei dates, explicit route identity, wrong-case event names, source mismatches, and old-snapshot chains after regeneration. SQL was exercised on local MariaDB 11.4 against `youtube_board_test_rewrite`; no production inspection or writes were used.

The followup Opus review found no verified blockers, conditional only on the corrected tests passing; both cited cases (later-page references and old-period fixture insertion) passed. Actual Opus 5.5 review artifacts are `.local/reviews/ai-history-expanded.json` and `ai-history-expanded-followup.json`. Production rollout remains gated separately from this local implementation.
