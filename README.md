# 有影儀表板

The public frontend at [youtube.observe.tw](https://youtube.observe.tw) runs the TypeScript platform in [`platform/`](platform/README.md). Background ingestion remains on Laravel until each reviewed workflow handoff.

有影儀表板 (YouTube Board) is currently a Laravel rebuild of the public `youtube.board.tw` reporting experience as a real-time YouTube data dashboard.

The project preserves the public report surfaces while moving data ingestion, cache rebuilding, scheduled polling, AI summaries, and report rendering into a maintainable Laravel codebase. The app is designed to fetch YouTube data, update local dashboard tables, and present live/near-real-time trends through modern routes plus compatibility redirects and API-shaped responses for legacy PHP URLs.

![有影儀表板 tour](docs/assets/youtube-board-tour.gif)

## Features

- Real-time YouTube dashboard pages for keywords, tags, channels, videos, comments, groups, mayor reports, live streams, and AI summaries.
- Legacy compatibility redirects for top-level PHP routes such as `/live.php`, `/rank.php`, `/tag_group.php`, `/group_two.php`, `/channel.php`, `/ch/{u_id}/...`, and `/ai_day.php`.
- Live compatibility API routes under `/api/*.php`.
- Guarded legacy writeback and prompt URLs that route operators toward the Laravel ingestion dashboard.
- Local and scheduled tools for YouTube polling, cache generation, AI workflows, report maintenance, and data-import workflows.

Implementation details and parity notes live in:

- [docs/legacy-architecture-report.md](docs/legacy-architecture-report.md)
- [docs/legacy-inventory/feature-parity.md](docs/legacy-inventory/feature-parity.md)
- [docs/legacy-inventory/routes.md](docs/legacy-inventory/routes.md)
- [docs/deployment.md](docs/deployment.md)

## Tech Stack

- Laravel 13
- PHP 8.4 in the Docker runtime (application constraint: PHP 8.3 or newer)
- MariaDB/MySQL
- Vite
- Tailwind CSS
- Docker Compose for local development

## Local Development

Start the app:

```bash
docker compose up -d --build
```

The one-shot `setup` service installs the locked Composer/npm dependencies,
builds frontend assets, waits for MariaDB, and runs all migrations before the
app, worker, and scheduler start. A fresh checkout does not require a `.env`,
`vendor/`, `node_modules/`, or a legacy source snapshot. The committed Compose
defaults are local-development values only; create `.env` from `.env.example`
when you need credentials for optional API-backed ingestion.

The Compose scheduler is registered by default so a fresh checkout exercises
the real Laravel schedule. Its local and Production polling gates remain false
and its scheduled-write allowlist remains `off`. The default minute loop runs
`ingestion:run --execute --record`, recording only bounded, sanitized diagnostic
run history while every ingestion job resolves to a preview. It makes no external
API calls or ingestion/API target writes; enabling those writes still requires
explicit local env values and a reviewed exact allowlist.

Inspect bootstrap status:

```bash
docker compose ps
docker compose logs setup
```

Open:

- App: `http://127.0.0.1:8080`
- phpMyAdmin: `http://localhost:8081`

Default local database credentials:

- Server: `mysql`
- Username: `youtube_board`
- Password: `youtube_board`
- Database: `youtube_board`

Re-run the setup service after changing dependency locks or migrations:

```bash
docker compose run --rm setup
```

The legacy source snapshot is optional. To mount an approved read-only copy,
set `LEGACY_GROUND_TRUTH_PATH` and opt into the override:

```bash
LEGACY_GROUND_TRUTH_PATH=/absolute/path/to/youtube-board-legacy \
  docker compose -f docker-compose.yml -f docker-compose.legacy.yml up -d
```

## Common Commands

Run tests:

```bash
docker compose exec app php artisan test
```

List routes:

```bash
docker compose exec app php artisan route:list
```

Build frontend assets:

```bash
docker compose exec app npm run build
```

Open the ingestion dashboard:

```text
http://127.0.0.1:8080/ops/ingestion
```

Inspect or run ingestion jobs:

```bash
docker compose exec app php artisan ingestion:list
docker compose exec app php artisan ingestion:run --dry-run
```

Preview an approved local DB artifact without writing:

```bash
docker compose exec app php artisan db:import-local \
  urtube-live-slice-20260524-180544.sql.gz \
  --sha256=b8f161ea66f8058ba402021182f90aef0796971bf22d270410a86438b02b5667 \
  --dry-run
```

Imports are local-only and remain previews unless `--execute` is supplied;
`--dry-run` makes that non-writing contract explicit and cannot be combined
with `--execute`.
Artifacts containing reviewed `DROP TABLE IF EXISTS` statements additionally
require `--replace-existing`; see
[docs/legacy-inventory/db-dumps.md](docs/legacy-inventory/db-dumps.md) before
using that destructive local reset option.

The default `DatabaseSeeder` intentionally writes no shared users or dashboard
fixtures. Use the reviewed local import command or capped ingestion commands for
real dashboard data instead of adding reusable sample credentials.

## Data Capture

The dashboard is built around scheduled and on-demand data capture from YouTube APIs, legacy public responses, approved snapshots, DB exports, and local MariaDB imports. Production data changes should still flow through reviewed Laravel commands, deployment configuration, backups, and explicit operator approval; do not hand-edit production code, mutate production DB rows manually, run production migrations casually, or use phpMyAdmin for manual data changes.

`ingestion:run --record` stores new sanitized run records and per-job telemetry in the MariaDB-backed `ingestion_runs` and `ingestion_run_jobs` tables. Database age cleanup runs at most hourly and removes expired rows in 1,000-row batches until the backlog is clear; the hard record cap is enforced after every successful write. The defaults are 14 days and 25,000 run records, and the optional `INGESTION_RUN_HISTORY_RETENTION_DAYS` and `INGESTION_RUN_HISTORY_MAX_RECORDS` values tune those limits. Existing `storage/app/private/ingestion-runs/*.json` records remain readable as a legacy fallback; newly managed fallback files use the same age/count bounds when DB history is unavailable, but new scheduler records normally do not depend on a persistent web-container filesystem volume. The rate-limited dashboard runner persists web-run history only in `local` and `testing`; Production web previews are dry-run-only and are not persisted.

## Deployment

Production deployment notes are in [docs/deployment.md](docs/deployment.md).

Keep secrets out of the repository. Use `.env.example` and the files under `deploy/` as templates.

## License and attribution

Licensed under the [MIT License](LICENSE), copyright (c) 2026 Sky Hong.

The TypeScript frontend adapts shared layout, navigation, theme, scrolling and table primitives from [新文易數 (tag.observe.tw)](https://github.com/skyhong2002/tag.observe.tw). Its original MIT copyright and permission notice are retained in [platform/web/upstream/tag-observe-LICENSE](platform/web/upstream/tag-observe-LICENSE); adaptation details are in [the upstream attribution](platform/web/upstream/README.md). Third-party dependencies retain their respective licenses.
