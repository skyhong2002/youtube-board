# DB Dumps

Production DB access requires explicit approval and should flow through documented exports or reviewed ingestion operations. Dumps should be kept out of git.

## Data Capture Policy

Data capture is allowed for reconstruction when it is narrow, approved, and documented here. Prefer public HTTP responses and existing local dumps first. If fresh production data is needed, use an explicitly approved controlled export path, redact source hosts and secret-bearing values, and import the result only into local development MariaDB.

Do not use these workflows to edit production code, write production DB rows, run production migrations, trigger production polling/generation, or make manual phpMyAdmin data changes.

## Fresh Schema And Local Import

Fresh development databases do not depend on ignored dump files. Laravel migration
`2026_05_24_000000_create_legacy_dashboard_baseline` reads the committed
`database/schema/legacy-dashboard-baseline.sql` asset and creates the 50 approved
legacy dashboard tables that are missing. The asset contains no source comments,
`DROP` statements, production `DATA DIRECTORY` / `INDEX DIRECTORY` clauses, data
rows, or source auto-increment counters. `urt_mayor_person_ai` remains owned by its
separate Laravel migration.

Fresh checkouts include an empty `storage/app/db-dumps/` intake directory. Approved
data artifacts placed there stay ignored and out of git. Preview an artifact before
importing it:

```bash
docker compose exec app php artisan db:import-local \
  urtube-live-slice-20260524-180544.sql.gz \
  --sha256=b8f161ea66f8058ba402021182f90aef0796971bf22d270410a86438b02b5667 \
  --dry-run
```

The command:

- is a preview unless `--execute` is present; explicit `--dry-run` cannot be
  combined with `--execute` and never invokes the database client;
- accepts only `.sql` / `.sql.gz` files whose resolved path remains under
  `storage/app/db-dumps/`;
- can require an exact SHA-256 and enforces compressed/expanded-size plus runtime
  caps;
- permits only the 50 baseline table names, `CREATE TABLE`, single-table
  `DROP TABLE IF EXISTS`, literal-only `INSERT INTO ... VALUES` rows, and the
  narrow session-local charset/foreign-key/SQL-mode `SET` forms required by the
  approved dumps (SQL mode is limited to empty or `NO_AUTO_VALUE_ON_ZERO`);
  `INSERT` expressions, subqueries, server-file functions, and trailing clauses
  are refused; every other top-level statement is also refused, including
  database switching, account/grant DDL, server file access, global settings,
  unsupported data mutations, triggers/routines/events/views, lock-table
  directives, prepared statements, or server component installation;
- refuses Production, hosts outside the exact
  `LOCAL_DUMP_IMPORT_ALLOWED_HOSTS` allowlist, non-MySQL connections, and any
  database name other than the Compose-local `youtube_board`; the default allows
  only the Compose service names `mysql,mariadb`, not `localhost` or
  `127.0.0.1`, because either loopback address could be an SSH tunnel to a remote
  database;
- serializes all execute attempts with a global lock and keeps credentials, absolute
  paths, raw SQL, and MariaDB stderr out of command output and logs.

Inspection reads one source handle while hashing its original bytes, incrementally
expands gzip when needed, feeds those exact expanded chunks to the SQL lexer, and
writes the same chunks to a private `0600` reviewed artifact. Execute mode rechecks
that artifact's independent size/SHA-256 while making the MariaDB client's private
input copy. Both staging files are removed afterward, so changing the requested
source path between hashing, lexing, or client startup cannot swap in unreviewed
bytes.

Host-native MariaDB is opt-in. Add only a dedicated local hostname to
`LOCAL_DUMP_IMPORT_ALLOWED_HOSTS`; do not allow a loopback/tunnel endpoint. The
environment and exact `youtube_board` database-name checks still apply.
A checksum with a prior successful audit is an idempotent no-op: the command
returns `already_completed`, records the no-op attempt, and does not import the
same bytes again. SQL comments cannot hide unsupported statements, and both
`LOAD DATA` and `LOAD XML` are refused.

Every execute attempt writes a sanitized JSON audit record under
`storage/app/private/dump-imports/`. Records contain only the checksum, size/table
summary, replacement confirmation, status/error code, and local write-target label;
they never contain the artifact path, SQL contents, database credentials, or client
stderr.

The approved live/AI dumps intentionally contain `DROP TABLE IF EXISTS` followed
by schema and data statements. Executing one is a destructive replacement of the
listed local dashboard tables and therefore requires both flags:

```bash
docker compose exec app php artisan db:import-local \
  urtube-live-slice-20260524-180544.sql.gz \
  --sha256=b8f161ea66f8058ba402021182f90aef0796971bf22d270410a86438b02b5667 \
  --execute --replace-existing
```

Review the preview table list and checksum first. Do not use this command against
Production. The older schema-only dump still contains production-specific data
directory clauses and is intentionally refused by the importer; Laravel migrations
now own fresh schema creation.

## Schema-Only Dump

Generated on 2026-05-24:

| File | Size | SHA-256 |
| --- | ---: | --- |
| `storage/app/db-dumps/urtube-schema-20260524-173342.sql` | 35 KB | `d69fc25db343e070b66a90e186b8b74d9bfaa2a44dd4d4980b8da8514d21f91c` |
| `storage/app/db-dumps/urtube-schema-20260524-173342.sql.gz` | 4.4 KB | `daa473cffc2be0fd4f4830e2e3ea7444178a533b37e95686a377af49ec77619f` |

Contents:

- 50 `CREATE TABLE` statements.
- No `INSERT`, `REPLACE`, `UPDATE`, or `DELETE` data statements.
- Includes estimated row counts and table/index byte sizes as SQL comments.
- Source host is redacted in the dump header.

Helper:

- `scripts/remote-schema-dump.php` generates the schema through PHP 5.4 using legacy PHP DB config discovery.
- It runs only read queries: table listing, `SHOW CREATE TABLE`, optional view/trigger/routine schema statements, and `information_schema` size metadata.

## Size Estimate Before Full Dump

The production `urtube` database was estimated from `information_schema.tables` at roughly 80.7 GiB across 50 tables. A full dump should not be attempted casually.

Largest tables observed during the estimate:

| Table | Approx. size |
| --- | ---: |
| `urt_video` | 16.1 GB |
| `urt_show_video_tag_date` | 13.5 GB |
| `urt_show_tag_month` | 11.0 GB |
| `urt_show_tag_date` | 7.4 GB |
| `urt_video_log` | 5.8 GB |
| `urt_comment` | 4.8 GB |
| `urt_video_log_history` | 3.3 GB |

Recommended next dump, if needed: a gzip-compressed live vertical slice subset containing only live report dependencies.

## Recent Live Slice Estimate

Live slice estimate generated on 2026-05-24 with `scripts/remote-live-slice-estimate.php`.

Strategy:

- Anchor on live logs since `2026-05-17`.
- Include live streams that are still active or have recent live timestamps.
- Include related display rows, recent video metadata, channel/count rows for related channels, and all tag definitions.

Estimated uncompressed size:

| Table | Rows | Estimated size |
| --- | ---: | ---: |
| `urt_video_live` | 49,799 | 10.4 MB |
| `urt_video_live_log` | 5,062 | 4.7 MB |
| `urt_show_video_live` | 49,706 | 72.4 MB |
| `urt_video` | 53,929 | 76.2 MB |
| `urt_show_live_date` | 8 | 8.1 MB |
| `urt_show_live_tag_date` | 397 | 3.2 MB |
| `urt_channel` | 1,693 | 1.3 MB |
| `urt_count` | 1,693 | 0.2 MB |
| `urt_tag` | 108 | ~0 MB |
| **Total** | **162,395** | **176.6 MB** |

The actual SQL dump may differ, especially for `longtext`/JSON fields. A gzip-compressed dump should likely be much smaller than 176.6 MB, but estimate conservatively before transferring.

## Recent Live Slice Dump

Generated on 2026-05-24:

| File | Compressed size | Uncompressed size | SHA-256 |
| --- | ---: | ---: | --- |
| `storage/app/db-dumps/urtube-live-slice-20260524-180544.sql.gz` | 80 MB | 257 MB | `b8f161ea66f8058ba402021182f90aef0796971bf22d270410a86438b02b5667` |

Contents:

- All 50 table schemas, with production `DATA DIRECTORY` and `INDEX DIRECTORY` clauses removed for local import compatibility.
- Full reference data for channel/tag mapping tables, even when rows were not updated in the last seven days.
- Recent live-stream data anchored on cutoff date `2026-05-17`.
- No data rows from known token/comment-author revision tables such as `urt_log_api`, `urt_comment_author`, or `urt_comment_rev`.

Dumped row counts:

| Table | Rows |
| --- | ---: |
| `tag_group` | 1,833 |
| `tags` | 43,638 |
| `urt_channel` | 3,889 |
| `urt_count` | 3,890 |
| `urt_tag` | 108 |
| `urt_video_live` | 49,803 |
| `urt_video_live_log` | 5,067 |
| `urt_show_live_date` | 8 |
| `urt_show_live_tag_date` | 397 |
| `urt_show_video_live` | 49,710 |
| `urt_video` | 99,964 |
| `urt_video_live_log_tvbs` | 0 |
| `urt_video_live_tvbs` | 9 |

Helper:

- `scripts/remote-live-slice-dump.php`
- Streams SQL over SSH and compresses locally; no dump file is written to the production host.

## AI Tables Estimate

AI table estimate generated on 2026-05-24 with `scripts/remote-ai-tables-dump.php` in `AI_TABLES_MODE=estimate`.

| Table | Rows | Estimated table size |
| --- | ---: | ---: |
| `urt_ai_date` | 4,749 | 122.6 MB |
| `urt_ai_event` | 59 | 0.2 MB |
| `urt_ai_hour` | 9,562 | 29.8 MB |
| `urt_channel_ai` | 26,305 | 73.6 MB |
| **Total** | **40,675** | **226.1 MB** |

## AI Tables Dump

Generated on 2026-05-24:

| File | Compressed size | Uncompressed size | SHA-256 |
| --- | ---: | ---: | --- |
| `storage/app/db-dumps/urtube-ai-tables-20260524-190937.sql.gz` | 62 MB | 255 MB | `6c1b339bde10259230a5fe734151c787ebbbf3a551e8bd5f16a2796409e536dd` |

Contents:

- Schema and full data for `urt_ai_date`, `urt_ai_event`, `urt_ai_hour`, and `urt_channel_ai`.
- Production `DATA DIRECTORY` and `INDEX DIRECTORY` clauses are removed for local import compatibility.
- Source host is redacted in the dump header.
- Scan for direct API-key/config-secret patterns returned 0 matches.

Dumped and imported row counts:

| Table | Rows |
| --- | ---: |
| `urt_ai_date` | 4,749 |
| `urt_ai_event` | 59 |
| `urt_ai_hour` | 9,562 |
| `urt_channel_ai` | 26,305 |

Helper:

- `scripts/remote-ai-tables-dump.php`
- Streams SQL over SSH and compresses locally; no dump file is written to the production host.
- The local Laravel app was verified to read the imported AI tables from the development MariaDB database.
