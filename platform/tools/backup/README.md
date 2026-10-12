# Bounded mixed-engine logical backup

`consistent-logical.sh` is an opt-in Linux/MariaDB controller, not a scheduled job.
Preview is the default and performs no I/O. The caller must separately obtain
production approval, pause competing scheduled writers and arrange an independent
scheduler-resume watchdog. The tool never changes scheduler ownership.

```bash
bash consistent-logical.sh --preview
# Credentials are inherited via MYSQL_PWD or a private BACKUP_DEFAULTS_FILE.
BACKUP_CHECKSUM_TABLES=urt_tag,urt_channel,urt_count bash consistent-logical.sh \
  --execute --database=youtube_board --output=/private/fresh-backup-directory \
  --max-seconds=180 --lock-wait-seconds=5
```

The output directory must not exist. Files are private (umask 077); do not publish
its SQL, manifests or diagnostic logs. `BACKUP_DB_USER` defaults to root; optional
`BACKUP_DB_HOST`/`BACKUP_DB_PORT` select TCP. A separate persistent, non-reconnecting
session holds FTWRL. An independent detached watchdog marks the artifact invalid,
uses a unique advisory-lock owner to safely identify and KILL the holder, checks
processlist and terminates the dump process group. The deadline starts before
FTWRL acquisition. Acquisition also has its own bounded wait. Normal cleanup also
verifies that the holder is gone; a successful dump must answer a same-session
sentinel before releasing the lock. Client/SSH death is not treated as proof of
lock release.

A successful artifact has `COMPLETE`, no `INVALID`, a valid `archive.sha256`, and
`database.sql.gz`. The archive pipeline uses pipefail, gzip validation and an
atomic rename; Linux `sync -f` flushes the filesystem before and after publishing
`COMPLETE`. Copies still require independent hash validation and restore tests.
A watchdog or connection failure invalidates the run; never reuse or promote it.
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
checks copied archive integrity and full restored manifest equality, and tests
lock release after timeout, SIGKILL of the controller and lost Docker transport.
It never connects to existing databases. `BACKUP_REHEARSAL_IMAGE` can pin the exact
production image; the default is the locally installed `mariadb:11.4` tag.
