# Current backup response comparison — 2026-10-12

All 36 reviewed legacy APIs were captured from Laravel and TypeScript against the
same isolated, consistent production backup: **72 responses, all HTTP 200**.
Strict offline comparison reports **4 equal cases, 32 different cases and 43
explicit differences**, with no differing numeric tokens, shared scalar values,
array ordering or HTTP status. This is current-backup reader evidence, not a live
production capture or a background-writer handoff.

The 43 differences are exactly the same reviewed categories retained in the
[historical comparison](historical-parity.md):

| Difference | Cases / differences | Exact scope |
| --- | --- | --- |
| JSON Content-Type | 32 | Laravel `application/json`; TS adds `charset=utf-8`. |
| Cache lineage metadata | 8 | TS adds exactly `meta.cache_window:null`; Laravel has no key. |
| Unavailable group projection metadata | 3 | Laravel `cache_builder: reports:group-view:build` is replaced by TS `cache_strategy: dynamic-tag-date-projection` and `projection_complete:false`. |

Every value and path above was checked against the saved responses. Captures were
not rewritten or normalized to obtain equality; the strict comparator still exits
1. The execution owner retains the final disposition decision for these explicit
differences. There are no unclassified differences in this case manifest.

## Source and isolation

The source is the root operator's `20261012T044617Z` consistent backup, restored
into MariaDB **11.4.13** on the existing internal-only cutover network. It contains
**66 original base tables and 2,343,461 rows**. Both readers used the fixed clock
`2026-10-12T04:47:14Z` and request origin `http://parity.local`.

Laravel used a fresh clone-only SELECT principal, frozen source/vendor files,
empty `.env` and cached configuration, in-memory cache/session, null queue and
mail, disabled ingestion/provider settings, and an HTTP facade that rejects stray
requests. TypeScript used the separately granted report principal through the
new schema's source views and empty TS state tables. Its six relevant source
directories were snapshotted and mounted read-only over the recorded runtime
image. Neither reader had a legacy source DML/DDL credential. Capture was sequential
with bounded response sizes, without starting a public HTTP service or provider.

Reader source/image/collector fingerprints were recorded and rechecked. The backup
archive SHA-256 was reverified; after capture, all **11 source manifests** still
matched the sealed restore baseline, including table definitions, counts, runtime
settings and selected checksums. The response manifests' source commitment binds
the exact immutable dump archive and those verified manifests. It is explicitly
not presented as an independently recomputed full per-row byte fingerprint of
the 2.3-million-row database.

Only the new clone SELECT principal was created and then dropped; original source
tables, DDL and rows were not changed. The task's reader containers and credential
file were removed. The root-owned restored database, network and other principals
were retained. This task made no production connection or mutation.

## Nonempty coverage and limits

Thirty cases contain actual source data. Highlights include 123 current-date live
videos, 14 TVBS live rows, 544 stored comment entries, a positive video duration,
955 cached vocabulary entries, 119 channel-cloud terms, 943 tag-cloud terms,
170 date-cloud terms, nonempty channel/video/history/prediction reports and
11 stored/derived AI topics. Byte-exact IDs, counts, nulls and timestamps remain
under the strict comparison; stored metadata timestamps are not ignored.

Six cases have only empty/unavailable coverage: keyword relation dates, keyword
month, keyword period, tag-keyword day cache, the selected external group view,
and photo. Their corresponding source cache tables are empty, or required group
definitions are unavailable. HTTP 200 and an empty shell do not establish nonempty
parity for them.

Additional limits are explicit:

- The nonempty live-tag cache is from **2026-05-22**, the latest available cache
  selected for this case. It proves cache response compatibility, not current
  live-tag freshness.
- The AI event case has one current-day match and no matching prior-day chain.
  The topic case has nonempty derived topics but no stored video/topic cache.
- The retained historical case ID `tags-all-empty` now contains 955 entries;
  its old name is not a statement that this capture is empty.
- This is one representative input per legacy API, not every filter/date
  permutation, modern DTO/HTML parity, account acceptance or production capacity.
  Capture ran alongside the separate integration/build lane; its durations are
  not load-test evidence.
- New maintained-vocabulary/evidence state is empty in the frontend schema.
  Legacy API vocabulary compatibility does not claim that the new maintained
  tag.observe.tw vocabulary/matching workflow has completed.

## Evidence and replay

Private ignored evidence is under `platform/.local/current-parity/`: paired raw
bodies and manifests, frozen reader trees/fingerprints, capture logs,
`comparison.json`, exact `disposition.json`, `coverage.json`, the source commitment
and post-capture source manifests. Combined response size is **2,580,205 bytes**.
Retention deadline is **2026-10-26**, unless the operator explicitly extends the
release review. Keep the original backup under its separate retention policy.

From `platform/`, the network-free replay is:

```bash
node tools/parity-compare.mjs \
  .local/current-parity/laravel/manifest.json \
  .local/current-parity/typescript/manifest.json
```

Expected exit is 1 with 43 untruncated differences and zero error-response cases.
Recapture affected cases after any relevant reader change. Frontend routing,
security, load and human-account acceptance remain in the separate
[production acceptance checklist](frontend-production-acceptance.md).
