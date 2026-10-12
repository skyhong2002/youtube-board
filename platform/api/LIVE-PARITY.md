# Live report parity

The current/day/period reports now share bounded, byte-exact source interpretation. This is a local TypeScript implementation; Laravel remains the production writer. No YouTube requests or production data inspections were needed for this change.

## Current live

The source contract follows `LiveCurrentReport` and `LegacyTagFilter`: an `urt_count` membership row, no actual end, positive current viewers, polling within one hour, optional `actualStartTime >= now-hours` for1–168hours, and all/any/excluded channel categories. Search, pagination and blank-hours handling are retained. Display cache and raw video fallback each select the latest exact-case ID; one case variant cannot supply another's title or inflate the join count.

Visible category chips use the reviewed ID subset `[1,2,3,4,5,6,60,43,48,49,81]`. Category filtering still operates on every stored category. These are YouTube channel classifications, separate from the shared tag.observe content vocabulary. Current filters expose hours and category composition; chips link to current-live category reports.

Today's peak is the maximum of the measured current count, recorded same-day aggregates and valid same-day samples. Same-day trends merge duplicate timestamps by maximum, sort by time and return the last24samples. Nonnegative safe integer counts and exact clock keys are required. Midnight resets today's scope. This deliberately corrects Laravel's aggregate-first fallback when valid samples/current measurements exceed the stored aggregate; no prediction or missing-as-zero value is introduced.

## Daily and period ranking

`/live/days`, `/live/days/:date`, and `/live/periods` default to Taipei today, matching Laravel's current-day behavior. Explicit `date`, dated paths, from/to ranges and an optional bounded days window are supported. A from-only range ends today; range fields take precedence over the single date. A `to` without `from` returns400 instead of silently replacing an explicit date. A single clock sample supplies both the queried window and its controls, including requests spanning Taipei midnight. Dates must be valid, ordered, at most90days, and within2022-11-19 through today. Invalid or reversed values return400 rather than Laravel's silent replacement, clamp or swap. Empty form fields mean omitted.

The page exposes date/range/search/category controls and previous/next/today links. Navigation preserves category/search/page-size filters and clears pagination/range state. Around a range, links explicitly say “區間前一日” and “區間後一日” and open the adjacent single day. A dated-path form submits to `/live/days`, so changing its date does not remain pinned to the original path. The period ending today offers no future next-day link.

Rankings merge log rows by exact video/date and take the highest positive measured aggregate or valid sample across the requested period. Unobserved and zero-only streams do not become ranking entries. Display fallback, visible channel tags and a link to the detailed video observation page are included. A source peak remains an observed lower bound, never an estimate of the unsampled true peak. Ties use peak descending, peak date descending and exact ID. Generic report pagination remains50 by default /200 maximum rather than Laravel's1000-row response.

## Source budgets and consistency

Log metadata is read first with a20,001-row sentinel; exceeding20,000 rows returns422 before any bodies are read. Selected bodies have a128KiB per-row and8MiB total budget, rechecked in SQL with a window sum so a concurrent size increase cannot defeat the transfer cap. Selection can skip a large row and still admit a later small one. Metadata includes existing source aggregates even when a body is omitted. Coverage reports skipped rows/bytes, malformed logs, invalid samples and changed byte lengths; the UI warns when sample evidence is partial, and affected current/ranking rows are also marked. Peaks under omitted samples are lower bounds, not guarantees that every stored sample was read. Source row/byte caps and aggregate numeric-precision failures do not silently produce complete-looking rankings.

This is a last-observed read across legacy source tables, not a transactional snapshot or an ingestion ownership transfer. Current rows and their total count are independent reads; the coverage contract and UI explicitly disclose that concurrent polling can briefly change the count or pagination. The same bounded loader now also protects the preexisting live channel/hour/day aggregate readers, without claiming their remaining legacy formula/cache parity is complete.

## Group-hour controls

All10 reviewed `LegacyLiveGroupDefinitions` already existed. `/live/groups/:group/hours` now exposes every group through navigation that preserves date/metric, plus date and views/count controls. Missing cells stay null and observed zero remains zero. Explicit date or latest cache date scoped to that group's exact tag filters is preserved. Unknown group keys return404 rather than Laravel's default-group fallback. No keyword/content-group trend behavior changed in this slice.

Group-hour loading reads only metadata for each group's latest row, checks the existing published-cache lineage, and requests only the bounded `hour_result` body; unrelated large tag payloads are not fetched. Each group body has a128KiB SQL gate. The largest reviewed option has24groups, so source body transfer is at most3MiB before ordinary protocol overhead. Missing or withheld cache rows remain missing. The lineage sidecar protects the entire selection/date, so a pending or unknown-view date never falls back to older versions. The UI explains this withholding. A missing or size-changed body, or a changed modification time between metadata and body reads, becomes null with a concurrent-change note.

## Validation

Local checks passed46 API tests: the9 new pure live cases,4 new MariaDB cases, plus existing core database and edge-report regressions. API/web typechecks and23 web tests passed. Fixtures test case-colliding IDs, stale live exclusion, hours/category filters, exact today/date/range scope, current-floor and sample maxima, empty observations, retained small rows under the8MiB budget, all group switches, null versus zero and count/view controls. Pure regressions additionally cover one-clock midnight consistency, invalid path dates, standalone range ends,90/91-day bounds, navigation edges, pending-date withholding and metadata/body changes. Clearing group date selects the latest scoped date; a real MariaDB group fixture with non-null modification time verifies the metadata/body comparison roundtrip. Native browser checks at390px confirmed date navigation and group controls without horizontal page overflow.

Actual Opus reviews (`claude-opus-5-5`, returned text) are tracked in `.local/reviews/live-report-parity*.json`. Initial D1–D10 findings were corrected or resolved against the supplied source contracts; the followup accepted those dispositions. Its remaining cleared-date finding was fixed and regression-tested, and the requested non-null modification-time database check passed with the reader’s `dateStrings: true` configuration.

The final actual closure review (`live-report-parity-closure.json`) confirmed N1/N2 closed with no remaining concrete blockers in this scope. Three reviews returned text; no provider review is counted from an empty response. Non-blocking semantics remain explicit: valid path dates take precedence over a query date, and a video is marked partial if any date in its requested period had incomplete samples.
