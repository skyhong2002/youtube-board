# Bounded full-pool vocabulary preparation — 2026-10-13

This is offline source preparation. No build, production DB connection, import,
serving pointer activation, scheduler change or workflow handoff was performed.
The existing execute policy, allowlist and shared vocabulary writer lock remain.
An eventual explicitly approved execute still publishes according to the existing
newer-generation/current-pointer rule; this document is not that approval.

The importer accepts an explicit full-page cap up to the upstream contract's
20,000 pages / 10,000,000 terms. It stores every original label, exact upstream
identity, raw upstream term object, article count and existing provenance. Source
full-page, aggregate checksum, strict manifest identity, UTF-8 global ordering and
count checks remain. A retry intentionally downloads all pinned pages again;
per-page staging is idempotent and a partial run cannot become current.

When the manifest supplies an active subset, the importer independently verifies
its pinned pages, aggregate checksum, count, unique identities and minimum-length/
non-noise policy. Every active term must occur byte-for-byte in the pinned complete
pool, including optional source evidence. No raw alias is merged or normalized.
Active-only matching is capped at 100,000 raw identities, 2,000,000 trie code units
including its root, and 64 MiB of canonical source/payload bytes. The raw alias count
is the active identity count and shares the 100,000 cap. Active keys occupy at most
6,700,001 JSON bytes. Serialized publication metadata and loader metadata reads
are capped at 16 MiB; full originals never appear in the publication snapshot.

The local full-payload checksum retains the previous canonical contract:
JSON parse/stringify plus LF, ordered by local `term_key`. It is computed using
500-row keyset pages, with no whole-pool SELECT or concatenated full-pool buffer.
This verification and active stored-payload verification finish under writer
ownership before the short publication transaction acquires run/current locks.
Stored payload identity and source evidence are revalidated. Advisory writer
ownership protects staged rows during verification; the full local checksum
records canonical stored bytes and is not a second independently reconstructed
upstream aggregate. Writers must honor the shared lock. Active stored bytes are
also checked against their expected source-derived payload fingerprints.
Ownership is checked throughout and immediately before publication; locked run
identity/status and stored count are checked again. The execute wrapper paces
page/checksum batches with 100 ms waits; the helper accepts an injected wait for
mock tests. Publication keeps the existing equal-timestamp/current behavior.

The publication retains full-pool `coverage`, `termCount`, source manifest and
upstream/full-local checksum evidence. `matchingSubset` separately identifies
`upstream-active-v1`, the upstream active policy/count/checksum, sorted raw local
keys and an independent checksum of active local payloads. This separation matters:
the source pool is complete, while the returned matcher `terms` are the active
subset only. The active subset is not a complete canonical vocabulary.

Normal matching loads only those keys, in IN-query chunks of at most 500, and
verifies ordered identities, count, retained upstream evidence and active local
checksum. It does not rescan millions of inactive payloads on each job. Full-pool
checksum reconciliation remains a separate future explicitly scheduled workflow;
an inactive-row mutation is not detected by an active-only load. Earlier small
full exports lacking active metadata retain their bounded full-load/checksum path;
large exports without an active subset fail closed instead of selecting an
unusable full matching pool. Existing embedded window snapshots are unaffected.

Activation still requires reviewed ownership, continuous generation/sync and
reconciliation plans, protected backups, operator approval and runtime acceptance.
In particular, the intended 10-minute changes polling and daily full reconciliation
schedules are absent. Newly eligible delta terms cannot enter this pinned active
subset until a reviewed delta/refresh path is implemented. Full matching sweeps,
coverage/checkpoint handling and scheduler ownership must be reviewed separately.
Vocabulary UI/API explanations for inactive low-frequency or budget-excluded terms
remain absent; no schema membership flag was introduced by this preparation.

Production matching currently folds ASCII only. U+200B and fullwidth source labels
retain their raw keys here and do not automatically match normalized counterparts.
`vocabulary-normalization.ts` remains a preview; this implementation never calls
its builder. A versioned production normalization rule requires retained raw
identity aliases, original-text offset mapping and provenance/evidence acceptance
before activation. This preparation claims none of those acceptance results.

Offline validation uses only mock/pure tests with DB opt-ins disabled. Tests cover
streaming checksum compatibility, original provenance, a complete pool above the
trie budget, active-only query bounds, source/active evidence mismatch, missing or
tampered active payloads, empty subsets, raw aliases, legacy compatibility,
metadata/active caps, ownership loss and scans finishing before publication locks.

Validation on 2026-10-13: jobs TypeScript `--noEmit` passed; the six focused
Vitest files (`snapshot-import-bounded`, `snapshot-import`, `snapshot-client`,
`vocabulary-quality`, `vocabulary-normalization`, `vocabulary-preview`) passed
44 tests, with the one real-DB import test explicitly skipped. `git diff --check`
passed. No DB acceptance or production capacity claim is made.
