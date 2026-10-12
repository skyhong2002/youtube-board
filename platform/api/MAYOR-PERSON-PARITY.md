# Mayor-person descriptive observations

The person routes `/mayor/cities/:city/people/:person` and their `/days/:date`
variant now include deterministic daily summaries and seven-day raw media share.
They use the city report's exact flat term maps, category selection, newest-row
selection, publication checks and unweighted denominator. No provider call is
made and no campaign advice is generated.

## Meaning of the values

- Daily observations cover categories 3, 4, 5 and 6. A valid recorded category
  without the exact person key contributes zero. An absent, malformed,
  unpublished, oversized or concurrently changed category remains unavailable.
- `daily.observedTotal` totals available categories; `daily.total` requires all
  four. A daily difference requires both dates to have all four categories.
  “Complete” describes recorded cache buckets, not proof of full upstream capture.
- The largest observed categories retain ties. All-zero observations have no
  largest category. These are descriptive category counts, not political scores.
- Seven-day raw value and percentage use the same `mayorObservations()` helper as
  the city report, including its maintained historical candidate list and zero
  denominator convention. Partial coverage remains visible as `N/28` buckets;
  missing buckets are never synthesized as zero. Partial observed percentages
  are labeled as such. This is media-reference share, not public support.
- People outside the configured city list retain their raw observed values but
  receive a null share. They do not enter the city's denominator.
- The existing AI excerpt is independently publication-gated. Withheld AI never
  hides the deterministic observations or permits an older AI revision fallback.

## Date and metric selection

Explicit route/query dates must agree. Invalid dates, duplicate metrics and
invalid pagination fail before source work. Metric aliases match the city report.
When no date is given, selection inspects only the latest exact city/person AI
candidate in the last 365 Taipei dates through today, ordered by date and PK.
Its result is capped at 128 KiB in SQL and must pass the existing AI publication
guard before it can anchor the report. Future or older candidates are excluded;
a withheld, oversized or unverifiable latest candidate falls through to source
lookup without rescuing any older AI revision. `dateAnchorAi` exposes this
independent publication coverage. Explicit older dates remain readable.

Fallback selection uses an exact source key (including recorded zero) in the
last 365 dates, then bounded video publication dates, then Taipei yesterday.
Source lookup also does not rescue a withheld latest revision by using an older
duplicate.

The selected metric loads seven days; the other two displayed metrics load only
the selected and previous days. Previous/next and city links preserve the metric.

## Bounded source reads

All category and reference-cache bodies, including default-date lookup, share an
8 MiB request budget. Category metadata is read before bodies, each body is
limited to 128 KiB, and the shared reader allows at most 372 source days and 1,488
latest category rows. The SQL body lookup verifies original date/category,
creation/modification timestamps, lengths, hashes and latest primary key.
Publication lineage and source-window identities must remain stable across the
read. Coverage separately reports missing, withheld, malformed, oversized and
changed buckets. Default-date lookup can exhaust the budget on a dense year;
users can request an explicit date rather than receiving truncated observations.

Person reference cache bodies have metadata-first length/hash checks, per-field
128 KiB limits, latest-PK identity, timestamp checks and publication validation
before and after transfer. Reference lists above 1,000 entries are rejected.
Only eight bounded video titles and identity/scalar fields are returned. Cached
video references use both an indexed predicate and a byte-exact ID predicate.
If cache references produce no video rows, the existing date-bounded title or
description search remains available and its source is explicitly labeled.

## Local validation

- Seven pure person-summary/route tests plus twelve existing city tests pass.
- Seven person MariaDB cases exercise city-denominator equality, latest revision,
  case-distinct video IDs, missing/zero/partial observations, outside-list people,
  pending publication, oversized bodies, same-length concurrent changes and
  independent AI publication.
- Existing city, report-parity and AI-publication MariaDB regressions are run
  serially with the person cases: 40/40 pass. API typecheck also passes.
  Serial execution is required because publication tests temporarily rename the
  journal table. Fixtures use the isolated `youtube_board_test_rewrite` database,
  random identifiers and owned-row cleanup, including partial setup failures.

## Final-review correction

The default-date AI candidate now has the same bounded calendar scope and
publication eligibility described above. Dedicated MariaDB cases cover future
and expired candidates, the inclusive oldest eligible date, visible historical
anchors, explicit older dates, pending and oversized latest candidates, and
refusal to rescue an older same-date AI revision. An explicit pure regression
also confirms that an out-of-list absent exact key in a recorded valid bucket is
zero while its city share remains null, matching the city flat-map contract.
