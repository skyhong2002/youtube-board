# Recurring consistent backup runbook

**Status: multi-schema controller implemented and rehearsed locally; recurrence
not installed or executed in production.** This is a prerequisite for final
retirement of Laravel writers. The [verified cutover backup](production-backup-2026-10-12.md)
protects the original source snapshot. The existing `nas-backup.timer` remains
unchanged; its `--single-transaction` dump cannot guarantee MyISAM consistency.
Keep that job and its retained snapshots until a replacement has passed the
acceptance checks below.

## Required implementation before scheduling

`tools/backup/consistent-logical.sh` accepts repeated `--database` options.
It extends the existing external FTWRL holder and independent watchdog; it does
not move lock ownership into mariadb-dump. One dump invocation includes source,
TS state and optional facade schemas while the same holder also protects all
eleven manifests per schema. Schema inventory/order, manifest hashes, UTC lock
markers and archive hash accompany the sealed artifact. See
[controller usage](../tools/backup/README.md).

```bash
# Illustrative physical schema names; confirm actual names/dependencies first.
bash tools/backup/consistent-logical.sh --execute \
  --database=youtube_board --database=youtube_board_ts \
  --database=youtube_board_worker --output=/private/fresh-combined-snapshot \
  --max-seconds=180 --lock-wait-seconds=5
```

Credentials come only from `MYSQL_PWD` or a protected `BACKUP_DEFAULTS_FILE`.
The script invokes one `mariadb-dump --databases ... --skip-lock-tables` while
its separate monitored connection holds FTWRL. Do not add `--lock-all-tables`
or `--single-transaction`: either would confuse this explicitly external lock
lifecycle. All manifests finish before release; raw dump compression, hash and
seal work follow verified holder disappearance. Every schema must be present;
partial dumps or manifest errors invalidate the whole recovery set.

Repeated runs share a nonblocking host flock (`BACKUP_LOCK_FILE`, default
`/run/lock/youtube-board-consistent-backup.lock`). The watchdog retains it after
controller death through its deadline/release check, preventing an overlapping
capture. Maintenance must adopt the same lock path. The controller still does
not pause/resume application writers, install NAS hooks, schedule a timer or
assert an available disk-space budget: those host-adapter steps require measured
runtime owners, local review and production approval before recurrence.

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

The local rehearsal covers a mixed-engine two-physical-schema fixture and a
third facade schema, concurrent single-statement cross-schema updates, all 33
restored manifests, archive/manifest hashes, overlap rejection, later-schema
manifest failure, invalid checksum, deadline, controller SIGKILL and lost Docker
transport. Additional failure proofs cover overlap rejection after controller
death, watchdog expiry after UNLOCK but before the release marker, and a missing
facade DEFINER making an actual restored view read fail despite matching logical
manifests. Restore principal identities and grants from protected recovery
configuration and test live view reads; a manifest match is insufficient. Run `bash tools/backup/rehearse-local.sh /tmp/fresh-unique-result` after
controller changes and retain private results. This is local protocol evidence,
not production pause/drain, capacity, throughput or NAS-hook validation. Then complete one approved production capture, NAS retrieval and full
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
