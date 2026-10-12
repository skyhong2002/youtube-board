# Presentation data activation — 2026-10-12

This operation adds TS-owned channel-avatar caching, observed vocabulary sync and
recent-video title/description matching. Laravel retains its ingestion, AI and
Telegram schedules. None of these three profiles can mutate Laravel source data.

## Permissions and recovery

Three INVOKER facade schemas use separate principals: `youtube_ts_avatars`,
`youtube_ts_vocabulary`, and `youtube_ts_recent`. Their source access is SELECT
only; TS grants are exact table-level grants from the reviewed workflow profiles.
All three real runtime grant/view probes passed. The public web environment does
not contain these credentials or the tag service token. A separate zero-replica
Dokploy configuration stores them, with no environment attached to its inert
service; its materialized file is root-owned mode 0600.

The existing consistent source+TS backup remains the base; see
[the prewriter recovery proof](production-prewriter-backup-2026-10-12.md).
An additive extension captured before any profile ran contains the three facade
definitions, all five restricted TS principals/grants and the pristine media
manifest state. Credentials are backed up separately with private permissions.
Neither artifact is in Git or model review packets.

- Extension manifest SHA-256:
  `bb2f35c3a11b58de7699b5ecf7bcb1d9941bb8038d376c72331075261265cb5e`.
- Independent offhost bundle: 61,440 bytes, SHA-256
  `98e4664e35eeb17cb42afb16297529d27f6af5898f2a68b318d9aa5e238d9e8f`.
- Encrypted NAS snapshot `3cd45d7d`; actual retrieval at 11:28 UTC verified every
  artifact hash and the protected worker configuration hash.
- Full isolated import order: users → original base → facades → grants.
  Verification completed at 11:33:59 UTC: 12 views, five exact authentication
  definitions and 139 exact grant statements (compared per principal, ignoring
  statement order). Twenty schema/data/DDL/count/checksum manifests match byte
  for byte. Both runtime manifests differ only in the deliberately enlarged
  restore packet limit, 16 MiB → 256 MiB; all other runtime fields match.
- Eleven real MariaDB withdrawal checks passed. Historical rows, other TS tables
  and account state remained unchanged; all synthetic test rows were cleaned.
  Earlier verification failures remain recorded, not relabeled as success.
- Fresh production inspection confirms all 36 TS base tables are InnoDB and the
  seven affected presentation tables were empty before activation.

At 11:25 UTC the recurring NAS job was atomically extended, retaining its prior
file, to include all three facades and the separate worker configuration. Its
principal exporter already includes all `youtube_ts_*` identities. New snapshot
`d0707601` completed at 11:31 UTC. Recurring `--single-transaction` still does not
guarantee MyISAM consistency; this does not replace the sealed consistent base.
Actual retrieval at 11:36 UTC verified all five schemas, five sealed principals,
and both protected frontend/worker environments. The 523,777,941-byte archive has
SHA-256 `9521abaa0eb24c9c44f9a721d9656e5db06a999a583f8ca3a0ab574bad747d42`.
The temporary local restore container was removed after verification; its sealed
archives, manifests and failure history remain available privately.

## Execution boundary

The controller pins image
`sha256:16e4919992cafd66706ed9cfee050cdb222fa9f6af8d132b2701cf763266316d`
and each workflow's exact permissions plan. A host-wide nonblocking lock covers
bootstrap, probe, run and cleanup; actual duplicate lock acquisition was refused.
It complements workflow DB locks and the avatar file lock. Orphan containers
after host failure still require explicit inspection before retry.

First runs are sequential: up to 30 publicly listed channel IDs; one previous
Taipei day's article-tag window, at most 20 pages per resumable invocation;
then 100 recent videos. Matching starts only after the intended vocabulary
version is published. The service token remains secret, requests are serialized
and paced, and HTTP 429 respects Retry-After. This window is explicitly labeled
`observed-article-window`, not a complete canonical vocabulary.

## Narrow rollback

Stop all presentation runners and verify their containers and locks are gone.
Do not roll the production database back to an old backup to undo presentation
data: that would discard intervening account and source writes.

For the first vocabulary publication, the reviewed private withdrawal helper
requires the exact current version and verified absent baseline, takes both
vocabulary and matcher locks, and transactionally removes exactly that current
pointer. It retains versions, evidence, job journals, budget reservations and
accounts. Use an explicitly authorized maintenance identity; do not expand the
worker's ordinary DELETE privileges. Preview first; an uncertain commit requires
inspection before retry.

For avatars, atomically restore the retained original manifest/cursor bytes (or
their recorded absence) after confirming no writer holds the media lock. Keep
new immutable PNG files and journals for investigation; removing the manifest
withdraws their current references, not old cached URLs.

Verify fresh vocabulary and home DTOs return the baseline unavailable state,
then request the public pages through successful ISR regeneration and wait for
their origin/edge cache TTLs to expire. Cached HTML can continue to reference the
prior data during that interval; this is not instantaneous erasure. If immediate
withdrawal is necessary, use the reviewed frontend route rollback and purge only
affected public URLs through the existing Cloudflare operator workflow. Never
weaken CSP or broaden caching to private routes.

## Review

Opus 5.5 reviewed the permissions/recovery plan (complete returned response).
Its recovery-scope, narrow withdrawal, secret storage and engine-verification
requests were adopted. Suspected base principal overwrite and partial-vocabulary
publication were disproved by the actual archive/code and restore tests. Codex
independently reviewed implementation, including the cross-profile lock gap,
which is now fixed. Private review packets and results remain ignored.


## First vocabulary publication and bounded evidence activation

At 2026-10-12 11:58 UTC the complete 2026-10-11 Taipei article window published
as `youtube-first-20261011`: 17,954 observed terms, six source occurrences with
zero-width/edge-space normalization, and one unsupported-control occurrence
quarantined with original text/reason. Both API and rendered keywords disclose
those counts. This is `observed-article-window`, not the full upstream dictionary
or a claim that every tag was journalist-authored. The first 100 matches and
subsequent bounded batches used the isolated TS-only recent worker; by 12:03 UTC
3,100 markers held 181,193 evidence occurrences, with zero source-table writes
and zero external inference/YouTube calls. The daily reservation remains 20,000;
this evidence does not claim full seven-day coverage or scheduled activation.

Production growth exposed a real homepage query timeout: a mixed UTF-8/ASCII
video-ID join could not use the marker primary key. The corrected query retains
byte-exact, source-PK and current-text fingerprint guards, materializes only
fresh date-bounded videos, aggregates narrow term identifiers, then loads labels
for at most 80 ranked results. A SELECT-only test against the report principal
at 3,100 markers measured 688 ms for both ranked windows and 294 ms for coverage;
all 80 ranked rows matched the prior equivalent query. Concurrent Laravel inserts
changed only source/unprocessed counts. Larger batches require new measurements;
the five-second statement ceiling remains unchanged. No source index, schema,
privilege or runtime-budget change is needed. The report principal cannot EXPLAIN
views, as expected; query-plan assertions run on the isolated MariaDB fixture.

The backend-only `7beed19` release was proven to preserve compiled Next artifacts
and runtime configuration byte-for-byte, passed 29 private canary checks, and
changed only the immutable frontend image reference. Public/anonymous responses
retain hash CSP and cacheability, `/auth/me` and `/my` remain private/no-store.
Laravel scheduler identity remained unchanged. Release and rollback manifests,
rendered source-quality evidence and timing results are stored outside Git.
