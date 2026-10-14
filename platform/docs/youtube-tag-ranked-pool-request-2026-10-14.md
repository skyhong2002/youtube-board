# YT request for tag's filtered, windowed ranking pool

Status: proposed upstream contract, awaiting tag coordination. No new runtime,
candidate, capture, build or deployment is approved by this document.

## Confirmed current limitations

Source inspection: tag commit `61fd537c0f8bc91c687ea2fe875cf0bd79215a77`,
`app/src/v1/routes.ts`, `app/src/v1/openapi.ts`,
`app/src/jobs/ranking-job.ts`, `ranking-compute.ts`, `tag-qualification.ts`.
`/api/v1/ranking` uses a fixed rolling 24-hour snapshot; `days=7` is unsupported
and ignored. `at` selects an earlier 24-hour snapshot, not another duration.
`ranking-basis.ts` is an internal module, not a public endpoint. The computation
caps the stored candidates at 500 before public `early`/`broad` filtering. Public
`matchedCount` counts that saved pool, not the entire corpus; there is no paging
or public truncation proof. The vocabulary snapshots contain raw article tags,
and `/tags/suggest` is a 14-day, at-most-20 autocomplete response. Neither
provides the complete filtered today/seven-day ranking pool requested for YT.

Saved formal-data receipts and source hashes are in
`youtube-tag-ranked-pool-audit-2026-10-14.json`. Both samples use snapshot18063,
computed UTC2026-10-14T12:00:18, news basis43 media (41 active). `gate=all`
returned500 entries; `early` returned446; `broad` would retain378 of the500.
Early means at least two media with at least two occurrences each, stronger
than merely N>=4/M>=2. N>=10/M>=3 retains484; N>=20/M>=5 retains203.
These are bounded-sample counts, not claims about the full corpus or seven days.

Of the24 reported generic words plus 表示/發現/最新/重要/問題/現場,
only 投資 appears in this500-entry sample: rank75, reported count31,16 media;
it also passes early. Thresholds are useful for eligibility but cannot prove
semantic specificity. The reviewed24-word fallback remains supplementary.
Current count increments for each tag occurrence; repeated tags in one article
are not explicitly deduplicated in `computeRanking`. A new contract must
guarantee distinct articles before claiming an article threshold.

## Requested endpoint (names are a proposal, not existing API)

Please ask tag's owner to expose a filtered ranked pool with an immutable
snapshot and pagination, for example:

`GET /api/v1/ranking-pools?category=news&since=<UTC>&until=<UTC>&gate=early&order=score`

`GET /api/v1/ranking-pools/<snapshotId>?cursor=<opaque>&limit=500`

An extension of the existing ranking API is equally acceptable if it provides
the same guarantees. Reuse tag's fixed ranking basis, isTagNoise, own-media tag
exclusions, score/order and qualification code. Do not recompute a separate YT
dictionary or export articles/bodies/visitor identifiers.

Required response semantics:

- Exact half-open UTC `window.since`/`window.until`, publication-time basis and
  `computedAt`/`asOf`, including Asia/Taipei midnight through a shared cutoff for
  today, and midnight six days earlier through that same cutoff for seven days.
  Boundary handling must agree with YT; never silently substitute rolling24h.
- Immutable `snapshotId`, schema/policy version, basis ID/roster version,
  upstream vocabulary ID when applicable, noise-filter version and stable
  Unicode label/term identity. Exact whole labels must map to YT vocabulary
  keys; no substring eligibility or guessed aliases.
- Entries: `tag`, deterministic `rank`, `score`, **distinct** `articleCount`,
  distinct `mediaCount`, and per-media distinct article counts. Apply the
  threshold before ranking/capping. Echo the qualification rule and thresholds.
- `available`, source coverage bounds and an explicit incomplete reason;
  `eligibleTotal`, `nextCursor`, `truncated` and an end-to-end checksum over a
  documented canonical entry serialization. All pages bind to the same
  snapshot/window/basis; expired or mismatched cursors must reject.
- Page-size/runtime caps and snapshot reuse; a hard source/pool cap is reported
  as unavailable/incomplete, never as an apparently complete smaller pool.
  Valid complete empty pools are distinguishable from missing snapshots.
- Anonymous GETs only. Retain current privacy/cache predicates; account or
  private responses must not become public-cacheable through this integration.

Initial threshold proposal is tag's existing `early` (two outlets each two
distinct articles; implied N>=4/M>=2), rather than inventing N/M values. The
24-hour formal sample validates its retained volume446, but today's partial
window and seven-day coverage require the new endpoint's formal-data samples
before this becomes an accepted production configuration. Record all N/M
results and retained people/events; raising N until 投資 disappears would also
remove legitimate rare topics and is not justified by this sample.

## YT integration and acceptance work after contract confirmation

Keep the original vocabulary/evidence pool and Laravel writer ownership. Use
the windowed tag-ranked terms as the primary derived matching/ranking
eligibility pool, mapping exact source labels to existing immutable keys before
YT aggregation and top40 selection. Do not replace the raw vocabulary with a
500-entry export. Country/city/party no-equal exclusions (plus audited
中共/北京/烏克蘭), platform/news-source exclusions and the24-word fallback remain
additional whole-term filters. Expose source snapshot/window/threshold and
exclusion reasons in the raw-pool report, distinguishing not-qualified from
upstream-unavailable. Missing/incomplete/wrong-window pools must show an
unavailable state, not silently revert to all raw tags.

For rise comparisons, request corresponding prior windows or explicitly reuse
the same current eligible keys across current/prior YT metrics with disclosed
semantics. Never interpret a term absent from a capped prior pool as zero.
Persist snapshot provenance through existing reviewed TS mechanisms; no manual
production SQL changes or scheduler handoff is authorized here.

Add contract/adapter and integration tests for exact windows/boundaries,
threshold deduplication, pagination/checksum/basis, missing/empty/incomplete
states, Unicode labels, country/platform overlays, and filtering before top40.
Candidate must produce today/week top40 from formal readonly data, alongside
tag's same-window ranks/counts/media and the exclusion reasons for removed YT
terms. Independently review both tables and all16 new-SHA home/keywords captures.
Then submit the exact simple arm64 build/deploy steps through babysit's normal
gates. No earlier SHA's visual approval transfers.

The d4deebb manual-list-only build draft is withdrawn and retained. Its
independently reviewed partial-view lower-bound formatting and fallback policy
remain usable source changes for the next successor; they are not deployed.
