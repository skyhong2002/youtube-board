# Bounded mixed-engine logical backup

`consistent-logical.sh` is an opt-in Linux/MariaDB controller, not a scheduled job.
Preview is the default and performs no I/O. Repeated `--database` options capture
source, TS state and optional worker-facade schemas together (at most eight,
unique, non-system schemas; dependency order is preserved). The caller must separately obtain
production approval, pause competing scheduled writers and arrange an independent
scheduler-resume watchdog. The tool never changes scheduler ownership.

```bash
bash consistent-logical.sh --preview
# Credentials are inherited via MYSQL_PWD or a private BACKUP_DEFAULTS_FILE.
BACKUP_CHECKSUM_TABLES=urt_tag,urt_channel,urt_count bash consistent-logical.sh \
  --execute --database=youtube_board --output=/private/fresh-backup-directory \
  --max-seconds=180 --lock-wait-seconds=5
```

For a combined recovery set, use one invocation, source schemas before their
dependent state/facade views:

```bash
BACKUP_CHECKSUM_TABLES=youtube_board.urt_channel,youtube_board_ts.ts_users \
  bash consistent-logical.sh --execute \
  --database=youtube_board --database=youtube_board_ts \
  --database=youtube_board_worker --output=/private/fresh-combined-backup \
  --max-seconds=180 --lock-wait-seconds=5
```

These are illustrative names; inventory deployed schemas and checksum tables
first. Multi-schema checksum selections require `schema.table`; unknown schemas
and missing/NULL table checksums fail closed. No system schema or credentials
are included. `--manifest` accepts the same ordered schema arguments for an
isolated restored server.

The output directory must not exist. Files are private (umask 077); do not publish
its SQL, manifests or diagnostic logs. `BACKUP_DB_USER` defaults to root; optional
`BACKUP_DB_HOST`/`BACKUP_DB_PORT` select TCP. A separate persistent, non-reconnecting
session holds FTWRL. An independent detached watchdog marks the artifact invalid,
uses a unique advisory-lock owner to safely identify and KILL the holder, checks
processlist and terminates the dump process group. The deadline starts before
FTWRL acquisition. All eleven manifests for every schema and one multi-schema
`mariadb-dump --databases ... --skip-lock-tables` invocation execute under that
same external lock. Do not add `--lock-all-tables` or `--single-transaction` to
the dump: the monitored holder, not the dump client, owns consistency. Acquisition also has its own bounded wait. Normal cleanup also
verifies that the holder is gone; a successful dump must answer a same-session
sentinel before releasing the lock. Client/SSH death is not treated as proof of
lock release.

Execute also takes a nonblocking shared host `flock` at
`/run/lock/youtube-board-consistent-backup.lock` (override with a private absolute
`BACKUP_LOCK_FILE`). Maintenance paths must use the same file; do not unlink it.
The detached watchdog retains the file lock after controller death until its
bounded release check completes. Its sleep subprocess and dump/holder processes
do not retain stray lock descriptors. Runs are never queued. This is not a
scheduler pause/resume adapter: the caller still owns drain/resume and an
independent host recovery safeguard, and must preserve exact workflow ownership.

A successful artifact has `COMPLETE`, no `INVALID`, a valid `archive.sha256`, and
`database.sql.gz`. The one dump writes uncompressed `database.sql.part`; compression begins only
after holder-session disappearance is proven. Reserve room for both raw and
compressed artifacts. Gzip validation and an atomic archive rename precede
publication; Linux `sync -f` flushes the filesystem before and after publishing
`COMPLETE`. Copies still require independent hash validation and restore tests.
A watchdog or connection failure invalidates the run; never reuse or promote it.
`schemas.tsv` records the ordered recovery set. Single-schema artifacts retain
flat manifests; multi-schema artifacts store each eleven-file set under
`manifests/<schema>/`. `manifests.sha256` seals their hashes with the schema list;
validate it as well as `archive.sha256` after copy. Lock acquisition/release UTC
timestamps are in their marker files. Raw SQL is removed only after compression
validation; partial/failed private files remain for diagnosis, never upload them.
The watchdog needs independent SQL connectivity and KILL permission. Database or
host failure can prevent proof of lock release; a missing/unknown remaining count
is a failure requiring operator inspection, not a safe backup.

Restore into a **fresh isolated container**, with the same MariaDB version and
runtime settings in `runtime.tsv`, event_scheduler OFF, and no network or exposed
ports. Preserve the schema name. Do not restore over an existing database. Roles,
passwords and system tables are deliberately not exported: identify application
DEFINER accounts separately without exporting their secrets. Run the restored
manifest and compare:

```bash
bash consistent-logical.sh --manifest --database=youtube_board \
  --output=/private/fresh-restored-manifest
python3 compare-manifests.py /private/source /private/fresh-restored-manifest
```

Use the same `BACKUP_CHECKSUM_TABLES` on both sides. Comparison is exact across
runtime settings, schema definition, engine/collation/AUTO_INCREMENT, all table
counts, full table/view DDL, triggers, routines, events and selected checksums.
No schema contents are printed by the comparator. Version or runtime differences
fail closed. Counts and selected checksums under FTWRL add to lock duration; first
measure a read-only unprotected dump and choose an approved bounded window. A
partial backup that exceeds the window is invalidated instead of extending it.

`bash rehearse-local.sh /tmp/fresh-unique-result` creates and destroys two isolated
MariaDB containers and their anonymous volumes, without host ports. It tests a
mixed InnoDB/MyISAM fixture, view, trigger, function, procedure and disabled event,
checks archive/manifest hashes and 33 restored manifests across two physical
schemas plus a dependent facade. A concurrent single autocommit cross-engine,
cross-schema update yields equal source/state epochs in the restored snapshot;
this does not make arbitrary multi-statement MyISAM business writes atomic, so
those must still drain before capture. It checks single-schema compatibility,
later-schema manifest errors, NULL checksums, overlapping-run rejection and lock
release after timeout, SIGKILL of the controller and lost Docker transport.
It also rejects overlap after controller death but before the watchdog deadline,
and places a watchdog deadline after UNLOCK but before the controller records
release; that run must remain INVALID with no COMPLETE and permit an actual write.
A named-definer facade restores successfully with its separately provisioned
principal/grants; dropping that principal makes an actual view read fail (1449)
even though prior logical manifests match. Manifest equality alone cannot prove
working recovery principals: always perform application/view reads as well.
It never connects to existing databases. `BACKUP_REHEARSAL_IMAGE` can pin the exact
production image; the default is the locally installed `mariadb:11.4` tag.
