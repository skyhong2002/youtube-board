# Production cutover backup — 2026-10-12

The operator completed a consistent backup of `youtube_board` on `skyhong-blog` before any TS production schema, account, routing or writer handoff. The existing Laravel scheduler was briefly paused/drained and resumed in the same container; its service definition, image and environment were not changed. Existing backups were retained.

## Artifact and consistency

- Backup directory: `/home/ubuntu/backups/youtube-board-cutover/20261012T044617Z`.
- Completion: **2026-10-12 04:47:14 UTC / 12:47:14 Asia/Taipei**.
- MariaDB: **11.4.13-MariaDB-ubu2404**; **66 base tables**, comprising **48 MyISAM / 18 InnoDB**. No source triggers, routines or events were present.
- Artifact: `database.sql.gz`, **596,386,781 bytes**.
- SHA-256: `2659d5e0b9ca059bb263985d52006b6103e5e425fd72aba53f0f2c4ef12d1d61`.
- A held global read lock covered the dump and source manifests, with independent lock-release and scheduler-resume watchdogs. Completion required the same holder session, successful dump/compression, and explicit lock release. Source data was not modified.
- The first host-wrapper preparation failed before acquiring a DB lock due to Docker process-list formatting. The scheduler resumed safely; the corrected retry completed. This failed preparation is retained in private evidence.
- Off-host working copy: ignored `platform/.local/production-cutover/20261012T044617Z`; independent SHA-256 and gzip integrity checks passed. Raw data, manifests and credentials are not Git artifacts or review packets.

## Restore verification

A fresh disposable MariaDB **11.4.13** container, `yt-cutover-restore-20261012`, imported the entire archive without errors. It had no network during import and no published port; its event scheduler was disabled. Source SQL mode, collation, case handling and packet limit were matched explicitly.

`tools/backup/compare-manifests.py` returned **`manifest-match files=11`**. The exact comparisons cover runtime settings, database definition, all table metadata and DDL, exact row counts for all 66 tables, selected table checksums (`urt_tag`, `urt_channel`, `urt_count`), and trigger/routine/event inventories and definitions. This is an actual full restore, not a dump-only check.

After preserving the matching restore manifests, the disposable clone was attached only to an internal Docker network for report validation. A new TS schema and restricted report/state principals were created in that clone. Twenty-three real-data API checks all returned 200, including empty TS vocabulary/evidence graceful-degradation cases. These local writes do not change the production database or the sealed backup.

## NAS copy and retrieval

A separate encrypted restic repository/job, `youtube-board-cutover-20261012`, stored the sealed artifact in GGSS-NAS `ServiceBackups/youtube-board-cutover-20261012`. Snapshot **`3b58e76e`**, created at **04:49:19 UTC**, completed at **04:50:34 UTC**, retaining 25 files (568.803 MiB). Neither the existing daily repository nor older snapshots were overwritten.

The snapshot was retrieved into a separate host directory using `nas-backup restore`. Restic completed successfully (30 files/directories, 568.803 MiB, 4m23s). A **post-completion SHA-256 check matched the original archive exactly**. An earlier hash taken during preallocation was discarded as invalid evidence; only the completed retrieval is accepted. Both off-host copies and the isolated full restore now satisfy the backup prerequisite.

## Ongoing protection and limits

The existing `nas-backup.timer` daily job continues unchanged. Its `--single-transaction` dump does not guarantee MyISAM consistency; the new sealed-artifact job preserves this cutover snapshot and does not replace that recurring source backup. Recurring consistent backup coverage for both source and TS state still needs to be configured before final writer retirement.

The backup and clone do not authorize restoring old data over production. Preserve accepted source/account changes and external-delivery/quota evidence if a future incident requires reconciliation. Recheck available space and take a fresh consistent backup before any destructive source migration. No production migration, TS account/schema creation, frontend switch or workflow handoff has yet occurred in this record.

## Preserved Laravel images

Read-only host inspection after the restore found that both services reference a mutable `:latest` tag but run different immutable images. Do not force-update the scheduler to the web image as part of frontend-only deployment:

| Service | Running image ID | Additional retained local tag |
| --- | --- | --- |
| Laravel web | `sha256:eabbf4f86cfe740d31354c49648333509d28c098505b7599f151447521bfa8f9` | `youtube-board-cutover-laravel:web-20261012` |
| Laravel scheduler | `sha256:bb5b6d3eae40c80976f0874ebf327d82699d79a2e5dc7258a62fdce6c69e380d` | `youtube-board-cutover-laravel:scheduler-20261012` |

Both services remain at one replica. Creating the extra image tags changed neither container nor service specification. These tags protect operator identification; they are not an off-host image archive. Public routing rollback initially points to the still-running Laravel web service. Any later scheduler deployment must deliberately preserve its original image/configuration as the rollback target.
