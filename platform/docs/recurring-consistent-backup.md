# Recurring consistent backup runbook

**Status: proposed, not installed or executed.** This is a prerequisite for final
retirement of Laravel writers. The [verified cutover backup](production-backup-2026-10-12.md)
protects the original source snapshot. The existing `nas-backup.timer` remains
unchanged; its `--single-transaction` dump cannot guarantee MyISAM consistency.
Keep that job and its retained snapshots until a replacement has passed the
acceptance checks below.

## Required implementation before scheduling

`tools/backup/consistent-logical.sh` currently accepts **one schema only**. It
holds FTWRL in a separate monitored connection and dumps with
`--skip-lock-tables`. Running it twice does **not** create one consistent point
for source and TS state. A reviewed multi-schema controller/host adapter and
local failure rehearsal are still required; this document does not add them.

The target is one dump invocation covering both physical schemas under one
global read lock. The command shape, to be invoked only by that bounded
controller, is:

```bash
mariadb-dump --defaults-extra-file=/run/secrets/youtube-backup.cnf \
  --lock-all-tables --quick --hex-blob --routines --events --triggers \
  --skip-add-locks --skip-comments --no-tablespaces \
  --databases youtube_board youtube_board_ts > database.sql.partial
```

Use a private, fresh output directory (`umask 077`); the credential path above
is a proposed protected mount, not a claim about an existing host file. Do not
combine this with `--single-transaction` or separate per-schema dump commands.
Include any deployed worker-facade schema definitions in the same recovery set;
its views do not contain a second copy of source/state data. Inventory actual
schema names and cross-schema dependencies before implementation.

Unlike the current tool, `--lock-all-tables` makes the **dump connection** own
the lock. Its watchdog must positively identify that connection and prove it
has gone after termination; copying the current holder-session KILL logic is
insufficient. It must also capture each schema's eleven comparison manifests
under the same lock before release. A dump that releases its own lock before
manifest collection does not meet that requirement. Resolve and rehearse this
lifecycle in the adapter before scheduling; manifests collected after writers
resume are not the backup baseline. An alternative reviewed extension of the
existing external FTWRL design can meet the consistency requirement, but must
explicitly document its different lock ownership and use a single multi-schema
dump while holding that lock.

## Execution window and failure release

1. Inventory all clients and schemas on the MariaDB instance: a global lock also
   blocks unrelated applications' writes. Avoid deployments/DDL, provider polling
   peaks and the existing NAS job. Measure the combined dump and manifest work
   on a restored clone before proposing a production window.
2. Acquire one host `flock` shared by backup and incompatible maintenance paths.
   Do not overlap runs or replay a backlog of missed timer ticks. Verify storage,
   DB connectivity, the independent DB watchdog and scheduler-resume safeguard
   before pausing any writer. Record only non-secret service IDs, image IDs,
   enabled states and timestamps.
3. Stop new triggers and drain active work. Preserve each current owner's exact
   configuration. The confirmed Laravel shell schedule loop can be paused while
   its PHP children drain; this is not a generic procedure for TS workers. For
   TS, pause producers and use their cooperative consumer shutdown; never freeze
   an active provider call. Pause manual/ops triggers and account/editorial writes
   as needed, with a temporary maintenance response. Reads remain available
   subject to actual DB lock behavior.
4. Proposed initial limits are **60 seconds to drain**, **5 seconds to acquire
   the global lock**, and **180 seconds from arming the DB deadline to release**.
   An independent **300-second host resume safeguard** bounds the Laravel pause
   in the current operating model. These are starting limits, not measured
   combined-schema performance or a TS drain allowance. Abort before locking if
   draining exceeds its bound; do not extend limits automatically. Use the
   existing 240-second TS cooperative drain only in a separately sized pause
   window with a verified recovery procedure.
5. Arm an independent watchdog before lock acquisition. It must survive controller
   death/transport loss, invalidate the artifact before killing the identified
   DB session, kill the dump process group safely and verify lock/session release.
   Bound lock acquisition separately. A shell timeout, successful client exit
   or disconnected SSH session alone is not proof of release.
6. After successful dump and same-snapshot manifests, explicitly prove release
   and restore prior trigger/consumer state immediately. Do not wait for upload,
   compression or restore validation to resume scheduling. On failure, mark
   `INVALID`, remove any `COMPLETE` marker, retain diagnostics privately and
   alert; keep the independent release/resume safeguards until their conditions
   are proven. A DB/host outage can prevent release proof and requires operator
   inspection, not a claim of an absolute guaranteed lock duration.

Do not force-update the Laravel scheduler image as a backup action. Its effective
ingestion and Telegram gates are active; the web configuration differs. Consult
the [runtime baseline](laravel-runtime-baseline-2026-10-12.md) and recheck actual
owners immediately before each run. Restoring triggers after a pause must never
activate both Laravel and TS for a transferred workflow.

## Seal, copy and retain

Dump to fast local storage if capacity permits, then compress **after release**;
piping compression during the dump can prolong its lock through backpressure.
Reserve measured uncompressed source plus state size, compressed artifact size,
working manifests and a safety margin. Keep the last good backup while writing
the new one. Restores require an additional isolated database volume; do not run
a resource-heavy drill inside the production DB's 1 GB memory allocation. Upload
and compression should have measured CPU/I/O limits that preserve report latency.

After release, validate compression, compute SHA-256, flush and atomically seal
the artifact with `COMPLETE` and no `INVALID`. Record both schema names, server
version/settings, lock start/end, manifest identities and dump hash. Include
protected recovery configuration for required DEFINER/principal identities;
the logical dump intentionally does not export passwords or MariaDB system
tables. Never put raw dumps, manifests or credential files in Git/review packets.

Reuse **`nas-backup` and its encrypted restic storage on GGSS-NAS** to upload the
sealed directory as files, following the already verified cutover-artifact job.
Do not wrap the old single-transaction source dump and label it consistent. The
exact recurring job/hook interface must be verified locally before installation;
it is not specified by repository evidence. Use a separate recurring-artifact
job/repository, preserving `youtube-board-cutover-20261012` and snapshot `3b58e76e`.
Record the completed NAS snapshot ID, retrieve into a different directory with
`nas-backup restore`, wait for successful completion, then verify the archive
hash. Hashing a partially retrieved/preallocated file is not acceptance evidence.

Proposed policy for operator approval: one nightly consistent snapshot, keep
7 daily / 4 weekly / 6 monthly off-host restore points, and 2 verified local
artifacts when capacity permits. This targets a 24-hour database RPO; it does
not establish an RTO. Alert when no valid off-host snapshot exists within
26 hours, and on any failed lock release, resume or upload. Do not prune the
last verified recovery point, an unverified run's predecessor, or the dedicated
cutover snapshot. Apply retention only to the new job after a verified upload;
this proposal does not change existing NAS retention.

## Restore drill and acceptance

Before enabling recurrence, run the new controller on a local mixed-engine,
two-schema fixture with concurrent cross-schema writes. Verify coherent source
and state, and release/invalidation after deadline, controller SIGKILL and lost
transport. Then complete one approved production capture, NAS retrieval and full
isolated restore. Keep recurrence and final writer retirement pending until this
evidence exists.

Restore monthly and after backup-tool/schema changes into a fresh isolated
MariaDB matching the captured version and runtime settings, with event scheduler,
providers, schedulers, consumers and external delivery disabled; no public ports.
Restore source before TS state/dependent views, preserving names and verified
DEFINER identities. Recreate privileges from protected recovery configuration;
do not grant application accounts blanket privileges to make a restore pass.
Compare all eleven manifests per physical schema with
`tools/backup/compare-manifests.py`, including full row counts, DDL, triggers,
routines/events and selected checksums. Counts/checksums are not a full row-byte
hash. Test report reads and account/state integrity, and record measured total
recovery time, artifact age and resource use without exposing data.

Include Laravel DB cache/locks and Telegram dedup/history, TS checkpoints,
journals, quota ledgers, account/editorial/audit state in coverage checks. Capture
any required file cache, media files/manifest/cursor, and Redis AOF separately
during a coordinated pause, or explicitly document rebuild/discard behavior;
the SQL dump alone does not cover them. Never blindly replay restored queues:
reconcile provider quota, in-flight jobs and Telegram/external delivery evidence
before enabling a single workflow owner. A successful drill authorizes neither
restoring over production nor discarding accepted changes since the snapshot.

If rollout fails, disable only the new recurring timer/job and preserve all
artifacts and the original NAS job. Revert any temporary pause to the exact prior
owner state. Diagnose failures on an isolated restore; do not repair consistency
by manually editing production rows.
