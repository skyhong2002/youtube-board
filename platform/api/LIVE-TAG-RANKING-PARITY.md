# Live keyword ranking

`registerLiveTagRanking` in `src/reports/live-tag-ranking.ts` owns the read-only
`/live/tags` report. The original reference is Laravel `LiveTagReport`.

The window ends at the latest date for the exact sorted channel classification
selection. Both omitted `today` and `today=0` retain that source anchor; a positive
offset subtracts from it. `days=7` means the endpoint plus the preceding seven
dates, eight dates total, as in Laravel. Explicit `from/to` take precedence and
are displayed as editable controls. All/any/excluded channel-classification
controls expose the same canonical sorted comma selections to the shared name
picker; a blank control means the empty exact cache selection, never an invented
category. The default page has100 rows, maximum200.
Malformed/duplicate selectors, unknown parameters, invalid/reversed periods and
windows longer than91 dates return400. Empty optional scalar controls mean absent.

If the exact selection has no source date, the empty window anchors to Taipei
today, explicitly identified as `taipei-clock`; unlike Laravel it does not borrow
the latest date from an unrelated classification. Valid explicit dates are kept
rather than silently clamped to source history.

Each observed date contributes the selected term's maximum hourly value. Views
and videos use their respective single JSON column; importance uses positive
view peaks with `ln(peak) ×100`, summed and rounded to one decimal. Numeric metric
totals retain exact safe integers. Missing source dates are null, while an
observed empty dictionary or an absent term in an observed dictionary is zero.
Malformed term hours are null even when another term in that date remains usable.
Ranked totals describe the observed dates and include their observed-day count;
they are not claims of a complete requested period or unique viewers.

Recognized legacy envelopes and numeric-hour arrays are supported without
unwrapping a literal word named `views` or `data`. Terms use Laravel's trimming;
colliding trimmed identities become unknown rather than double counted. Terms
are not rewritten into decoded URL aliases. Invalid/negative/noninteger or unsafe
hour values make that term/date unknown. Only terms with a positive observation
appear in the ranking. Unsafe cross-date sums are null with explicit coverage.
The daily-source section exposes status and original scalar totals for accepted
dates; withheld or unreadable metric dates do not expose apparently usable totals.

Source reads select the newest PK per date before transferring any bodies. Only
the requested metric is read, at most1MiB per day and16MiB per request, allocated
newest dates first. Hashing occurs only after budget allocation. Payload reads
require the same PK, timestamps, scalar counters, byte length and SHA256 over raw
bytes, and that PK must still be the latest exact-selection revision. A second
identity/hash query after transfer detects changes during the body read. Publication
is checked before and after transfer, including vocabulary/rule/window identity.
Missing-row dates also consult the publication sidecar, so pending dates are not
mislabeled as ordinary cache misses. This remains a bounded observation over
MyISAM data, not a cross-table transaction snapshot.

Other bounds:5000 raw terms/day,200000 raw term-days/request,10000 distinct terms,
1024 UTF-8 bytes/term and48 hourly values/term. Over-budget days are withheld whole,
without partial ranking. Selected rows are paginated before date-matrix expansion.
The fixed Laravel display exclusions plus local `tags.no_tag` are bounded to10000
local rows; overflow fails422 rather than silently applying a partial exclusion
list. The deployment-external `stopwords.php` is not available and is not claimed.
Display exclusions remain distinct from the maintained shared vocabulary.

Coverage separately reports missing, pending/unknown publication, malformed,
oversized, byte-budget, changed, term-budget and observed dates, partial malformed
term dates, unsafe totals and applied limits. Previous/next window links preserve
classification and metric; latest-source navigation restores relative-day mode.
Freshness derives only from accepted source timestamps. No provider calls,
generation, cache rebuilding or production ownership changes occur on reads.

Validation on2026-10-12:14 focused pure cases and9 isolated MariaDB cases passed;
API typecheck passed. Real SQL cases cover exact-scope latest date, newest revision,
pending absent rows, malformed/empty sources, oversized bodies, same-size/same-mtime
mutation, a newer revision inserted after transfer, publication transitions,
raw term bounds and the shared16MiB budget. Fixtures use dedicated tag IDs988731/2
and their inserted PKs, with exact cleanup in `youtube_board_test_rewrite`.
No external calls, production reads/writes or Opus review were performed. Root
owns route registration replacement, whole-tree integration and browser validation.
