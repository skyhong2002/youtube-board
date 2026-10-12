# Released tag vocabulary: read-only preview

On 2026-10-12 18:05:38 UTC the downstream preview successfully read the released
base `e8a99a56-3008-4da8-86c6-64d1ff468b3f`, generated at
2026-10-12T17:29:51.650Z. This is real public-source data, fetched with the existing
service credential. No production DB connection, write, serving-pointer change,
workflow handoff or full-pool import occurred. Existing article-window data was
retained; the intended 24-hour fallback is not removed by this work.

| Measurement | Result |
|---|---:|
| Full source pool, from manifest | 4,733,073 terms / 9,467 pages |
| Active source subset actually read | 44,852 terms / 90 pages |
| Source subset rule | Non-noise, length ≥2, ≥3 articles in last 30 days |
| Active fetch, validation and aggregate checksum | 37.902 s |
| Serialized active entries | 19,141,013 bytes |
| Normalized matching terms | 44,448 |
| Merged duplicate identities | 404 across 352 alias groups |
| Labels changed by normalization | 4,806, including 6 with zero-width characters |
| Rejected active terms | 0 |
| Trie compile | 44 ms |
| Incremental retained trie heap after forced GC | 26,805,400 bytes (25.6 MiB) |
| Heap after initial trie compile | 89,601,960 bytes (85.5 MiB) |
| Peak process RSS across the entire preview | 400,609,280 bytes (382.1 MiB) |

All 90 page checksums and the complete active-subset checksum matched. The client
uses `compact=1&limit=500` to avoid repeating the 707 KB manifest on every page.
The full pool was **not** downloaded or silently replaced by the active subset.

## Changes preview

The first round pinned target `704eca9c-4a63-4803-8228-384abc092a81` before reading
its continuation pages. Each response checksum/cursor/target was verified. Changes
were staged in memory, then applied in order only after the complete round passed.

| Round | Pages | Entries | Time including normalization/compile/GC |
|---|---:|---:|---:|
| Base → target | 4 | 328 upserts | 1.796 s |
| Target → unchanged target | 1 | 0 | 0.657 s |
| Target → unchanged target | 1 | 0 | 0.629 s |

After the first round there were 44,939 exact source identities and 44,535 derived
matching labels. The upstream active subset's original count and checksum remain
separate from this overlay. Non-noise new terms of length ≥2 with publication in
the last 180 days may enter the preview overlay immediately, even when the upstream
30-day/three-article profile marks them `active=false`.

These three immediate requests measure API/processing latency, **not** ten-minute
scheduling, publication delay, or 24-hour stability. The live read-only run before
the aggregate-byte guard also succeeded; the table above is the final guarded run.

## Identity, budgets and safety

Exact raw labels, SHA-256 IDs and source checksums are retained. Matching labels
are separate: remove U+200B/U+200C/U+200D/U+2060/U+FEFF, apply NFKC, remove these
characters again, trim and ASCII-fold to a stable result. Alias identities are
sorted by raw ID; overlapping article counts use the maximum, never an unsupported
sum. Unsupported controls are reported, not silently added as new vocabulary.
No independent stopword pool or AI-generated terms are introduced.

Budgets: 100,000 matching terms, 2,000,000 normalized UTF-16 units (including trie
root), 64 MiB aggregate source-entry bytes, 2 MB per HTTP response, 32 MiB/100,000
staged changes per round and at most 200 changes pages. Exceeding a limit aborts
preview without truncating/publishing. The CLI has a 384 MiB V8 heap limit and an
eight-minute cooperative deadline; single-request concurrency and the authenticated
100 ms pacing floor reuse existing Retry-After behavior. The active subset is
loaded into a bounded map; the 4.7M full pool must instead be streamed into storage.

Observed trie cost is about 603 bytes per normalized term. A simple linear estimate
for 100,000 similar terms is about 57.5 MiB of retained trie heap, **not a memory
bound**: term lengths/prefixes and source-object overhead matter. The measured
382 MiB process peak includes fetch buffers, source records, repeated compilation
and allocator retention. A production worker cannot be sized from trie heap alone.

The preview compiles the existing matcher with derived labels. It does not prove
normalized video-text matching, source offset mapping, or production evidence
compatibility. No provider inference/YouTube quota/notification was involved.

## Reproduce

From `platform/`, with the credential already in its protected file:

```sh
TAG_SERVICE_TOKEN_FILE="$HOME/.config/observe-tag/youtube-token" \
  nice -n 19 ionice -c3 node --expose-gc --max-old-space-size=384 --import tsx \
  tools/preview-vocabulary.ts --live
```

Only sanitized counts/IDs/measurements are written to stdout; progress counts go
to stderr. Credential values, upstream bodies and arbitrary errors are not logged.
Unknown additive manifest fields (`tiers`, `statistics`, `largePages`) remain
accepted. HTTP409 becomes a typed resnapshot requirement without advancing state.

Jobs typecheck passed; 29 focused tests passed, with one existing optional DB
integration test skipped. Tests cover UTF-8 checksum vectors, pinned pagination,
NFKC expansion/idempotence, raw-alias preservation, aggregate byte limits,
mid-round failure/target drift and ordered upsert→delete application.

An actual Opus 5.5 plan review and independent Codex integration review were
completed. Recommendations on serialization, normalization budgets, atomic rounds,
timeouts, truthful measurements and aggregate byte limits were adopted. The
suggestion to truncate an oversized preview was not used: preview fails clearly;
production selection is a separate decision. Review ledger is 78 Codex / 27 Opus.
Detailed receipts remain ignored in `.local/dokploy/vocabulary-live-preview-bounded-20261012.json`
and `.local/reviews/vocabulary-preview-{plan-opus.json,review.md}`.

## Conditions before production switch

1. Replace the old 500-page full-import limit and eager checksum/load with resumable
   page staging, streaming hashes and database-backed storage of **every** raw term.
   Separate that complete pool from the bounded matching profile.
2. Implement compatible normalized text offsets and preserve original evidence;
   account for existing root-worktree description-template and alias improvements.
3. Give ten-minute delta consumption a durable pinned checkpoint, bounded staging,
   atomic publication and 409 full-resnapshot recovery. Daily full reconciliation
   must not invalidate all matching evidence or continually restart scan cursors.
4. Verify the low-frequency/over-budget terms remain queryable with reasons, and
   new recent terms reach matching/rankings without waiting for three articles.
5. Back up the TS schema before storage/writer changes, validate candidate results,
   then switch atomically with the previous serving version and 24-hour article
   source available as fallback. Do not point the old full importer at this base.
