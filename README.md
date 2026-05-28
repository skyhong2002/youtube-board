# YouTube Board Modern

YouTube Board Modern is a Laravel rebuild of the public `youtube.board.tw` reporting experience as a real-time YouTube data dashboard.

The project preserves the public report surfaces while moving data ingestion, cache rebuilding, scheduled polling, AI summaries, and report rendering into a maintainable Laravel codebase. The app is designed to fetch YouTube data, update local dashboard tables, and present live/near-real-time trends through modern routes plus compatibility redirects and API-shaped responses for legacy PHP URLs.

![YouTube Board tour](docs/assets/youtube-board-tour.gif)

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

- App: `http://127.0.0.1:8080`
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
http://127.0.0.1:8080/ops/ingestion
```

Inspect or run ingestion jobs:

```bash
docker compose exec app php artisan ingestion:list
docker compose exec app php artisan ingestion:run --dry-run
```

## Data Capture

The dashboard is built around scheduled and on-demand data capture from YouTube APIs, legacy public responses, approved snapshots, DB exports, and local MariaDB imports. Production data changes should still flow through reviewed Laravel commands, deployment configuration, backups, and explicit operator approval; do not hand-edit production code, mutate production DB rows manually, run production migrations casually, or use phpMyAdmin for manual data changes.

## Deployment

Production deployment notes are in [docs/deployment.md](docs/deployment.md).

Keep secrets out of the repository. Use `.env.example` and the files under `deploy/` as templates.
