# Source and TS recovery proof — 2026-10-12

A new consistent mixed-engine backup covers `youtube_board` and
`youtube_board_ts`, including TS accounts, sessions, reader state and audit.
The original source-only cutover backup and all prior NAS snapshots are retained.
No background workflow ownership changed during this operation.

## Accepted artifacts

- Host operation: `/home/ubuntu/backups/youtube-board-prewriter/20261012T092017Z-1129291`.
- Archive: `snapshot/database.sql.gz`, **597,107,386 bytes**.
- SHA-256: `a3e58238ceae50d808f21836c73140956bf452c22e7c0f343498f94348f34205`.
- Off-host copy: private `platform/.local/production-cutover/prewriter/20261012T092017Z-1129291` on skyhong-SM.
- Encrypted GGSS-NAS job `youtube-board-prewriter-20261012`, snapshot **23eee332**,
  saved at **09:31:22 UTC**. Completed retrieval restored 58 files/directories,
  569.572 MiB; post-completion archive and principal seals match.
- Protected principal exports include the two `youtube_ts_*` accounts and 112
  grants. Before/after exports match. Recovery SQL contains authentication
  material and is excluded from Git, logs and model review packets.

The dump and exact manifests were captured under the same held global read lock;
the backup core has `COMPLETE` and no `INVALID`. Scheduler writes and account
requests were drained for capture, then resumed. Exact normal routing and the
original scheduler container/image were verified afterward.

## Full restore and restricted connections

An isolated MariaDB 11.4.13 imported CREATE USER, the entire archive and original
GRANTS. Its event scheduler was disabled, with no published port. All **22 exact
manifests across both schemas** match: definitions, tables/views, exact row counts,
selected source checksums and trigger/routine/event inventories.

The clone then joined a dedicated internal network reproducing the original DB
host restriction. **65/65 actual credential checks passed**: report views readable,
private state denied to the report account, necessary state reads available, and
source writes denied to both accounts through base schema and facade. Denials
were privilege errors, not missing-table errors. No production SQL or source
mutation occurred in this proof. Credentials were held only in memory.

Private evidence: `prewriter/{manifest-comparison.log,principal-access-proof.json,
nas-retrieval-verification.json}` under `.local/production-cutover/`.

## Exceptional host recovery

This was **not a clean host-wrapper success**. The first attempt stopped before
capture because an active Laravel child did not drain within 45 seconds. The
second captured a valid core backup, but watchdog cleanup rejected systemd's
exit status 5 for an absent transient unit. Host/route wrappers retained their
invalid markers and durable leases; compression finished independently.

The operator explicitly verified no held DB lock, inactive watchdogs, resumed
original scheduler, exact restored routing, unchanged principal exports, archive
seals and the full restore before clearing the stale leases under their locks.
`HOST_INVALID`/`WINDOW_INVALID` evidence remains; it was not relabeled success.
The corrected adapter accepts known stop statuses only when subsequent bounded
per-unit LoadState/ActiveState checks prove inactivity. Its 23 tests pass. A new
outage was unnecessary after independent recovery verification.

## Ongoing backup and resource limits

This sealed snapshot protects the present state, not future account writes.
At **09:47 UTC** the recurring job was atomically extended after a timestamped
original backup to source + TS + restricted principals + the TS runtime
environment. Snapshot **ca27cf55** completed at **09:50 UTC**; actual NAS retrieval
restored 25 files/directories (499.300 MiB), including the TS environment and
sealed principal exports. The 523,534,041-byte dump SHA-256 is
`1adc4a88340513a96b44163f58ebeda9e79a3690fd5a63126a68947d7afa3628`;
its off-host copy matches. A second isolated MariaDB imported users, the complete
dump and grants successfully at **10:00 UTC**: 66 source tables, 36 TS tables,
36 source facade views, two restricted DB principals, one account and two
sessions. Source channel/video row counts were 3,889 / 672,260. Private evidence:
`nightly-ts-{run,restore}.log`, `nightly-ts-restore-proof.json`.

This closes recurring TS account/secret/grant coverage for the currently
provisioned frontend. Any later worker facade schema must be added to the
backup/recovery scope before its workflow runs. The recurring job's
`--single-transaction` mode does not guarantee MyISAM consistency; a fresh
consistent capture remains required before destructive migrations/writer handoff.

Heavy local restores/builds/copies run serially at nice 19 / idle IO priority;
restore containers have CPU/memory limits. Remove temporary clones after their
proofs while retaining sealed archives and manifests. Never restore this snapshot
over production without reconciling subsequent source, account and external
delivery/quota changes.
