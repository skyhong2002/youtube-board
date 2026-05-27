# YouTube Board Modern

YouTube Board Modern is a Laravel rebuild of the public `youtube.board.tw` reporting experience.

The project focuses on preserving the existing public report surfaces while moving the implementation into a maintainable Laravel codebase. Rebuilt pages are read-only by default, with compatibility redirects and API-shaped responses for legacy PHP URLs. Data capture for reconstruction is supported through public-site checks, approved legacy snapshots, approved DB exports, and local imports.

![YouTube Board tour](docs/assets/youtube-board-tour.gif)

## Features

- Public YouTube report pages for keywords, tags, channels, videos, comments, groups, mayor reports, live streams, and AI summaries.
- Legacy compatibility redirects for top-level PHP routes such as `/live.php`, `/rank.php`, `/tag_group.php`, `/group_two.php`, `/channel.php`, `/ch/{u_id}/...`, and `/ai_day.php`.
- Read-only compatibility API routes under `/api/*.php`.
- Guarded legacy writeback and prompt URLs for safer local and production operation.
- Local preview tools for ingestion, scheduled jobs, cache generation, report maintenance, and narrow data-import workflows.

Implementation details and parity notes live in:

- [docs/legacy-architecture-report.md](docs/legacy-architecture-report.md)
- [docs/legacy-inventory/feature-parity.md](docs/legacy-inventory/feature-parity.md)
- [docs/legacy-inventory/routes.md](docs/legacy-inventory/routes.md)
- [docs/deployment.md](docs/deployment.md)

## Tech Stack

- Laravel 13
- PHP 8.3
- MariaDB/MySQL
- Vite
- Tailwind CSS
- Docker Compose for local development

## Local Development

Start the app:

```bash
docker compose up -d --build
```

Open:

- App: `http://localhost:8080`
- phpMyAdmin: `http://localhost:8081`

Default local database credentials:

- Server: `mysql`
- Username: `youtube_board`
- Password: `youtube_board`
- Database: `youtube_board`

Install dependencies only if the local checkout is missing `vendor/` or `node_modules/`:

```bash
docker compose run --rm app composer install
docker compose run --rm app npm install
```

Run migrations for a fresh local database:

```bash
docker compose run --rm app php artisan migrate
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
http://localhost:8080/ops/ingestion
```

Preview ingestion jobs:

```bash
docker compose exec app php artisan ingestion:list
docker compose exec app php artisan ingestion:run --dry-run
```

## Data Capture

Use public `youtube.board.tw` responses, the read-only legacy snapshot, documented DB dumps, and local MariaDB imports to rebuild report parity. Production access, when explicitly approved, is limited to read-only inspection or export; do not edit production code, write production DB rows, run production migrations, or use phpMyAdmin for manual data changes.

## Deployment

Production deployment notes are in [docs/deployment.md](docs/deployment.md).

Keep secrets out of the repository. Use `.env.example` and the files under `deploy/` as templates.
