# DB Dumps

Production DB access is read-only unless explicitly approved otherwise. Dumps should be kept out of git.

## Data Capture Policy

Data capture is allowed for reconstruction when it is narrow, read-only, and documented here. Prefer public HTTP responses and existing local dumps first. If fresh production data is needed, use an explicitly approved read-only export path, redact source hosts and secret-bearing values, and import the result only into local development MariaDB.

Do not use these workflows to edit production code, write production DB rows, run production migrations, trigger production polling/generation, or make manual phpMyAdmin data changes.

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

Read-only estimate generated on 2026-05-24 with `scripts/remote-live-slice-estimate.php`.

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

Read-only estimate generated on 2026-05-24 with `scripts/remote-ai-tables-dump.php` in `AI_TABLES_MODE=estimate`.

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
