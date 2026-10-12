# Shared vocabulary: local contract and release handoff

The producer was released by the tag maintainer on 2026-10-12. The published
base `e8a99a56-3008-4da8-86c6-64d1ff468b3f` contains 4,733,073 exact source terms,
with a 44,852-term active subset. The read-only downstream preview is documented
in [live preview acceptance](vocabulary-preview-2026-10-13.md).

**Do not execute the old full import against this base yet.** The HTTP adapter now
understands the released large manifest/active/changes contract, but the legacy
full importer still has a 500-page ceiling and eager all-term checksum/hydration.
The preview does not publish a DB snapshot or change the serving vocabulary.

The sections below retain the earlier synthetic producer/consumer handoff as
historical evidence; they do not describe the current upstream release status.

The producer covers **all current indexed article tags**, including native article
keywords, edits and rule-derived tags. It excludes archived articles outside the
current index and does not establish per-term journalist attribution. Term identity
is SHA-256 of the exact UTF-8 label; renamed labels are new IDs. No editorial alias,
merge, deletion or journalist assignment is invented.

## Reproduce the actual producer/consumer contract

Start the isolated platform MariaDB and initialize `youtube_board_test_rewrite`
using the documented integration lane, then run from `platform/`:

```sh
node --import tsx tools/verify-vocabulary-contract.mjs --upstream=/path/to/tag-vocabulary-export
```

This opt-in cross-repository check loads the real upstream snapshot publisher and
Fastify route registration, passes injected HTTP responses through the real
`HttpSnapshotSource`, and publishes into the real isolated test database. It uses
506 synthetic labels over two pages, including case-distinct and composed/decomposed
Unicode forms. It verifies page mutation rejection, partial-stage retry, version
pinning, removal/history preservation and empty snapshots. The upstream-only
change endpoint is also checked for skipped-generation rejection; the importer
currently consumes full snapshots, not incremental changes.

No external HTTP is performed by the transport. The DB destination and disposable
credentials are fixed in the test tool; runtime env is not inherited. It takes the
same integration-lane and vocabulary writer locks, restores the previous vocabulary
pointer, and deletes only its own runs. Successful output is emitted after cleanup.
The output fingerprints the exact upstream/downstream source files, including dirty
uncommitted implementation files; a Git HEAD alone would not identify this candidate.

2026-10-12 local result: 506 terms, three generations, 22 injected HTTP requests,
all assertions passed and cleanup completed. Actual Opus 5.5 review prompted added
transport corruption and partial-stage cases and more precise evidence labels.
This is synthetic interoperability evidence, not production-data acceptance.

## Concrete upstream release candidate

Review the worktree's API registration, `app/src/vocabulary/snapshots.ts`,
`tools/vocabulary-export.ts`, OpenAPI changes, tests and `docs/vocabulary-export.md`.
Exclude `node_modules`, credentials, generated snapshots and local artifacts.
The export API only reads immutable files; HTTP never performs a full DB aggregate.

Required operator configuration before the first export:

- `TAG_DB_URL`: a read-only account for the existing InnoDB article/tag tables.
- `TAG_VOCABULARY_EXPORT_DIR`: a persistent private volume shared by publisher/API,
  owned by the same controlled runtime user (files are 0600).
- `TAG_VOCABULARY_EXPORT_ENABLED=true` only for the approved publisher invocation.

First run the CLI preview (`node tools/vocabulary-export.ts`). After source-query
load and the persistent volume are approved, run the same command with `--execute`.
No schedule is installed by this change. Check the generated manifest, page/full
checksums, source counts and resource impact before authorizing any recurring export.
A full snapshot may be empty only when the actual source query successfully returns
no current indexed terms; DB exceptions must remain failures, not empty snapshots.

Only after that endpoint is released should the downstream operator run
`vocabulary:import --max-pages=N` preview, choosing N for the published manifest
(up to 500 pages). Execute requires `tags.vocabulary.import` ownership and the normal
production gate/allowlist. Both window sync and full import share one writer lock.
The matching budget can reject a valid but oversized upstream dictionary; rejection
leaves staged rows unpublished and the previous local version current.

Rollback: disable export invocation and remove API export-directory configuration
(HTTP503), keeping immutable historical files. Stop downstream import/matching jobs
before an ownership rollback. Existing published local versions and historical
video evidence remain readable; do not delete evidence to revert a deployment.
Production release, env changes, data inspection and workflow ownership transfer
still require the existing explicit operator approval.
