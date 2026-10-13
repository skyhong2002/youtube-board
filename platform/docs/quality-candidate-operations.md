# Versioned matching quality rollout

This workflow changes only TS vocabulary/evidence state. It does not edit the
maintained tag pool or Laravel source rows. `published` makes a candidate readable;
only `ts_vocabulary_current` selects the serving version.

## Current release boundary

The first public F2 release is read-only. Existing workers remain pinned to their
reviewed v1 image. No quality operator account, production grants, gates, candidate
worker schedule or pointer activation is enabled by this code or its tests.

**Activation remains blocked pending a vocabulary-sync ownership plan.** The normal
`tags.vocabulary.sync` publisher can replace a quality candidate with a new v1 run.
Before activation, the operator must define and approve a bounded sync pause,
verify no sync writer is active, and define how subsequent new tag generations
preserve the quality rule. Simply resuming the old publisher would leave the
candidate and make its rollback CAS refuse. Do not silently freeze new tags or
present a temporary activation as the completed continuous pipeline.

## Preparation and least privilege

1. Record current vocabulary ID and reviewed implementation commit. Obtain a fresh
   TS backup, verify its offhost archive SHA, and complete isolated restore checks.
   Preserve the existing full source backup; the TS receipt does not replace it.
2. Provision the dedicated `tags.vocabulary.quality` operator facade only after
   explicit execution authorization. Its profile adds `ts_job_runs` SELECT/INSERT
   to the vocabulary sync profile; it cannot update/delete audits or write video
   evidence. Normal sync grants remain unchanged. Set `TS_WORKER_WORKFLOW` to this
   profile and retain the database host pin and exact facade grant verification.
3. Keep the existing `tags.vocabulary.sync` ownership/gate and additionally allow
   only the requested action: `tags.vocabulary.quality-stage`,
   `tags.vocabulary.quality-activate`, or `tags.vocabulary.quality-rollback`.
   Activation also requires the rollback gate to be ready. No command changes gates.
4. Configure `QUALITY_REPORT_DATABASE_URL` securely for a separate SELECT-only
   account. It must resolve the TS state's `urt_video` source view and
   `ts_video_tag_matches`/`ts_video_tag_evidence`; an INVOKER source view also needs
   SELECT on its backing source table. The reader verifies live server identity,
   exact state schema, explicitly allowed schemas, direct read-only grants, empty
   PUBLIC/role grants, and a read-only session. Global/system-schema reads fail.
   Never put database URLs in command arguments, review packets or logs.

The backup proof must be an absolute regular non-symlink file at most1MiB, with
recent mtime, a content `capturedAt` no older than6hours, `database`, and
`targetServer:{host,server_id,port}` matching the live writer's state target. It
also includes the completed restore contract and exact archive SHA. If target
identity was observed after the backup, record that observation's separate time
and provenance; do not claim it was captured during the export. The receipt is
operator-controlled evidence, not an independent attestation or execution grant.

## Candidate and coverage

1. Preview `vocabulary:quality:stage` with
   `--id=youtube-quality-YYYYMMDD-SUFFIX --parent=CURRENT_VERSION
   --implementation=FULL_COMMIT_SHA`. The implementation SHA is an operator
   declaration; independently verify the deployed image/commit. After review and
   authorization, add `--execute --backup-proof=ABSOLUTE_RECEIPT_PATH
   --backup-sha256=ARCHIVE_SHA256`. Stage preserves every embedded source term and
   never changes the serving pointer. Retries reuse the original preparation time.
2. Preview the separate evidence worker with
   `videos:match:recent --version=CANDIDATE_ID --limit=100 --daily-limit=20000`.
   Keep it manual and unscheduled. Candidate and serving checkpoints are separate,
   but share the immutable Taipei daily reservation cap. Raising a later CLI limit
   cannot raise an already reserved day's cap. Require a fresh verified backup and
   explicit authorization before candidate evidence writes as well.
3. Inspect `qualityPreview`: per-channel and per-video failure reasons, successful
   audit bytes total/p50/p95/max, oversized count, and selected worst-case bytes.
   Audits are capped at256KiB each. Template samples are bounded to20/channel,
   with8 required for repeated-line suppression; oversized samples are not silently
   truncated. The fixed anchor is retained in the profile proof.
4. A profile failure share or profile/audit failure video share above25% returns
   `quality-preflight-threshold` before any budget/checkpoint/evidence write.
   Malformed source identities retain bounded skip/advance behavior. A permanent
   sample failure can keep the candidate at the same cursor. Do not hand-edit a
   cursor, checkpoint, matched timestamp or coverage threshold to bypass it:
   prepare a reviewed new candidate or fix the matcher and repeat review. Smaller
   batches are not a guaranteed remedy. Worker scheduling stays disabled.
5. Preview `vocabulary:quality:activate` with the same candidate/parent/commit.
   Defaults require500 fresh videos, full coverage of the observed rolling7-day
   source window, and verification within6hours. Explicit bounded options are
   `--min-fresh=N --min-coverage=FRACTION --max-age-hours=N`; coverage cannot be
   below0.25. A partial activation records its exact denominator and
   `scope:rolling-7d-observed`; it is not full-dataset coverage or a MyISAM snapshot.
6. Only after the sync ownership blocker is resolved, source snippets/rankings,
   source view mapping, latency and coverage are reviewed, repeat activation with
   execute and fresh proof arguments. Activation takes vocabulary and evidence
   locks, verifies the immutable pair, and uses expected-parent CAS. Five-second
   SQL deadlines and bounded result counts fail closed. Source ingestion may
   continue, so coverage describes the observed cutoff.

Stage and pointer changes append an audit within the same transaction. Activation
records coverage scalars and receipt hash; an audit failure rolls back the pointer.
An unchanged evidence rerun explicitly refreshes its verification timestamp. Older
source duplicates cannot overwrite a newer complete or unavailable marker/audit.

## Rollback

Run `vocabulary:quality:rollback` with the same candidate/parent identities and
`--execute`. It requires its normal enablement/ownership/action gates but **no new
backup receipt**. It waits at most10seconds for the vocabulary lock and does not
need the evidence lock: workers retain their already selected immutable version.
It verifies the stored parent SHA instead of today's matcher budget, locks and
CAS-updates the pointer, and appends its audit atomically. It never deletes a
version or evidence. A newer unrelated pointer makes it refuse instead of overwrite.

## Isolated verification

`jobs/test/quality-operator-db.test.ts` is opt-in and only accepts loopback ports
23306/23316. Its random schemas/principals are removed afterward. The reviewed
bootstrap creates the exact facade profile and separate report account. Tests
cover stage retry audits, real source-view coverage, activation audit, receipt-free
rollback while the evidence lock is held, SELECT-only `FOR UPDATE`, grant
revocation with no partial state, forbidden audit/evidence writes, overbroad reader
grants, and the10-second lock bound. MariaDB11.4.13, matching the production backup
version, passed. Separate regression tests store exactly262144 audit bytes and
reject262145 with transaction rollback, and verify UTC/Taipei timestamp behavior
and nonempty Unicode/CRLF source hashes. Evidence and redacted grants live in the
ignored `.local/f2/` review directory; tests do not authorize production operations.
