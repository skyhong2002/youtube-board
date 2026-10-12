# Prewriter source + TS backup adapter

`tools/backup/prewriter-host.sh` is a host-side adapter for the reviewed
multi-schema `consistent-logical.sh`. This document and its local mock tests are
implementation evidence; the executed backup and exceptional recovery are recorded
in `production-prewriter-backup-2026-10-12.md`. Neither is permission to skip the
workflow-specific handoff checks. Root/operator owns approval, transport, execution and recovery.
Do not replace `tools/backup/README.md` or the recurring backup plan with this
one-shot adapter.

## Intended host operation

The target is skyhong-blog's current local Swarm containers for
`youtube-board-db-qcja1i` and `youtube-board-scheduler`. The adapter selects one
running container for each exact Swarm service label. It refuses multiple tasks,
non-shell scheduler PID 1, an already stopped init, nonprivate host storage and
missing any explicit pause, manual-writer-freeze, account-maintenance or
TS-writer-stop acknowledgement.

1. Root prepares a new root-owned mode700 directory under the approved private
   backup destination. Stage the exact reviewed adapter and consistent backup
   script as private files. Verify hashes against the reviewed local files.
2. Reverify current scheduler effective config and image before the window. Use
   the prior `.local/production-cutover/effective-config.py` only under root's
   live-inspection authority; it emits the selected nonsecret Laravel config.
   The adapter itself hashes the full service spec and container config/image
   through a pipe; plaintext env is never saved or printed. These hashes detect
   changes but do not replace the separately protected rollback config.
3. The adapter measures source+TS physical data/index bytes and checks free space
   in DB `/tmp` and the host destination before stopping anything. It requires
   six times aggregate bytes plus2GiB in each location, covering estimated logical
   expansion, archive and host copy even when both paths share a filesystem.
   This is conservative headroom, not a capacity guarantee. Use current measured
   host/container memory limits; historical documentation is not authoritative.
   Confirm frontend acceptance state and active processes; keep all TS recurring
   writers stopped, freeze manual Laravel/TS mutating triggers and deployment
   automation during the window. Root verifies the exact live service/task
   inventory has no TS worker/producer jobs; the adapter does not substitute a
   service-name heuristic for this inspection. Temporarily enable the reviewed
   private account-path maintenance override and verify its503/no-store behavior
   while public report paths remain TS. Drain existing account requests before
   capture; record the exact previous route configuration for immediate restore. Preserve active provider children so they can
   drain. No user account, API key, service image or env is changed by the adapter.
4. Execute the reviewed adapter as host root, using the exact private paths:

   ```bash
   BACKUP_PAUSE_APPROVED=true \
   BACKUP_MANUAL_WRITERS_FROZEN=true \
   BACKUP_ACCOUNTS_MAINTENANCE_CONFIRMED=true \
   BACKUP_TS_WRITERS_STOPPED=true \
   BACKUP_HOST_ROOT=/private/approved-youtube-prewriter \
   BACKUP_TOOL_PATH=/private/reviewed/consistent-logical.sh \
   bash /private/reviewed/prewriter-host.sh --execute
   ```

   These are explicit acknowledgements, not facts auto-discovered by the script.
   With no argument the adapter returns a no-I/O preview.
5. The adapter arms and verifies an independent systemd300s resume timer **before**
   SIGSTOP to only the scheduler's PID 1. Existing children continue running; it
   waits at most45s for every child except the loop's `sleep` to finish.
   Finished zombie children are drained: stopped init cannot reap them. The parser
   accepts the exact optional `<defunct>` suffix only on zombie rows. Running
   or sleeping provider/PHP children still prevent capture. Docker
   process output must have the exact header, numeric unique PIDs, valid process states and precisely
   one stopped original init row with shell command; unexpected/empty output fails closed. An active
   PHP, shell child or provider call prevents the dump and causes immediate resume.
6. The original scheduler container stays in place. A single bounded180s FTWRL
   backup covers `youtube_board` and `youtube_board_ts`, their table engines,
   definitions, counts, triggers/routines/events and the selected source checksums.
   The root DB credential is read only inside the DB container from its existing
   env. The host invokes no SQL itself and stores no credential file.
7. While the bounded dump process runs, the adapter polls its `lock-released`
   marker and requires no `INVALID` marker. As soon as release is proven, CONT
   resumes the exact original container's
   unchanged host init PID. The adapter checks that PID is no longer stopped,
   cancels timer **and service**, compares config/image fingerprints and copies
   the private artifact. It verifies both archive and manifest SHA256 seals.
   `HOST_COMPLETE` requires success and no `WATCHDOG_FIRED` or `HOST_INVALID`.
   An optional `BACKUP_OPERATION_RECORD` names a fresh file in a private mode700
   directory: the adapter writes its exact operation path there. Its
   `CAPTURE_RESUMED` marker is emitted only after verified DB lock release and
   confirmed scheduler resume; failed cleanup never emits it. The account-route
   wrapper uses this notification to restore private routes during compression.
   `HOST_COMPLETE` alone does not establish off-host safety or recoverability.
   Root restores the previous private-path routing after capture/resume (including
   failure recovery), then verifies Google login/session/logout routes recover.
   The adapter never installs or removes account-maintenance routes.

This runs no `docker service update`, no env replacement and no image refresh.
It therefore preserves the retained scheduler image even when the web service
uses a newer image. Docker SIGSTOP is deliberately used instead of `docker pause`:
freezing the entire cgroup would strand an in-flight provider/DB operation.

## Bounded failure handling

The controller takes flock plus a durable `.prewriter-active` lease. A normal
exit resumes first, cancels the old timer and service, confirms each unit has explicit inactive/failed ActiveState and loaded/not-found
LoadState,
then releases the matching lease. STOP, resume and lease release use one shared
short transition lock. STOP rechecks matching lease, unchanged init PID, active
timer and absence of a fired watchdog under that lock, then proves process state
T/t before draining. Capture launch rechecks the same lease, unchanged init,
stopped state and a less-than90s age budget under the transition lock, then
spawns the bounded transport with that lock FD closed. A late controller cannot
STOP or start capture after its watchdog resumed. After controller SIGKILL, the lease
remains, so a second pause cannot race the original watchdog. At300s the detached
systemd service invokes the staged adapter using only private operation files;
it first checks its operation still owns the matching lease under that same
transition lock. A stale watchdog becomes a no-op if a successor owns the lease.
It marks the operation invalid and resumes only when the original container ID
and host init PID still match. Successful resume removes the matching lease.
A replaced/stopped container or failed CONT leaves the lease for root inspection;
it never guesses another container or resumes a different process.

The300s timer is the resume-trigger deadline; individual Docker/process checks
have bounded call time, so do not claim300s is a hard real-time scheduler outage
maximum. The database tool independently bounds its FTWRL at180s and survives
transport/controller death. The host transport is capped at210s. Compression
continues after normal resume, still within the210s transport window;
archive copy/hash verification also happens after resume. Timeout invalidates the
host operation even if the in-container backup later completes.

If `.prewriter-active` remains, **do not delete it or retry blindly**. Inspect
private operation state, exact scheduler container/PID, active timer/service,
database lock-release evidence and partial artifact markers. Resume the verified
original init if necessary, prove the global DB lock is absent, and only then
remove stale operation metadata under a reviewed recovery action. Never clear a
live lock/lease solely to make a new attempt succeed.

## Required acceptance beyond the host adapter

- Immediately recheck Laravel effective gates/allowlist, retained image and a
  subsequent genuine scheduler evaluation; non-stopped PID alone is not a due-job
  or provider-success proof. Preserve both the previous source backup and this
  new source+TS backup.
- Copy the archive, seal, ordered schemas and all manifests to independent
  off-host storage/NAS; verify the bytes at the destination. No `.env`, database
  credential, raw Docker inspect or private diagnostics enters git or chat.
- Restore both schemas into an isolated matching MariaDB runtime. Use the same
  selected checksums and compare22 exact manifest files. Restore/principal tools
  must recreate supported facade/definer accounts without copying production
  passwords. A frontend/worker facade is not included among these two physical
  schemas; reconstruct it using reviewed schema tooling with isolated identities.
- Prove actual facade/app reads and worker startup grants against the restored
  data; manifest equality cannot prove a missing definer is usable. Do not run
  active jobs against the immutable reference restore.
- Record current archive size/hash, both schema table/count evidence, restore
  success and off-host retrieval proof before approving a writer handoff. Source
  rowcounts will legitimately differ from the earlier source-only backup.

Local validation: `bash -n tools/backup/prewriter-host.sh` and
`node --test tools/backup/prewriter-host.test.mjs` cover23 mocked lifecycle cases, including twelve malformed process-list variants,
a real SIGKILL of the mocked controller after CONT but before timer cancellation,
a stale watchdog against a successor lease, watchdog-first late-STOP rejection
revocation of capture when the watchdog fires during drain, completed zombie
children and running/sleeping provider children that must still drain. A never-started
transient service can make `systemctl stop` return1 or5 (the latter observed on the actual host); cancellation is accepted only
after both explicit unit-state checks. Active units, unknown/malformed states,
transport failures and timeouts retain the durable lease.
They validate call ordering, failure cleanup, config drift, durable lease and
exact-PID watchdog behavior, pre-compression resume and disk headroom rejection. They do **not** emulate Docker/systemd signaling,
prove host resource capacity or replace the reviewed local MariaDB backup
rehearsal. No production execution was performed by this implementation task.
