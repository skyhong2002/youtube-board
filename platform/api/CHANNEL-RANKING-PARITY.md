# Channel ranking and profile metrics

Directory and category rankings share the 11 maintained count columns: cumulative views/subscribers/videos; weekly/monthly views/subscribers/videos; estimated weekly/monthly views. API inputs use legacy `column` names in `shared/channel-ranking.ts`; invalid or repeated values return 400. Empty controls select defaults. Sorting precedes pagination, nulls follow recorded values (including negative deltas), and channel ID breaks ties.

- `/channels` defaults to weekly views and no minimum. Missing count rows retain source cumulative counters and null cache metrics.
- `/tags/:id/channels` defaults to monthly views and minimum 0. Count membership, route category and additional AND/OR/NOT filters are required. Minimum applies to subscribers unless an OR-category filter is present, when it applies to cumulative views. Null counters cannot pass a numeric threshold, including zero.
- Response `ranking` and `meta.coverage` name the column, minimum metric/value and scope. UI uses that metadata and offset-aware ranks. Classification remains YouTube taxonomy, separate from tag.observe vocabulary.
- When a count row exists, its null counters stay null; stale source-channel totals do not replace them. This deliberately improves upon the former COALESCE reader. Unsafe counters normalize to null, never rounded numbers or invented zeros.

Profile exposes monthly subscribers/videos, observed period counters, model estimates, and estimate-minus-observed monthly gap. Nulls and signed changes are retained; unsafe subtraction returns null. Exact legacy formulas are labeled explicitly:

- Growth indicator: `(weeklyViews - monthlyViews / 4) / monthlyViews * 25`, only with month > 0 and both counters recorded; not ordinary week-over-week growth.
- Average weekly views per video: `floor(weeklyViews / weeklyVideos)`, only with weekly videos > 0 and both counters recorded; ratio of channel increments, not individual video sample mean or television audience rating.

Source counts use available observations within recent periods, not calendar weeks/months. Predictions are historical model estimates, not future guarantees or observed totals. Directory minimum controls use the same OR-dependent metric rule as category rankings. API coverage is asserted for both scopes, as are duplicate query rejection and explicit directory minimums. No ingestion/production ownership changes.

Validation: `test/channel-ranking.test.ts` exercises all sorts through MariaDB, route defaults, pagination, ties, null/negative values, both minimum semantics, intersecting filters, active/deleted channels, missing count rows, HTTP validation, profile composition and arithmetic bounds. Existing database/channel-AI suites and web tests also pass. Actual Opus review evidence is outside git under `.local/reviews/channel-ranking-*`.
