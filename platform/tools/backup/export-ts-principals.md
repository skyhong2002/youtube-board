# Scoped MariaDB principal recovery export

`export-ts-principals.py` creates private recovery SQL for the TypeScript database
principals. It selects exactly one running container by Swarm service label and
reads the existing root credential inside that container. It never accepts a
password argument or prints query results, auth hashes, or raw Docker/SQL errors.

Run from a trusted host account with Docker access, through the approved backup
workflow:

```bash
python3 /usr/local/lib/youtube-board-backup/export-ts-principals.py \
  /private/new-backup-stage/youtube_ts_principals
```

The default service is `youtube-board-db-qcja1i` and the default user prefix is
`youtube_ts_`. `--service` and `--user-prefix` permit other reviewed service/prefix
scopes with restricted syntax. An empty inventory, duplicate or malformed
principal identity, multiple DB containers, unexpected SQL response, or failed
command stops the export. Query commands have a 15-second timeout.

The destination must not already exist. It is created with mode 0700 and contains
mode 0600 files: `create-users.sql`, `grants.sql`, `inventory.json`, and
`principals.sha256`. The checksum file is written last. Standard output contains
only the principal count, grant count, and checksum-file SHA-256. All recovery
artifacts, including SQL containing auth hashes, belong in private backup storage.

Restore users before restoring schemas/views; restore grants after restoring the
schemas. Verify application reads with the restored principals. This exporter
neither locks tables nor freezes changes to grants or data. A recurring logical
backup using `--single-transaction` still lacks a consistency guarantee for
MyISAM tables. Use the reviewed consistent backup workflow for writer handoffs.

The mock suite does not connect to Docker or a database:

```bash
python3 platform/tools/backup/export-ts-principals.test.py
```
