# Taxonomy source rows and continuous live history

Implemented residual stages A1/A3 from `platform/.local/reviews/remaining-parity-codex.md`. Registration lives in `src/reports/live-taxonomy-videos.ts` and `src/reports/live-continuous.ts`; root owns replacing their former `live-extra.ts` blocks. Laravel reference contracts are `TagLiveVideosReport` and `LiveContinuousReport`.

## Taxonomy live videos

`/tags/live/videos` and `/tags/:id/live/videos` default to the single current Taipei date. `date` selects a day, while `from` starts an inclusive range with `to` defaulting to today. The rewrite retains an explicit `days` convenience when no date/range was supplied. Malformed, reversed, future and pre-source dates fail rather than being coerced. Ranges cap at 90 dates; unsupported `today` offsets return 400. Date/range/day-count controls and scope-preserving previous/today/next links expose the selection.

Each returned row is an individual source log with positive `max_current`, identified by source PK and date. Duplicate same-video rows and different dates remain distinct; a source peak is never overwritten with a sample-derived value. The path tag intersects `tagid`; `or` and `not` retain their meanings. Names, publication times and channels use retained live display metadata before current-video fallback, with byte-exact YouTube ID joins. An orphan source video can still display a retained title. Visible channel taxonomy remains separate from maintained content vocabulary.

SQL paginates before enrichment (default 50, maximum 200; Laravel used a larger default). Only the selected page's bodies are considered. Per-row and aggregate sample limits are 128 KiB and 8 MiB, enforced in the body query as well as the metadata planner. SHA-256, source identity, source timestamps, peak and actual byte count reject source mutations between reads, including mutations preserving both size and mtime. Invalid, empty, changed and oversized evidence is counted; provider peaks remain intact. The last 24 valid chronological sample values are retained and the last 8 displayed. Title/channel projections and taxonomy/name lookups also have explicit bounds. Count and page are independent reads, disclosed in coverage; they are not claimed to be one transactional snapshot.

## Continuous live

`/live/continuous` retains current active-row selection: unfinished, positive viewers, observed in the last hour, and started before the requested `hours` threshold. Unknown starts follow Laravel's inclusion rule and remain visibly unknown. The threshold is 1–168 hours, default 24.

The historical default endpoint is the global latest source-log date; only an empty source falls back to Taipei today. An explicit `today=0` preserves that latest-source anchor. `today` offsets the implicit endpoint; `to` or its visible `date` alias selects an explicit endpoint. Conflicting explicit endpoint values reject. `from` overrides the derived start; otherwise `days=7` means seven dates. All periods remain within the known source window and 90 dates. Explicit controls cover every supported period/hour/taxonomy/search parameter. The 90-day rewrite cap intentionally differs from Laravel's 366-day allowance.

History enriches only the selected current page. SQL groups by exact video ID and date, choosing that date's largest nonnegative source peak and recording its underlying log count. The average denominator is the number of dates with a valid nonnegative peak, **not** the number of raw log rows or every date in the interval. This intentional difference from Laravel is stated in report notes and coverage. Zero remains zero; missing days/peaks remain null and never fall back to current viewer counts. Integer sums use BigInt before rounding to avoid unsafe intermediate sums. Result cardinality is bounded by selected unique IDs × requested dates, with an overflow sentinel and membership/uniqueness checks.

## Verification

- `test/live-taxonomy-continuous.test.ts`: pure/stub period, filter, exact-SQL, sample hash and byte-budget, selected-page history and null/zero/overflow contracts.
- `test/live-taxonomy-continuous-database.test.ts`: isolated MariaDB fixtures verify default/old/range dates, positive log identity, duplicate days, retained orphan display, case-distinct IDs, intersection filters, pagination, same-size mutation refusal, latest-date anchoring, daily denominator and selected-page queries. Owned fixtures are deleted afterward.
- No production access, source export, job activation or write handoff is included. Synthetic fixtures establish query behavior, not real-data parity or production latency.
