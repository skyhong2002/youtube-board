# Versioned matching quality rollout

This workflow changes only TS vocabulary/evidence state. It neither edits the
maintained tag pool nor writes Laravel source rows. A candidate is a new immutable
published run; `published` alone does not make it the serving vocabulary.

1. Record the current vocabulary ID and implementation commit. Obtain a fresh
   TS backup with an offhost archive and a passed isolated restore. The host
   controller must verify the archive SHA and restore proof before invoking any
   execute command. A previous full source backup remains required by the overall
   cutover plan; this TS-only receipt is not a replacement for it.
2. Run `vocabulary:quality:stage` without `--execute` using the existing vocabulary
   worker environment. Supply `--id=youtube-quality-YYYYMMDD-SUFFIX`,
   `--parent=CURRENT_VERSION`, and `--implementation=FULL_COMMIT_SHA`.
   After review, add `--execute --backup-proof=ABSOLUTE_RECEIPT_PATH
   --backup-sha256=ARCHIVE_SHA256`. Never put database URLs in command arguments.
3. Use the existing recent-matching worker with
   `videos:match:recent --version=CANDIDATE_ID --limit=100 --daily-limit=20000`.
   Preview first, then use its normal `--execute` gates. This keeps a candidate
   checkpoint separate from the serving checkpoint, but shares the same Taipei
   daily budget. Keep the existing 20,000-video operator cap on new candidates
   and date rollovers. A larger CLI limit never raises an already-reserved day's cap.
4. Preview `vocabulary:quality:activate` with the same candidate/parent/commit.
   Set `QUALITY_REPORT_DATABASE_URL` securely to the existing SELECT-only report
   connection. The vocabulary writer keeps its existing narrow write permissions.
   By default the rolling seven-day source window must have at least 500 fresh
   videos, complete coverage, and markers no older than six hours. An operator
   may explicitly set `--min-fresh=N --min-coverage=FRACTION --max-age-hours=N`;
   minimum coverage cannot be below 0.25. A partial activation is reported as
   partial, including its exact denominator, never as complete coverage.
5. After examining before/after ranking, source snippets, latency and coverage,
   repeat activation with `--execute` and the fresh backup proof arguments.
   Save its sanitized result in the deployment record. Activation takes both
   existing vocabulary and video-evidence writer locks, verifies the immutable
   parent/candidate/implementation pair, and changes the serving pointer with an
   expected-parent compare-and-swap. Source ingestion can continue: the reported
   coverage is an observed cutoff, not an atomic MyISAM snapshot guarantee.
6. Roll back using `vocabulary:quality:rollback` with the same identities and
   backup proof arguments. It requires the candidate still be current, validates
   the preserved parent and candidate, and atomically restores the parent pointer.
   It never deletes either version or evidence. A newer unrelated pointer causes
   refusal rather than an overwrite.

All execute paths require the existing `tags.vocabulary.sync` ownership,
production enablement and exact allowlist. These commands do not enable or change
any gates. Report reads retain the five-second SQL deadline; excessive, corrupt,
stale or unavailable coverage fails closed. Backup receipt validation checks the
bounded contract and freshness; it does not independently authenticate the host
controller or perform a restore. Activation and rollback should receive their own
review before production execution.
