# Ground Truth Policy

## Canonical Sources

1. `/Users/sky/Documents/youtube-board-legacy`
   - Local reference copy of the original CentOS PHP project.
   - Includes `urtube/`, `vh-board.conf`, and `urtube/cron`.
   - Use this for legacy routes, cron schedules, SQL behavior, API endpoint behavior, and domain vocabulary.
2. `https://youtube.board.tw`
   - Use this for externally visible behavior: page layout, labels, old URL behavior, redirect compatibility, ranking order, and public report semantics.
   - Public-site checks are secondary when the site is unavailable from this environment, but should be used when browser access works.
3. Local imported MariaDB
   - Contains extracted schema and sample/content data from the approved dumps.
   - It may be read and updated locally during reconstruction work so the Laravel app can rebuild the real-time YouTube dashboard behavior.
4. Approved production data exports
   - Use only when public responses, the legacy snapshot, and existing local dumps are insufficient.
   - Keep exports narrow, document them in [db-dumps.md](db-dumps.md), and redact source hosts or secret-bearing values before storing artifacts.

## Approved DB Artifacts

- Schema-only dump: `storage/app/db-dumps/urtube-schema-20260524-173342.sql`
- Compressed copy: `storage/app/db-dumps/urtube-schema-20260524-173342.sql.gz`
- Dump notes and checksums: `docs/legacy-inventory/db-dumps.md`

The dump directory is ignored by git. Later approved local imports also include recent live/report data and AI table content for real-time dashboard reconstruction.

## Local Mounts

- Docker mounts `/Users/sky/Documents/youtube-board-legacy` into the app container as a local ingestion reference, at the same absolute path.
- Laravel can parse legacy source files such as `mayor/make_mayor.sh` and `mayor/{city}.php` directly, while the container cannot write to the legacy snapshot.

## Not Ground Truth

- Generated local Laravel defaults.
- Any credentials or absolute production paths in legacy code.
- Guesses inferred without a source path or public-site observation.
- The active CentOS machine, unless explicitly approved for live dashboard inspection or export.

## Guardrails

- Do not modify `/Users/sky/Documents/youtube-board-legacy`.
- Do not run Composer, npm, migrations, formatters, linters, or codegen in the legacy snapshot.
- Do not copy legacy secrets into this repository.
- Write all inventory notes under `/Users/sky/Projects/youtube-board/docs/legacy-inventory`.
- Do not edit production code, write production DB rows, run production migrations, or change production polling/generation outside documented deployment controls and a backup/rollback plan.
- Do not use production phpMyAdmin for manual data changes; if phpMyAdmin is used at all, keep it to approved live dashboard inspection/export.
